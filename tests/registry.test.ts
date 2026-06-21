import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRoomStore } from "../src/core/storage.js";

const previousHome = process.env.AGENTROOM_HOME;

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.AGENTROOM_HOME;
  } else {
    process.env.AGENTROOM_HOME = previousHome;
  }
});

describe("AgentRoom registry", () => {
  it("rejects project links that point outside AGENTROOM_HOME", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-registry-"));
    const project = path.join(sandbox, "project");
    process.env.AGENTROOM_HOME = path.join(sandbox, "home");

    try {
      await mkdir(path.join(project, ".agentroom"), { recursive: true });
      await writeFile(
        path.join(project, ".agentroom", "room-link.json"),
        JSON.stringify({
          roomId: "room_bad",
          inviteCode: "ar_bad",
          roomDir: path.join(sandbox, "outside-room"),
          linkedAt: new Date().toISOString()
        }),
        "utf8"
      );

      await expect(AgentRoomStore.requireLinkedProject(project)).rejects.toThrow(/not connected|must be inside/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("refuses to write project files through a symlinked .agentroom directory", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-registry-symlink-"));
    const project = path.join(sandbox, "project");
    const outside = path.join(sandbox, "outside-agentroom");
    process.env.AGENTROOM_HOME = path.join(sandbox, "home");

    try {
      await mkdir(project, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(outside, path.join(project, ".agentroom"));

      await expect(AgentRoomStore.createSharedRoom(project, { name: "Unsafe" })).rejects.toThrow(/symlinked/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects room directories that escape AGENTROOM_HOME through a symlinked rooms parent", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-registry-home-symlink-"));
    const project = path.join(sandbox, "project");
    const home = path.join(sandbox, "home");
    const outsideRooms = path.join(sandbox, "outside-rooms");
    process.env.AGENTROOM_HOME = home;

    try {
      await mkdir(project, { recursive: true });
      await mkdir(home, { recursive: true });
      await mkdir(outsideRooms, { recursive: true });
      await symlink(outsideRooms, path.join(home, "rooms"));

      await expect(AgentRoomStore.createSharedRoom(project, { name: "Escaping room" })).rejects.toThrow(/resolve inside/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
