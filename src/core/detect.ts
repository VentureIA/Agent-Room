import { promises as fs } from "node:fs";
import path from "node:path";
import { exists, readJson } from "./files.js";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type ProjectDetection = {
  name: string;
  role: string;
  stack: string[];
  agentHints: string[];
};

export async function detectProject(projectPath: string): Promise<ProjectDetection> {
  const packageJson = await readJson<PackageJson>(path.join(projectPath, "package.json"));
  const stack = new Set<string>();
  const agentHints: string[] = [];

  if (packageJson) {
    stack.add("Node.js");
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (deps.react) stack.add("React");
    if (deps.vite) stack.add("Vite");
    if (deps.next) stack.add("Next.js");
    if (deps["@wordpress/scripts"] || deps["@wordpress/blocks"]) stack.add("WordPress");
    if (deps.prisma) stack.add("Prisma");
  }

  if (await exists(path.join(projectPath, "composer.json"))) stack.add("PHP/Composer");
  if (await exists(path.join(projectPath, "wp-config.php"))) stack.add("WordPress");
  if (await exists(path.join(projectPath, "schema.graphql"))) stack.add("GraphQL");
  if (await exists(path.join(projectPath, "openapi.yaml"))) stack.add("OpenAPI");
  if (await exists(path.join(projectPath, "AGENTS.md"))) agentHints.push("Codex");
  if (await exists(path.join(projectPath, "CLAUDE.md"))) agentHints.push("Claude Code");

  const readme = await readFirstExisting(projectPath, ["README.md", "readme.md"]);
  const name = packageJson?.name ?? path.basename(projectPath);
  const role = inferRole(readme, Array.from(stack));

  return {
    name,
    role,
    stack: Array.from(stack).sort(),
    agentHints
  };
}

async function readFirstExisting(root: string, names: string[]): Promise<string> {
  for (const name of names) {
    const filePath = path.join(root, name);
    if (await exists(filePath)) return fs.readFile(filePath, "utf8");
  }
  return "";
}

function inferRole(readme: string, stack: string[]): string {
  const source = readme.toLowerCase();
  if (source.includes("api") || stack.includes("OpenAPI")) return "API provider";
  if (source.includes("wordpress") || stack.includes("WordPress")) return "Content provider";
  if (source.includes("dashboard") || source.includes("saas")) return "SaaS application";
  if (stack.includes("React") || stack.includes("Next.js")) return "Web application";
  return "Project in coordination room";
}
