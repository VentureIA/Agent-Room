import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliPath = path.join(repoRoot, "src", "cli.ts");

describe("CLI connect/join A to Z", () => {
  it("connects two project folders to the same shared room and exchanges a question", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-az-"));
    const home = path.join(sandbox, "home");
    const projectA = path.join(sandbox, "wordpress");
    const projectB = path.join(sandbox, "saas");
    const env = { ...process.env, AGENTROOM_HOME: home };

    try {
      await writePackage(projectA, "wordpress-site", { "@wordpress/scripts": "^30.0.0" });
      await writePackage(projectB, "saas-app", { react: "^19.0.0", vite: "^8.0.0" });
      await mkdir(path.join(projectA, "src", "types"), { recursive: true });
      await writeFile(
        path.join(projectA, "src", "types", "case-study.ts"),
        "export type CaseStudy = {\n  title: string;\n  heroImage?: string | null;\n};\n",
        "utf8"
      );

      const connected = await runCli(projectA, env, "connect", "--name", "WordPress", "--agent", "Claude");
      const invite = connected.match(/Invite code: (ar_[A-Za-z0-9_-]+)/)?.[1];
      expect(invite).toBeDefined();

      await writeFile(path.join(projectB, ".mcp.json"), `${JSON.stringify({ mcpServers: {} })}\n`, "utf8");
      const joined = await runCli(projectB, env, "join", invite!, "--name", "SaaS", "--agent", "Codex");
      expect(joined).toContain(`via ${invite}`);
      expect(joined).toContain("Claude MCP: OK");
      expect(joined).toContain("Codex MCP: OK");
      const claudeMcp = JSON.parse(await readFile(path.join(projectB, ".mcp.json"), "utf8")) as {
        mcpServers: { agentroom?: { command: string; args: string[] } };
      };
      const codexMcp = JSON.parse(await readFile(path.join(projectB, ".codex", "mcp.json"), "utf8")) as {
        mcp_servers: { agentroom?: { command: string; args: string[] } };
      };
      expect(claudeMcp.mcpServers.agentroom).toMatchObject({ command: "npx", args: ["-y", "agentroom-ai", "mcp"] });
      expect(codexMcp.mcp_servers.agentroom).toMatchObject({ command: "npx", args: ["-y", "agentroom-ai", "mcp"] });

      const doctor = await runCli(projectB, env, "doctor");
      expect(doctor).toContain("Claude MCP: OK");
      expect(doctor).toContain("Codex MCP: OK");

      const projectsFromA = await runCli(projectA, env, "projects");
      const projectsFromB = await runCli(projectB, env, "projects");
      expect(projectsFromA).toContain("WordPress");
      expect(projectsFromA).toContain("SaaS");
      expect(projectsFromB).toEqual(projectsFromA);

      const asked = await runCli(
        projectB,
        env,
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
      const questionId = asked.match(/Question recorded: (q_[A-Za-z0-9_-]+)/)?.[1];
      expect(questionId).toBeDefined();

      const inboxA = await runCli(projectA, env, "inbox");
      expect(inboxA).toContain(questionId);
      expect(inboxA).toContain("case_study.heroImage");

      const processed = await runCli(projectA, env, "process-inbox");
      expect(processed).toContain(`ANSWERED ${questionId}`);
      expect(processed).toContain("src/types/case-study.ts");

      const inboxB = await runCli(projectB, env, "inbox");
      expect(inboxB).toContain("Inbox empty.");

      const summary = await runCli(projectB, env, "summary");
      expect(summary).toContain("WordPress et SaaS");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not create a private room for read-only commands in an unlinked project", async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), "agentroom-unlinked-"));
    const home = path.join(sandbox, "home");
    const project = path.join(sandbox, "plain-project");
    const env = { ...process.env, AGENTROOM_HOME: home };

    try {
      await writePackage(project, "plain-project", {});
      await expect(runCli(project, env, "status")).rejects.toThrow(/not connected/);
      await expect(pathExists(path.join(project, ".agentroom"))).resolves.toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

async function writePackage(projectDir: string, name: string, dependencies: Record<string, string>) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({ name, dependencies }, null, 2)}\n`, "utf8");
}

async function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, cliPath, ...args], {
    cwd,
    env
  });
  return stdout.trim();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
