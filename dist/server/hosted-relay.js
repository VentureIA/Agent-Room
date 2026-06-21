import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { ensureSafeDirectory, exists, readJson, writeJson } from "../core/files.js";
import { createId } from "../core/ids.js";
import { AgentRoomStore } from "../core/storage.js";
import { answerSchema, contractSchema, decisionSchema } from "../core/types.js";
const remoteProjectSchema = z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    agentKind: z.string().default("Codex"),
    humanOwner: z.string().default("Human owner"),
    path: z.string().optional(),
    stack: z.array(z.string()).default([])
});
export async function startHostedRelay(options = {}) {
    const port = options.port ?? Number(process.env.PORT ?? 4318);
    const host = options.host ?? process.env.HOST ?? "0.0.0.0";
    const dataDir = path.resolve(options.dataDir ?? process.env.AGENTROOM_RELAY_DATA_DIR ?? path.join(process.cwd(), ".agentroom-relay"));
    const adminToken = options.adminToken ?? process.env.AGENTROOM_RELAY_ADMIN_TOKEN;
    const allowOpenRoomCreate = options.allowOpenRoomCreate ?? process.env.AGENTROOM_RELAY_ALLOW_OPEN_CREATE === "true";
    await ensureSafeDirectory(dataDir);
    await ensureSafeDirectory(path.join(dataDir, "rooms"));
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server, path: "/ws" });
    app.use(express.json({ limit: "1mb" }));
    app.get("/healthz", (_req, res) => res.json({ ok: true, service: "agentroom-relay" }));
    app.post("/api/rooms", requireAdmin(adminToken, allowOpenRoomCreate), async (req, res, next) => {
        try {
            const projectInput = remoteProjectSchema.parse(req.body.project);
            const roomDir = path.join(dataDir, "rooms", createId("room"));
            const store = new AgentRoomStore(dataDir, { roomDir });
            const room = await store.initialize();
            const project = await store.connectRemoteProject(projectInput);
            const auth = await createRoomAuth(roomDir, room.id, room.inviteCode, project.id);
            await broadcastRoomState(store, wss);
            res.status(201).json({ room, project, projectToken: findTokenForProject(auth, project.id) });
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/join", async (req, res, next) => {
        try {
            const input = z.object({ inviteCode: z.string(), project: remoteProjectSchema }).parse(req.body);
            const roomDir = await findRoomDirByInvite(dataDir, input.inviteCode);
            if (!roomDir) {
                res.status(404).json({ error: `Invite code not found: ${input.inviteCode}` });
                return;
            }
            const store = new AgentRoomStore(dataDir, { roomDir });
            const room = await store.readExistingRoom();
            const project = await store.connectRemoteProject(input.project);
            const auth = await addProjectToken(roomDir, room.id, room.inviteCode, project.id);
            await broadcastRoomState(store, wss);
            res.status(201).json({ room, project, projectToken: findTokenForProject(auth, project.id) });
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/rooms/:roomId/state", requireProject(dataDir), async (req, res, next) => {
        try {
            res.json(await requestContext(req).store.getState());
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/rooms/:roomId/current-project", requireProject(dataDir), async (req, res) => {
        res.json(requestContext(req).project);
    });
    app.post("/api/rooms/:roomId/questions", requireProject(dataDir), async (req, res, next) => {
        try {
            const input = z
                .object({
                toProjectId: z.string(),
                topic: z.string().min(1),
                question: z.string().min(1),
                impact: z.string().default("Needs clarification before integration work continues."),
                urgency: z.enum(["low", "normal", "blocking"]).default("normal")
            })
                .parse(req.body);
            const context = requestContext(req);
            const question = await context.store.askQuestion({
                fromProjectId: context.project.id,
                toProjectId: input.toProjectId,
                topic: input.topic,
                question: input.question,
                impact: input.impact,
                urgency: input.urgency
            });
            await broadcastRoomState(context.store, wss);
            res.status(201).json(question);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/answers", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestContext(req);
            const answer = await context.store.answerQuestionForProject(context.project.id, answerSchema.parse(req.body));
            await broadcastRoomState(context.store, wss);
            res.json(answer);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/decisions", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestContext(req);
            const decision = await context.store.recordDecision(decisionSchema.parse(req.body));
            await broadcastRoomState(context.store, wss);
            res.status(201).json(decision);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/contracts", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestContext(req);
            const contract = await context.store.publishContract(contractSchema.parse(req.body));
            await broadcastRoomState(context.store, wss);
            res.status(201).json(contract);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/access-requests", requireProject(dataDir), async (req, res, next) => {
        try {
            const input = z.object({ toProjectId: z.string(), path: z.string(), reason: z.string(), scope: z.literal("read-only").default("read-only") }).parse(req.body);
            const context = requestContext(req);
            const request = await context.store.requestAccess({
                fromProjectId: context.project.id,
                toProjectId: input.toProjectId,
                path: input.path,
                reason: input.reason,
                scope: input.scope
            });
            await broadcastRoomState(context.store, wss);
            res.status(201).json(request);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/test-results", requireProject(dataDir), async (req, res, next) => {
        try {
            const input = z
                .object({
                status: z.enum(["passed", "failed", "skipped"]),
                command: z.string(),
                summary: z.string(),
                affects: z.array(z.string()).default([])
            })
                .parse(req.body);
            const context = requestContext(req);
            const message = await context.store.reportTestResultForProject(context.project.id, input);
            await broadcastRoomState(context.store, wss);
            res.status(201).json(message);
        }
        catch (error) {
            next(error);
        }
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "AgentRoom hosted relay route not found." }));
    app.use((error, _req, res, next) => {
        void next;
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(400).json({ error: message });
    });
    wss.on("connection", async (socket, req) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const roomId = url.searchParams.get("roomId");
        const token = url.searchParams.get("token");
        if (!roomId || !token) {
            socket.close();
            return;
        }
        const context = await resolveProjectContext(dataDir, roomId, token);
        if (!context) {
            socket.close();
            return;
        }
        socket.roomId = roomId;
        socket.send(JSON.stringify({ type: "state", roomId, state: await context.store.getState() }));
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
    });
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    return { url: `http://${host}:${actualPort}`, server };
}
function requireAdmin(adminToken, allowOpenRoomCreate) {
    return (req, res, next) => {
        if ((allowOpenRoomCreate && !adminToken) || bearerToken(req) === adminToken) {
            next();
            return;
        }
        res.status(401).json({ error: "AgentRoom relay admin token required." });
    };
}
function requireProject(dataDir) {
    return async (req, res, next) => {
        const roomId = String(req.params.roomId ?? "");
        const context = await resolveProjectContext(dataDir, roomId, bearerToken(req));
        if (!context) {
            res.status(401).json({ error: "AgentRoom project token required." });
            return;
        }
        req.agentroom = context;
        next();
    };
}
async function resolveProjectContext(dataDir, roomId, token) {
    if (!token)
        return undefined;
    const roomDir = await findRoomDirById(dataDir, roomId);
    if (!roomDir)
        return undefined;
    const auth = await readRoomAuth(roomDir);
    if (!auth)
        return undefined;
    const projectId = auth.projectTokens[token];
    if (!projectId)
        return undefined;
    const store = new AgentRoomStore(dataDir, { roomDir });
    const state = await store.getState();
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project)
        return undefined;
    return { store, project };
}
async function createRoomAuth(roomDir, roomId, inviteCode, projectId) {
    const token = createToken();
    const auth = { roomId, inviteCode, projectTokens: { [token]: projectId } };
    await writeRoomAuth(roomDir, auth);
    return auth;
}
async function addProjectToken(roomDir, roomId, inviteCode, projectId) {
    const auth = (await readRoomAuth(roomDir)) ?? { roomId, inviteCode, projectTokens: {} };
    const existingToken = findTokenForProject(auth, projectId, false);
    if (existingToken)
        return auth;
    auth.projectTokens[createToken()] = projectId;
    await writeRoomAuth(roomDir, auth);
    return auth;
}
async function findRoomDirByInvite(dataDir, inviteCode) {
    const roomsDir = path.join(dataDir, "rooms");
    if (!(await exists(roomsDir)))
        return undefined;
    const entries = await fs.readdir(roomsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const roomDir = path.join(roomsDir, entry.name);
        const auth = await readRoomAuth(roomDir);
        if (auth?.inviteCode === inviteCode)
            return roomDir;
    }
    return undefined;
}
async function findRoomDirById(dataDir, roomId) {
    const roomsDir = path.join(dataDir, "rooms");
    if (!(await exists(roomsDir)))
        return undefined;
    const entries = await fs.readdir(roomsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const roomDir = path.join(roomsDir, entry.name);
        const auth = await readRoomAuth(roomDir);
        if (auth?.roomId === roomId)
            return roomDir;
    }
    return undefined;
}
async function readRoomAuth(roomDir) {
    return readJson(path.join(roomDir, "auth.json"));
}
async function writeRoomAuth(roomDir, auth) {
    await writeJson(path.join(roomDir, "auth.json"), auth);
}
function findTokenForProject(auth, projectId, required = true) {
    const entry = Object.entries(auth.projectTokens).find(([, candidateProjectId]) => candidateProjectId === projectId);
    if (!entry) {
        if (!required)
            return "";
        throw new Error(`No project token found for ${projectId}.`);
    }
    return entry[0];
}
async function broadcastRoomState(store, wss) {
    const state = await store.getState();
    const payload = JSON.stringify({ type: "state", roomId: state.room.id, state });
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN && client.roomId === state.room.id)
            client.send(payload);
    }
}
function bearerToken(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return undefined;
    return header.slice("Bearer ".length);
}
function createToken() {
    return `art_${randomBytes(24).toString("base64url")}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startHostedRelay()
        .then(({ url }) => {
        console.log(`AgentRoom hosted relay is running: ${url}`);
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(message);
        process.exit(1);
    });
}
function requestContext(req) {
    return req.agentroom;
}
//# sourceMappingURL=hosted-relay.js.map