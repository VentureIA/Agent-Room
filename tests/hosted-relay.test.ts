import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { startHostedRelay } from "../src/server/hosted-relay.js";

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
      const invite = connected.match(/Invite code: (ar_[A-Za-z0-9_-]+)/)?.[1];
      expect(invite).toBeDefined();

      const joined = await runCli(
        projectB,
        { ...process.env, AGENTROOM_HOME: homeB },
        "join",
        invite!,
        "--relay",
        relay.url,
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
