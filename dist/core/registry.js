import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSafeDirectory, readJson, writeJson, exists } from "./files.js";
export function getAgentRoomHome() {
    return path.resolve(process.env.AGENTROOM_HOME ?? path.join(os.homedir(), ".agentroom"));
}
export function getProjectAgentRoomDir(projectRoot) {
    return path.join(path.resolve(projectRoot), ".agentroom");
}
export function getProjectLinkPath(projectRoot) {
    return path.join(getProjectAgentRoomDir(projectRoot), "room-link.json");
}
export function getRegistryPath(home = getAgentRoomHome()) {
    return path.join(home, "rooms.json");
}
export async function loadRegistry(home = getAgentRoomHome()) {
    return (await readJson(getRegistryPath(home))) ?? { rooms: [] };
}
export async function saveRegistry(registry, home = getAgentRoomHome()) {
    const rooms = registry.rooms
        .filter((room, index, all) => all.findIndex((candidate) => candidate.id === room.id) === index)
        .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    await writeJson(getRegistryPath(home), { rooms });
}
export async function registerRoom(room, roomDir, relayUrl, home = getAgentRoomHome()) {
    const resolvedRoomDir = path.resolve(roomDir);
    assertInsideHome(resolvedRoomDir, home);
    await ensureSafeDirectory(resolvedRoomDir);
    if (!(await isRealInsideHome(resolvedRoomDir, home))) {
        throw new Error(`AgentRoom room directory must resolve inside ${path.resolve(home)}.`);
    }
    const registry = await loadRegistry(home);
    const existing = registry.rooms.find((record) => record.id === room.id);
    const record = {
        id: room.id,
        name: room.name,
        inviteCode: room.inviteCode,
        roomDir: resolvedRoomDir,
        relayUrl: relayUrl ?? existing?.relayUrl,
        createdAt: room.createdAt,
        lastOpenedAt: new Date().toISOString()
    };
    registry.rooms = [record, ...registry.rooms.filter((candidate) => candidate.id !== room.id)];
    await saveRegistry(registry, home);
    return record;
}
export async function updateRoomRelayUrl(roomId, relayUrl, home = getAgentRoomHome()) {
    const registry = await loadValidRegistry(home);
    const room = registry.rooms.find((record) => record.id === roomId);
    if (!room)
        return undefined;
    room.relayUrl = relayUrl;
    room.lastOpenedAt = new Date().toISOString();
    await saveRegistry(registry, home);
    return room;
}
export async function findRoomByInvite(inviteCode, home = getAgentRoomHome()) {
    const registry = await loadValidRegistry(home);
    return registry.rooms.find((room) => room.inviteCode === inviteCode);
}
export async function findRoomById(roomId, home = getAgentRoomHome()) {
    const registry = await loadValidRegistry(home);
    return registry.rooms.find((room) => room.id === roomId);
}
export async function readProjectLink(projectRoot) {
    return readJson(getProjectLinkPath(projectRoot));
}
export async function writeProjectLink(projectRoot, record) {
    const link = {
        mode: "local",
        roomId: record.id,
        inviteCode: record.inviteCode,
        roomDir: record.roomDir,
        relayUrl: record.relayUrl,
        linkedAt: new Date().toISOString()
    };
    await writeJson(getProjectLinkPath(projectRoot), link);
    return link;
}
export async function writeRemoteProjectLink(projectRoot, input) {
    const link = {
        mode: "remote",
        roomId: input.roomId,
        inviteCode: input.inviteCode,
        relayUrl: normalizeRelayUrl(input.relayUrl),
        projectId: input.projectId,
        projectToken: input.projectToken,
        linkedAt: new Date().toISOString()
    };
    await writeJson(getProjectLinkPath(projectRoot), link);
    return link;
}
export async function resolveLinkedRoom(projectRoot, home = getAgentRoomHome()) {
    const link = await readProjectLink(projectRoot);
    if (!link)
        return undefined;
    if (link.mode === "remote" || (link.relayUrl && link.projectToken))
        return undefined;
    if (!link.roomDir)
        return undefined;
    const registered = await findRoomById(link.roomId, home);
    assertInsideHome(link.roomDir, home);
    const fallback = {
        id: link.roomId,
        name: path.basename(path.dirname(link.roomDir)),
        inviteCode: link.inviteCode,
        roomDir: link.roomDir,
        relayUrl: link.relayUrl,
        createdAt: link.linkedAt,
        lastOpenedAt: link.linkedAt
    };
    return registered ?? ((await isValidRoomRecord(fallback, home)) ? fallback : undefined);
}
function normalizeRelayUrl(relayUrl) {
    const parsed = new URL(relayUrl);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
}
export async function ensureRoomDirectories(roomDir) {
    await ensureSafeDirectory(roomDir);
    await ensureSafeDirectory(path.join(roomDir, "contracts"));
    await ensureSafeDirectory(path.join(roomDir, "summaries"));
}
export async function hasProjectLink(projectRoot) {
    return exists(getProjectLinkPath(projectRoot));
}
function assertInsideHome(roomDir, home) {
    if (!isInsideHome(roomDir, home)) {
        throw new Error(`AgentRoom room directory must be inside ${path.resolve(home)}.`);
    }
}
function isInsideHome(roomDir, home) {
    const relative = path.relative(path.resolve(home), path.resolve(roomDir));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function loadValidRegistry(home) {
    const registry = await loadRegistry(home);
    const rooms = [];
    for (const room of registry.rooms) {
        if (await isValidRoomRecord(room, home))
            rooms.push(room);
    }
    if (rooms.length !== registry.rooms.length)
        await saveRegistry({ rooms }, home);
    return { rooms };
}
async function isValidRoomRecord(record, home) {
    if (!isInsideHome(record.roomDir, home))
        return false;
    if (!(await isRealInsideHome(record.roomDir, home)))
        return false;
    const manifest = await readJson(path.join(record.roomDir, "room.json"));
    return manifest?.id === record.id && manifest.inviteCode === record.inviteCode;
}
async function isRealInsideHome(roomDir, home) {
    try {
        const [realHome, realRoomDir] = await Promise.all([fs.realpath(home), fs.realpath(roomDir)]);
        const relative = path.relative(realHome, realRoomDir);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=registry.js.map