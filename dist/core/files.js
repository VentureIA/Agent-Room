import { promises as fs } from "node:fs";
import path from "node:path";
export async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export async function readJson(filePath) {
    if (!(await exists(filePath)))
        return undefined;
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
}
export async function writeJson(filePath, value) {
    await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
export async function writeTextFile(filePath, content) {
    await ensureSafeDirectory(path.dirname(filePath));
    await assertNotSymlink(filePath);
    await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}
export async function appendTextFile(filePath, content) {
    await ensureSafeDirectory(path.dirname(filePath));
    await assertNotSymlink(filePath);
    await fs.appendFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}
export async function ensureSafeDirectory(dirPath) {
    await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(dirPath);
    if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to use symlinked AgentRoom directory: ${dirPath}`);
    }
}
async function assertNotSymlink(filePath) {
    try {
        const stat = await fs.lstat(filePath);
        if (stat.isSymbolicLink())
            throw new Error(`Refusing to write through symlink: ${filePath}`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
export async function listFiles(root, options = {}) {
    const maxDepth = options.maxDepth ?? 4;
    const ignored = new Set(options.ignored ?? [".git", "node_modules", "vendor", "dist", "build", ".agentroom"]);
    const out = [];
    async function walk(current, depth) {
        if (depth > maxDepth)
            return;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (ignored.has(entry.name))
                continue;
            const fullPath = path.join(current, entry.name);
            const relative = path.relative(root, fullPath);
            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1);
            }
            else {
                out.push(relative);
            }
        }
    }
    await walk(root, 0);
    return out.sort();
}
//# sourceMappingURL=files.js.map