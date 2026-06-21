import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSafeDirectory, readJson, writeJson, exists } from "./files.js";
import type { Room } from "./types.js";

export type RoomRecord = {
  id: string;
  name: string;
  inviteCode: string;
  roomDir: string;
  relayUrl?: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type ProjectRoomLink = {
  roomId: string;
  inviteCode: string;
  roomDir?: string;
  mode?: "local" | "remote";
  relayUrl?: string;
  dashboardUrl?: string;
  projectId?: string;
  projectToken?: string;
  linkedAt: string;
};

type RegistryFile = {
  rooms: RoomRecord[];
};

export function getAgentRoomHome(): string {
  return path.resolve(process.env.AGENTROOM_HOME ?? path.join(os.homedir(), ".agentroom"));
}

export function getProjectAgentRoomDir(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".agentroom");
}

export function getProjectLinkPath(projectRoot: string): string {
  return path.join(getProjectAgentRoomDir(projectRoot), "room-link.json");
}

export function getRegistryPath(home = getAgentRoomHome()): string {
  return path.join(home, "rooms.json");
}

export async function loadRegistry(home = getAgentRoomHome()): Promise<RegistryFile> {
  return (await readJson<RegistryFile>(getRegistryPath(home))) ?? { rooms: [] };
}

export async function saveRegistry(registry: RegistryFile, home = getAgentRoomHome()): Promise<void> {
  const rooms = registry.rooms
    .filter((room, index, all) => all.findIndex((candidate) => candidate.id === room.id) === index)
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  await writeJson(getRegistryPath(home), { rooms });
}

export async function registerRoom(room: Room, roomDir: string, relayUrl?: string, home = getAgentRoomHome()): Promise<RoomRecord> {
  const resolvedRoomDir = path.resolve(roomDir);
  assertInsideHome(resolvedRoomDir, home);
  await ensureSafeDirectory(resolvedRoomDir);
  if (!(await isRealInsideHome(resolvedRoomDir, home))) {
    throw new Error(`AgentRoom room directory must resolve inside ${path.resolve(home)}.`);
  }
  const registry = await loadRegistry(home);
  const existing = registry.rooms.find((record) => record.id === room.id);
  const record: RoomRecord = {
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

export async function updateRoomRelayUrl(roomId: string, relayUrl: string, home = getAgentRoomHome()): Promise<RoomRecord | undefined> {
  const registry = await loadValidRegistry(home);
  const room = registry.rooms.find((record) => record.id === roomId);
  if (!room) return undefined;
  room.relayUrl = relayUrl;
  room.lastOpenedAt = new Date().toISOString();
  await saveRegistry(registry, home);
  return room;
}

export async function findRoomByInvite(inviteCode: string, home = getAgentRoomHome()): Promise<RoomRecord | undefined> {
  const registry = await loadValidRegistry(home);
  return registry.rooms.find((room) => room.inviteCode === inviteCode);
}

export async function findRoomById(roomId: string, home = getAgentRoomHome()): Promise<RoomRecord | undefined> {
  const registry = await loadValidRegistry(home);
  return registry.rooms.find((room) => room.id === roomId);
}

export async function readProjectLink(projectRoot: string): Promise<ProjectRoomLink | undefined> {
  return readJson<ProjectRoomLink>(getProjectLinkPath(projectRoot));
}

export async function writeProjectLink(projectRoot: string, record: RoomRecord): Promise<ProjectRoomLink> {
  const link: ProjectRoomLink = {
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

export async function writeRemoteProjectLink(
  projectRoot: string,
  input: {
    roomId: string;
    inviteCode: string;
    relayUrl: string;
    dashboardUrl?: string;
    projectId: string;
    projectToken: string;
  }
): Promise<ProjectRoomLink> {
  const link: ProjectRoomLink = {
    mode: "remote",
    roomId: input.roomId,
    inviteCode: input.inviteCode,
    relayUrl: normalizeRelayUrl(input.relayUrl),
    dashboardUrl: input.dashboardUrl,
    projectId: input.projectId,
    projectToken: input.projectToken,
    linkedAt: new Date().toISOString()
  };
  await writeJson(getProjectLinkPath(projectRoot), link);
  return link;
}

export async function resolveLinkedRoom(projectRoot: string, home = getAgentRoomHome()): Promise<RoomRecord | undefined> {
  const link = await readProjectLink(projectRoot);
  if (!link) return undefined;
  if (link.mode === "remote" || (link.relayUrl && link.projectToken)) return undefined;
  if (!link.roomDir) return undefined;
  const registered = await findRoomById(link.roomId, home);
  assertInsideHome(link.roomDir, home);
  const fallback: RoomRecord = {
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

function normalizeRelayUrl(relayUrl: string): string {
  const parsed = new URL(relayUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export async function ensureRoomDirectories(roomDir: string): Promise<void> {
  await ensureSafeDirectory(roomDir);
  await ensureSafeDirectory(path.join(roomDir, "contracts"));
  await ensureSafeDirectory(path.join(roomDir, "summaries"));
}

export async function hasProjectLink(projectRoot: string): Promise<boolean> {
  return exists(getProjectLinkPath(projectRoot));
}

function assertInsideHome(roomDir: string, home: string): void {
  if (!isInsideHome(roomDir, home)) {
    throw new Error(`AgentRoom room directory must be inside ${path.resolve(home)}.`);
  }
}

function isInsideHome(roomDir: string, home: string): boolean {
  const relative = path.relative(path.resolve(home), path.resolve(roomDir));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loadValidRegistry(home: string): Promise<RegistryFile> {
  const registry = await loadRegistry(home);
  const rooms: RoomRecord[] = [];
  for (const room of registry.rooms) {
    if (await isValidRoomRecord(room, home)) rooms.push(room);
  }
  if (rooms.length !== registry.rooms.length) await saveRegistry({ rooms }, home);
  return { rooms };
}

async function isValidRoomRecord(record: RoomRecord, home: string): Promise<boolean> {
  if (!isInsideHome(record.roomDir, home)) return false;
  if (!(await isRealInsideHome(record.roomDir, home))) return false;
  const manifest = await readJson<Room>(path.join(record.roomDir, "room.json"));
  return manifest?.id === record.id && manifest.inviteCode === record.inviteCode;
}

async function isRealInsideHome(roomDir: string, home: string): Promise<boolean> {
  try {
    const [realHome, realRoomDir] = await Promise.all([fs.realpath(home), fs.realpath(roomDir)]);
    const relative = path.relative(realHome, realRoomDir);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}
