import { promises as fs } from "node:fs";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) return undefined;
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureSafeDirectory(path.dirname(filePath));
  await assertNotSymlink(filePath);
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}

export async function appendTextFile(filePath: string, content: string): Promise<void> {
  await ensureSafeDirectory(path.dirname(filePath));
  await assertNotSymlink(filePath);
  await fs.appendFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}

export async function ensureSafeDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dirPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked AgentRoom directory: ${dirPath}`);
  }
}

async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function listFiles(
  root: string,
  options: { maxDepth?: number; ignored?: string[] } = {}
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4;
  const ignored = new Set(options.ignored ?? [".git", "node_modules", "vendor", "dist", "build", ".agentroom"]);
  const out: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else {
        out.push(relative);
      }
    }
  }

  await walk(root, 0);
  return out.sort();
}
