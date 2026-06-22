import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { startHostedRelay } from "../src/server/hosted-relay.js";
import type { Decision, RoomState } from "../src/core/types.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxCli = path.join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = path.join(repoRoot, "src", "cli.ts");

describe("hosted relay", () => {
  const servers: Array<{ close(callback?: (error?: Error) => void): void }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("coordinates two projects from separate AgentRoom homes through a hosted relay", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-remote-"));
    const projectA = path.join(root, "machine-a", "wordpress");
    const projectB = path.join(root, "machine-b", "saas");
    const homeA = path.join(root, "machine-a", "home");
    const homeB = path.join(root, "machine-b", "home");
    const dataDir = path.join(root, "relay-data");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writePackage(projectA, "wordpress", {});
    await writePackage(projectB, "saas", {});
    await mkdir(path.join(projectA, "src", "types"), { recursive: true });
    await writeFile(
      path.join(projectA, "src", "types", "case-study.ts"),
      "export type CaseStudy = {\n  title: string;\n  heroImage?: string | null;\n};\n"
    );

    const relay = await startHostedRelay({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      adminToken: "test-admin-token"
    });
    servers.push(relay.server);

    try {
      const installer = await fetch(`${relay.url}/install.sh`);
      expect(installer.status).toBe(200);
      expect(installer.headers.get("content-type")).toContain("text/x-shellscript");
      expect(await installer.text()).toContain("agentroom-ai");

      const connected = await runCli(
        projectA,
        { ...process.env, AGENTROOM_HOME: homeA, AGENTROOM_RELAY_ADMIN_TOKEN: "test-admin-token" },
        "connect",
        "--relay",
        relay.url,
        "--name",
        "WordPress",
        "--agent",
        "Claude"
      );
      const invite = connected.match(/Invite code: (\S+)/)?.[1];
      const dashboardUrl = connected.match(/Dashboard: (http:\/\/[^\s]+)/)?.[1];
      expect(invite).toBeDefined();
      expect(invite).toMatch(/^arr_/);
      expect(dashboardUrl).toBeDefined();
      const rawInvite = dashboardUrl!.match(/\/dashboard\/([^?]+)/)?.[1];
      expect(rawInvite).toMatch(/^ar_/);
      const creatorLink = await readJsonFile<{
        dashboardUrl: string;
        inviteCode: string;
      }>(path.join(projectA, ".agentroom", "room-link.json"));
      expect(creatorLink.dashboardUrl).toBe(dashboardUrl);
      expect(creatorLink.inviteCode).toBe(invite);

      const joined = await runCli(
        projectB,
        { ...process.env, AGENTROOM_HOME: homeB },
        "join",
        invite!,
        "--name",
        "SaaS",
        "--agent",
        "Codex"
      );
      expect(joined).toContain("Joined remote AgentRoom");

      const projects = await runCli(projectB, { ...process.env, AGENTROOM_HOME: homeB }, "projects");
      expect(projects).toContain("WordPress");
      expect(projects).toContain("SaaS");

      const installed = await runCli(projectB, { ...process.env, AGENTROOM_HOME: homeB }, "install-mcp", "all");
      expect(installed).toContain("Installed AgentRoom MCP for codex");
      const projectsAfterInstall = await runCli(projectB, { ...process.env, AGENTROOM_HOME: homeB }, "projects");
      expect(projectsAfterInstall).toContain("WordPress");
      expect(projectsAfterInstall).toContain("SaaS");

      const unauthorizedDashboard = await fetch(`${relay.url}/api/state`);
      expect(unauthorizedDashboard.status).toBe(401);

      const dashboardLogin = await fetch(dashboardUrl!, { redirect: "manual" });
      expect(dashboardLogin.status).toBe(302);
      const dashboardCookie = dashboardLogin.headers.get("set-cookie")?.split(";")[0];
      expect(dashboardCookie).toContain("agentroom_dashboard_session=");

      const dashboardState = await fetch(`${relay.url}/api/state`, { headers: { cookie: dashboardCookie! } });
      expect(dashboardState.status).toBe(200);
      const dashboardRoom = await dashboardState.json() as RoomState;
      expect(dashboardRoom.room.inviteCode).toBe(rawInvite);
      expect(dashboardRoom.projects.map((project) => project.name)).toEqual(expect.arrayContaining(["WordPress", "SaaS"]));

      const saasLink = await readJsonFile<{
        roomId: string;
        projectToken: string;
      }>(path.join(projectB, ".agentroom", "room-link.json"));
      const wordpressLink = await readJsonFile<{
        roomId: string;
        projectToken: string;
      }>(path.join(projectA, ".agentroom", "room-link.json"));
      const dashboardAsProject = await fetch(`${relay.url}/api/rooms/${saasLink.roomId}/state`, { headers: { cookie: dashboardCookie! } });
      expect(dashboardAsProject.status).toBe(401);

      const wordpressActivity = await fetch(`${relay.url}/api/rooms/${wordpressLink.roomId}/file-activity`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${wordpressLink.projectToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ path: "src/shared/case-study.ts", status: "modified", branch: "main" })
      });
      expect(wordpressActivity.status).toBe(201);

      const saasCheck = await fetch(`${relay.url}/api/rooms/${saasLink.roomId}/file-alerts/check`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${saasLink.projectToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ path: "src/shared/case-study.ts", status: "editing", branch: "main" })
      });
      expect(saasCheck.status).toBe(200);
      const fileCheck = await saasCheck.json() as { requiresUserConfirmation: boolean; alerts: Array<{ id: string }> };
      expect(fileCheck.requiresUserConfirmation).toBe(true);

      const saasConfirm = await fetch(`${relay.url}/api/rooms/${saasLink.roomId}/file-alerts/${fileCheck.alerts[0]!.id}/confirm`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${saasLink.projectToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ decision: "continue", confirmedBy: "Matho" })
      });
      expect(saasConfirm.status).toBe(200);
      expect(await saasConfirm.json()).toMatchObject({ status: "continued", resolution: "continue" });

      const proposedDecision = await fetch(`${relay.url}/api/rooms/${saasLink.roomId}/decisions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${saasLink.projectToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Use nullable hero images",
          reason: "Older WordPress case studies do not always have hero media.",
          status: "proposed",
          approvedBy: [],
          affects: ["case_study.heroImage"],
          risk: "Importer needs a fallback image."
        })
      });
      expect(proposedDecision.status).toBe(201);
      const decision = await proposedDecision.json() as Decision;

      const approvedDecision = await fetch(`${relay.url}/api/decisions/${decision.id}/status`, {
        method: "POST",
        headers: {
          cookie: dashboardCookie!,
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "approved", approvedBy: "Product owner" })
      });
      expect(approvedDecision.status).toBe(200);
      expect(await approvedDecision.json()).toMatchObject({
        id: decision.id,
        status: "approved",
        approvedBy: ["Product owner"]
      });

      const wsState = await readDashboardWebSocketState(relay.url, dashboardCookie!);
      expect(wsState.room.inviteCode).toBe(rawInvite);
      expect(wsState.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ id: decision.id, status: "approved" })]));

      const asked = await runCli(
        projectB,
        { ...process.env, AGENTROOM_HOME: homeB },
        "ask",
        "--from",
        "SaaS",
        "--to",
        "WordPress",
        "--topic",
        "case_study.heroImage",
        "--question",
        "Can heroImage be null?",
        "--urgency",
        "blocking"
      );
      expect(asked).toContain("Question recorded:");

      const inbox = await runCli(projectA, { ...process.env, AGENTROOM_HOME: homeA }, "inbox");
      expect(inbox).toContain("Can heroImage be null?");

      const processed = await runCli(projectA, { ...process.env, AGENTROOM_HOME: homeA }, "process-inbox");
      expect(processed).toContain("ANSWERED");

      const summary = await runCli(projectB, { ...process.env, AGENTROOM_HOME: homeB }, "summary");
      expect(summary).toContain("0 question(s) ouverte");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writePackage(projectDir: string, name: string, dependencies: Record<string, string>) {
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", dependencies }, null, 2)
  );
}

async function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, cliPath, ...args], {
    cwd,
    env
  });
  return stdout;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readDashboardWebSocketState(relayUrl: string, cookie: string): Promise<RoomState> {
  const wsUrl = relayUrl.replace(/^http/, "ws") + "/ws";
  return new Promise<RoomState>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for dashboard websocket state."));
    }, 3000);
    socket.once("message", (message) => {
      clearTimeout(timeout);
      socket.close();
      const payload = JSON.parse(message.toString()) as { type: string; state: RoomState };
      resolve(payload.state);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
