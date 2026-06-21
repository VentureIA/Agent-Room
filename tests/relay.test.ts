import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { startRelay } from "../src/server/relay.js";
import { AgentRoomStore } from "../src/core/storage.js";
import { readProjectLink } from "../src/core/registry.js";

describe("startRelay", () => {
  it("requires a local dashboard session for API and WebSocket state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-relay-"));
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = path.join(root, "home");
    let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
    try {
      await AgentRoomStore.createSharedRoom(root, { name: "Relay Project" });
      relay = await startRelay({ root, port: 0 });
      const baseUrl = new URL(relay.url).origin;
      await expect(fetch(`${baseUrl}/api/state`)).resolves.toMatchObject({ status: 401 });

      const home = await fetch(relay.url);
      const cookie = home.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toContain("agentroom_session=");

      const stateResponse = await fetch(`${baseUrl}/api/state`, { headers: { cookie: cookie ?? "" } });
      expect(stateResponse.status).toBe(200);
      const missingApiResponse = await fetch(`${baseUrl}/api/missing`, { headers: { cookie: cookie ?? "" } });
      expect(missingApiResponse.status).toBe(404);

      const link = await readProjectLink(root);
      expect(link?.relayUrl).toBe(`${baseUrl}/`);

      await expect(openSocket(`${baseUrl.replace("http", "ws")}/ws`, { cookie })).resolves.toContain("state");
      await expect(openSocket(`${baseUrl.replace("http", "ws")}/ws`, { origin: "https://evil.example", cookie })).rejects.toThrow();
    } finally {
      if (relay) {
        const currentRelay = relay;
        await new Promise<void>((resolve) => currentRelay.server.close(() => resolve()));
        currentRelay.store.close();
      }
      restoreHome(previousHome);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects cleanly when the port is already in use", async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "agentroom-relay-first-"));
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "agentroom-relay-second-"));
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = path.join(firstRoot, "home");
    let first: Awaited<ReturnType<typeof startRelay>> | undefined;
    try {
      await AgentRoomStore.createSharedRoom(firstRoot, { name: "First" });
      await AgentRoomStore.createSharedRoom(secondRoot, { name: "Second" });
      first = await startRelay({ root: firstRoot, port: 0 });
      const port = Number(new URL(first.url).port);
      await expect(startRelay({ root: secondRoot, port })).rejects.toThrow();
    } finally {
      if (first) {
        const currentRelay = first;
        await new Promise<void>((resolve) => currentRelay.server.close(() => resolve()));
        currentRelay.store.close();
      }
      restoreHome(previousHome);
      await rm(firstRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
    }
  });

  it("updates approval statuses through the local dashboard API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-relay-approvals-"));
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = path.join(root, "home");
    let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
    try {
      const connected = await AgentRoomStore.createSharedRoom(root, { name: "Approval Relay" });
      const decision = await connected.store.recordDecision({
        title: "Approve import fallback",
        reason: "Imported pages need resilience.",
        status: "proposed",
        approvedBy: [],
        affects: [connected.project.name],
        risk: "Low"
      });
      const contract = await connected.store.publishContract({
        providerProjectId: connected.project.id,
        consumerProjectId: connected.project.id,
        version: "v1",
        status: "draft",
        resources: [{ kind: "JSON", name: "CaseStudy" }],
        breakingChangesRequireHumanApproval: true
      });
      const access = await connected.store.requestAccess({
        fromProjectId: connected.project.id,
        toProjectId: connected.project.id,
        path: "config/content-source.json",
        reason: "Verify source settings.",
        scope: "read-only"
      });
      connected.store.close();

      relay = await startRelay({ root, port: 0 });
      const baseUrl = new URL(relay.url).origin;
      const home = await fetch(relay.url);
      const cookie = home.headers.get("set-cookie")?.split(";")[0] ?? "";

      await expect(postStatus(`${baseUrl}/api/decisions/${decision.id}/status`, cookie, "approved")).resolves.toMatchObject({ status: "approved" });
      await expect(postStatus(`${baseUrl}/api/contracts/${contract.id}/status`, cookie, "active")).resolves.toMatchObject({ status: "active" });
      await expect(postStatus(`${baseUrl}/api/access-requests/${access.id}/status`, cookie, "approved")).resolves.toMatchObject({ status: "approved" });
    } finally {
      if (relay) {
        const currentRelay = relay;
        await new Promise<void>((resolve) => currentRelay.server.close(() => resolve()));
        currentRelay.store.close();
      }
      restoreHome(previousHome);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checks and confirms file collision alerts through the local dashboard API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-relay-files-"));
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = path.join(root, "home");
    let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
    try {
      const connected = await AgentRoomStore.createSharedRoom(root, { name: "File Relay" });
      await connected.store.publishFileActivityForProject(connected.project.id, {
        path: "src/shared/api.ts",
        status: "modified",
        branch: "main"
      });
      connected.store.close();

      relay = await startRelay({ root, port: 0 });
      const baseUrl = new URL(relay.url).origin;
      const home = await fetch(relay.url);
      const cookie = home.headers.get("set-cookie")?.split(";")[0] ?? "";

      const checkResponse = await fetch(`${baseUrl}/api/file-alerts/check`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "src/shared/api.ts", status: "editing", branch: "main" })
      });
      expect(checkResponse.status).toBe(200);
      const check = await checkResponse.json() as { requiresUserConfirmation: boolean; alerts: Array<{ id: string }> };
      expect(check.requiresUserConfirmation).toBe(false);

      const secondRoot = path.join(root, "second");
      await mkdir(secondRoot, { recursive: true });
      const secondStore = new AgentRoomStore(secondRoot, { roomDir: relay.store.roomDir });
      const secondProject = await secondStore.connectProject({ name: "Other Dev" });
      await secondStore.publishFileActivityForProject(secondProject.id, {
        path: "src/other.ts",
        status: "modified",
        branch: "main"
      });
      secondStore.close();

      const blockedResponse = await fetch(`${baseUrl}/api/file-alerts/check`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "src/other.ts", status: "editing", branch: "main" })
      });
      const blocked = await blockedResponse.json() as { requiresUserConfirmation: boolean; alerts: Array<{ id: string }> };
      expect(blocked.requiresUserConfirmation).toBe(true);

      const confirmResponse = await fetch(`${baseUrl}/api/file-alerts/${blocked.alerts[0]!.id}/confirm`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "continue", confirmedBy: "Matho" })
      });
      expect(confirmResponse.status).toBe(200);
      await expect(confirmResponse.json()).resolves.toMatchObject({ status: "continued", resolution: "continue" });
    } finally {
      if (relay) {
        const currentRelay = relay;
        await new Promise<void>((resolve) => currentRelay.server.close(() => resolve()));
        currentRelay.store.close();
      }
      restoreHome(previousHome);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function postStatus(url: string, cookie: string, status: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  expect(response.status).toBe(200);
  return response.json();
}

function openSocket(url: string, headers: { origin?: string; cookie?: string | null }): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      origin: headers.origin ?? "http://127.0.0.1",
      headers: headers.cookie ? { cookie: headers.cookie } : undefined
    });
    socket.once("message", (data) => {
      socket.close();
      resolve(String(data));
    });
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`Unexpected response ${response.statusCode}`));
    });
  });
}

function restoreHome(previousHome: string | undefined) {
  if (previousHome === undefined) {
    delete process.env.AGENTROOM_HOME;
  } else {
    process.env.AGENTROOM_HOME = previousHome;
  }
}
