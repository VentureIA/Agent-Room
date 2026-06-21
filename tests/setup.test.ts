import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installMcpConfig } from "../src/core/install.js";
import { setupAgentRoom } from "../src/core/setup.js";

describe("setupAgentRoom", () => {
  it("creates project permissions and MCP integration files", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-setup-"));
    const project = path.join(sandbox, "project");
    const home = path.join(sandbox, "home");
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = home;

    try {
      await writePackage(project, "setup-demo");
      const setup = await setupAgentRoom(project, { name: "Setup Demo", agentKind: "Codex" });

      await expect(readFile(setup.files.permissions, "utf8")).resolves.toContain("## Visible");
      await expect(readFile(setup.files.agentGuide, "utf8")).resolves.toContain("process_inbox");

      const codexConfig = JSON.parse(await readFile(setup.files.codexMcp, "utf8")) as {
        mcp_servers: { agentroom: { command: string; args: string[]; cwd: string } };
      };
      const claudeConfig = JSON.parse(await readFile(setup.files.claudeMcp, "utf8")) as {
        mcpServers: { agentroom: { command: string; args: string[]; cwd: string } };
      };

      expect(codexConfig.mcp_servers.agentroom.cwd).toBe(project);
      expect(codexConfig.mcp_servers.agentroom.args.at(-1)).toBe("mcp");
      expect(claudeConfig.mcpServers.agentroom.cwd).toBe(project);
      expect(setup.room.inviteCode).toMatch(/^ar_/);

      await rm(setup.files.permissions, { force: true });
      await rm(path.join(project, ".agentroom", "project-card.md"), { force: true });
      const repaired = await setupAgentRoom(project, { name: "Setup Demo", agentKind: "Codex" });
      await expect(readFile(repaired.files.permissions, "utf8")).resolves.toContain("## Visible");
      await expect(readFile(path.join(project, ".agentroom", "project-card.md"), "utf8")).resolves.toContain("Setup Demo");
    } finally {
      if (previousHome === undefined) delete process.env.AGENTROOM_HOME;
      else process.env.AGENTROOM_HOME = previousHome;
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("installs project-local MCP configs for Codex and Claude", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-install-"));
    const project = path.join(sandbox, "project");
    const home = path.join(sandbox, "home");
    const previousHome = process.env.AGENTROOM_HOME;
    process.env.AGENTROOM_HOME = home;

    try {
      await writePackage(project, "install-demo");
      const codex = await installMcpConfig(project, { client: "codex", name: "Install Demo" });
      const claude = await installMcpConfig(project, { client: "claude", name: "Install Demo" });

      expect(codex.configPath).toBe(path.join(project, ".codex", "mcp.json"));
      expect(claude.configPath).toBe(path.join(project, ".mcp.json"));

      const codexConfig = JSON.parse(await readFile(codex.configPath, "utf8")) as {
        mcp_servers: { agentroom: { cwd: string } };
      };
      const claudeConfig = JSON.parse(await readFile(claude.configPath, "utf8")) as {
        mcpServers: { agentroom: { cwd: string } };
      };
      expect(codexConfig.mcp_servers.agentroom.cwd).toBe(project);
      expect(claudeConfig.mcpServers.agentroom.cwd).toBe(project);

      await writeFile(path.join(project, ".codex", "mcp.json"), `${JSON.stringify({ keep: true, mcp_servers: { other: { command: "node" } } })}\n`, "utf8");
      await installMcpConfig(project, { client: "codex", name: "Install Demo" });
      const mergedConfig = JSON.parse(await readFile(codex.configPath, "utf8")) as {
        keep: boolean;
        mcp_servers: { other?: unknown; agentroom?: unknown };
      };
      expect(mergedConfig.keep).toBe(true);
      expect(mergedConfig.mcp_servers.other).toBeDefined();
      expect(mergedConfig.mcp_servers.agentroom).toBeDefined();

      await writeFile(path.join(project, ".mcp.json"), `${JSON.stringify({ mcpServers: [] })}\n`, "utf8");
      await expect(installMcpConfig(project, { client: "claude", name: "Install Demo" })).rejects.toThrow(/mcpServers/);
      await expect(installMcpConfig(project, { client: "codex", scope: "custom" })).rejects.toThrow(/configPath/);
      await expect(installMcpConfig(project, { client: "codex", configPath: "../outside.json" })).rejects.toThrow(/inside the project/);
    } finally {
      if (previousHome === undefined) delete process.env.AGENTROOM_HOME;
      else process.env.AGENTROOM_HOME = previousHome;
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

async function writePackage(projectDir: string, name: string) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({ name, dependencies: {} }, null, 2)}\n`, "utf8");
}
