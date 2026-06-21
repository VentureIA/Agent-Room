import { promises as fs } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
const sectionMap = {
    visible: "visible",
    "ask first": "askFirst",
    hidden: "hidden",
    "always redact": "alwaysRedact"
};
export function parsePermissions(markdown) {
    const policy = { visible: [], askFirst: [], hidden: [], alwaysRedact: [] };
    let active;
    for (const rawLine of markdown.split(/\r?\n/)) {
        const heading = rawLine.match(/^##\s+(.+)$/);
        if (heading) {
            active = sectionMap[heading[1]?.trim().toLowerCase() ?? ""];
            continue;
        }
        const item = rawLine.match(/^-\s+(.+)$/);
        if (item && active) {
            policy[active].push(item[1].trim());
        }
    }
    return policy;
}
export function classifyPath(relativePath, policy) {
    const normalized = relativePath.replaceAll(path.sep, "/");
    if (matchesAny(normalized, policy.hidden) || isAlwaysHiddenPath(normalized))
        return "hidden";
    if (matchesAny(normalized, policy.askFirst))
        return "ask-first";
    if (matchesAny(normalized, policy.visible))
        return "visible";
    return "hidden";
}
export async function readAllowedFile(root, relativePath, policy) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (classifyPath(normalized, policy) !== "visible") {
        throw new Error(`Access to ${normalized} is not visible by current AgentRoom permissions.`);
    }
    const resolved = path.resolve(root, normalized);
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(resolved)]);
    if (!isInsideRoot(realRoot, realTarget)) {
        throw new Error("Path escapes the project root.");
    }
    const content = await fs.readFile(realTarget, "utf8");
    return redactSecrets(content, policy.alwaysRedact);
}
export function isInsideRoot(root, candidatePath) {
    const relative = path.relative(path.resolve(root), path.resolve(candidatePath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function redactSecrets(content, terms) {
    let redacted = content
        .replace(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)(["']?)[^\s"']+/gi, "$1$2[REDACTED]")
        .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]+?-----END [^-]+PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
    for (const term of terms) {
        if (/api keys?|tokens?|passwords?|private keys?|customer data/i.test(term))
            continue;
        redacted = redacted.replace(new RegExp(escapeRegExp(term), "gi"), "[REDACTED]");
    }
    return redacted;
}
function matchesAny(relativePath, patterns) {
    return patterns.some((pattern) => minimatch(relativePath, pattern, { dot: true, nocase: false }));
}
function isAlwaysHiddenPath(relativePath) {
    return (/(^|\/)\.env/.test(relativePath) ||
        /(^|\/)(\.git|node_modules|vendor)(\/|$)/.test(relativePath) ||
        /(^|\/)(secrets?|private)(\/|$)/i.test(relativePath) ||
        /secret|private-key|credentials/i.test(relativePath));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=permissions.js.map