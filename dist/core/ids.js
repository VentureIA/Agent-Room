import { randomBytes } from "node:crypto";
export function createId(prefix) {
    return `${prefix}_${randomBytes(5).toString("base64url")}`;
}
export function nowIso() {
    return new Date().toISOString();
}
export function slugify(value) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}
//# sourceMappingURL=ids.js.map