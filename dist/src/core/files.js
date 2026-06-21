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
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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