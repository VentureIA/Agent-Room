import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { ensureSafeDirectory, exists, readJson, writeJson } from "../core/files.js";
import { createId } from "../core/ids.js";
import { AgentRoomStore } from "../core/storage.js";
import { answerSchema, contractSchema, decisionSchema, fileActivitySchema, fileAlertConfirmationSchema, fileEditCheckSchema } from "../core/types.js";
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
    const dashboardSessions = new Map();
    app.set("trust proxy", true);
    app.use(express.json({ limit: "1mb" }));
    app.get("/healthz", (_req, res) => res.json({ ok: true, service: "agentroom-relay" }));
    app.get("/install.sh", (_req, res) => {
        res.type("text/x-shellscript").send(renderInstallScript());
    });
    app.get("/dashboard/:inviteCode", async (req, res, next) => {
        try {
            const roomDir = await findRoomDirByInvite(dataDir, req.params.inviteCode);
            if (!roomDir) {
                res.status(404).type("html").send(renderDashboardMessage("Room not found", "The invite code does not match a room on this relay."));
                return;
            }
            const auth = await requireRoomAuth(roomDir);
            const presentedToken = typeof req.query.token === "string" ? req.query.token : undefined;
            const existingSession = resolveDashboardSession(dashboardSessions, req.headers.cookie);
            if (existingSession?.roomId === auth.roomId) {
                await sendDashboardUi(res);
                return;
            }
            if (presentedToken === auth.dashboardToken) {
                const sessionToken = createDashboardSessionToken();
                dashboardSessions.set(sessionToken, { roomId: auth.roomId, createdAt: Date.now() });
                res.cookie("agentroom_dashboard_session", sessionToken, {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: isSecureRequest(req),
                    maxAge: 1000 * 60 * 60 * 24 * 14
                });
                res.redirect(`/dashboard/${auth.inviteCode}`);
                return;
            }
            res.status(401).type("html").send(renderDashboardMessage("Dashboard token required", "Open the dashboard link printed by AgentRoom connect --relay."));
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms", requireAdmin(adminToken, allowOpenRoomCreate), async (req, res, next) => {
        try {
            const projectInput = remoteProjectSchema.parse(req.body.project);
            const roomDir = path.join(dataDir, "rooms", createId("room"));
            const store = new AgentRoomStore(dataDir, { roomDir });
            const room = await store.initialize();
            const project = await store.connectRemoteProject(projectInput);
            const auth = await createRoomAuth(roomDir, room.id, room.inviteCode, project.id);
            await broadcastRoomState(store, wss);
            res.status(201).json({
                room,
                project,
                projectToken: findTokenForProject(auth, project.id),
                dashboardUrl: buildDashboardUrl(req, auth)
            });
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
        res.json(requestProjectContext(req).project);
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
            const context = requestProjectContext(req);
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
            const context = requestProjectContext(req);
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
            const context = requestProjectContext(req);
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
            const context = requestProjectContext(req);
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
            const context = requestProjectContext(req);
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
            const context = requestProjectContext(req);
            const message = await context.store.reportTestResultForProject(context.project.id, input);
            await broadcastRoomState(context.store, wss);
            res.status(201).json(message);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/file-activity", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestProjectContext(req);
            const activity = await context.store.publishFileActivityForProject(context.project.id, fileActivitySchema.parse(req.body));
            await broadcastRoomState(context.store, wss);
            res.status(201).json(activity);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/file-alerts/check", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestProjectContext(req);
            const result = await context.store.checkFileBeforeEditForProject(context.project.id, fileEditCheckSchema.parse(req.body));
            await broadcastRoomState(context.store, wss);
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/rooms/:roomId/file-alerts", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestProjectContext(req);
            res.json(await context.store.listFileAlertsForProject(context.project.id));
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/rooms/:roomId/file-alerts/:id/confirm", requireProject(dataDir), async (req, res, next) => {
        try {
            const context = requestProjectContext(req);
            const alert = await context.store.confirmFileAlertForProject(context.project.id, {
                alertId: String(req.params.id ?? ""),
                ...fileAlertConfirmationSchema.parse(req.body)
            });
            await broadcastRoomState(context.store, wss);
            res.json(alert);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/dashboard-info", requireDashboard(dataDir, dashboardSessions), async (req, res) => {
        const context = requestContext(req);
        res.json({
            mode: "remote",
            roomId: context.state.room.id,
            inviteCode: context.state.room.inviteCode
        });
    });
    app.get("/api/state", requireDashboard(dataDir, dashboardSessions), async (req, res, next) => {
        try {
            res.json(await requestContext(req).store.getState());
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/decisions/:id/status", requireDashboard(dataDir, dashboardSessions), async (req, res, next) => {
        try {
            const input = z
                .object({
                status: z.enum(["approved", "rejected", "applied"]),
                approvedBy: z.string().optional()
            })
                .parse(req.body);
            const context = requestContext(req);
            const decision = await context.store.updateDecisionStatus({
                decisionId: String(req.params.id ?? ""),
                status: input.status,
                approvedBy: input.approvedBy
            });
            await broadcastRoomState(context.store, wss);
            res.json(decision);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/contracts/:id/status", requireDashboard(dataDir, dashboardSessions), async (req, res, next) => {
        try {
            const input = z.object({ status: z.enum(["draft", "active", "deprecated"]) }).parse(req.body);
            const context = requestContext(req);
            const contract = await context.store.updateContractStatus({ contractId: String(req.params.id ?? ""), status: input.status });
            await broadcastRoomState(context.store, wss);
            res.json(contract);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/access-requests/:id/status", requireDashboard(dataDir, dashboardSessions), async (req, res, next) => {
        try {
            const input = z.object({ status: z.enum(["approved", "denied"]) }).parse(req.body);
            const context = requestContext(req);
            const request = await context.store.updateAccessRequestStatus({ accessRequestId: String(req.params.id ?? ""), status: input.status });
            await broadcastRoomState(context.store, wss);
            res.json(request);
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
        const dashboardSession = resolveDashboardSession(dashboardSessions, req.headers.cookie);
        const context = roomId && token
            ? await resolveProjectContext(dataDir, roomId, token)
            : dashboardSession
                ? await resolveDashboardContext(dataDir, dashboardSession.roomId)
                : undefined;
        if (!context) {
            socket.close();
            return;
        }
        const state = await context.store.getState();
        socket.roomId = state.room.id;
        socket.send(JSON.stringify({ type: "state", roomId: state.room.id, state }));
    });
    const uiDir = await resolveUiDir();
    if (await exists(uiDir)) {
        app.use(express.static(uiDir));
        app.get(/.*/, async (_req, res) => {
            await sendDashboardUi(res);
        });
    }
    else {
        app.get("/", (_req, res) => {
            res.type("html").send(renderDashboardMessage("AgentRoom relay is running", "Run npm run build to build the dashboard UI."));
        });
    }
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
function requireDashboard(dataDir, sessions) {
    return async (req, res, next) => {
        const session = resolveDashboardSession(sessions, req.headers.cookie);
        if (!session) {
            res.status(401).json({ error: "AgentRoom dashboard session required." });
            return;
        }
        const context = await resolveDashboardContext(dataDir, session.roomId);
        if (!context) {
            res.status(401).json({ error: "AgentRoom dashboard session is no longer valid." });
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
    return { store, project, state };
}
async function resolveDashboardContext(dataDir, roomId) {
    const roomDir = await findRoomDirById(dataDir, roomId);
    if (!roomDir)
        return undefined;
    const store = new AgentRoomStore(dataDir, { roomDir });
    const state = await store.getState();
    return { store, state };
}
async function createRoomAuth(roomDir, roomId, inviteCode, projectId) {
    const token = createToken();
    const auth = { roomId, inviteCode, projectTokens: { [token]: projectId }, dashboardToken: createDashboardToken() };
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
    const auth = await readJson(path.join(roomDir, "auth.json"));
    if (!auth)
        return undefined;
    if (!auth.dashboardToken) {
        auth.dashboardToken = createDashboardToken();
        await writeRoomAuth(roomDir, auth);
    }
    return auth;
}
async function writeRoomAuth(roomDir, auth) {
    await writeJson(path.join(roomDir, "auth.json"), auth);
}
async function requireRoomAuth(roomDir) {
    const auth = await readRoomAuth(roomDir);
    if (!auth)
        throw new Error(`AgentRoom room auth not found: ${roomDir}`);
    return auth;
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
function createDashboardToken() {
    return `ard_${randomBytes(24).toString("base64url")}`;
}
function createDashboardSessionToken() {
    return `ars_${randomBytes(24).toString("base64url")}`;
}
function resolveDashboardSession(sessions, cookieHeader) {
    const token = (cookieHeader ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("agentroom_dashboard_session="))
        ?.slice("agentroom_dashboard_session=".length);
    if (!token)
        return undefined;
    const session = sessions.get(token);
    if (!session)
        return undefined;
    if (Date.now() - session.createdAt > 1000 * 60 * 60 * 24 * 14) {
        sessions.delete(token);
        return undefined;
    }
    return session;
}
function buildDashboardUrl(req, auth) {
    const origin = `${isSecureRequest(req) ? "https" : req.protocol}://${req.get("host")}`;
    return `${origin}/dashboard/${auth.inviteCode}?token=${auth.dashboardToken}`;
}
function isSecureRequest(req) {
    return req.secure || req.headers["x-forwarded-proto"] === "https";
}
async function resolveUiDir() {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const builtUi = path.resolve(moduleDir, "..", "ui");
    if (path.basename(path.dirname(moduleDir)) === "dist" && (await exists(path.join(builtUi, "index.html"))))
        return builtUi;
    return path.resolve(moduleDir, "..", "..", "dist", "ui");
}
async function sendDashboardUi(res) {
    const uiDir = await resolveUiDir();
    if (await exists(path.join(uiDir, "index.html"))) {
        res.sendFile(path.join(uiDir, "index.html"));
        return;
    }
    res.type("html").send(renderDashboardMessage("AgentRoom relay is running", "Run npm run build to build the dashboard UI."));
}
function renderDashboardMessage(title, message) {
    return `<main style="font-family: sans-serif; max-width: 720px; margin: 64px auto; line-height: 1.5"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`;
}
function renderInstallScript() {
    return `${[
        "#!/bin/sh",
        "set -eu",
        "",
        'client="${1:-${AGENTROOM_CLIENT:-all}}"',
        'project_name="${2:-${AGENTROOM_NAME:-$(basename "$PWD")}}"',
        'package_spec="${AGENTROOM_PACKAGE:-agentroom-ai}"',
        'mcp_package_spec="${AGENTROOM_MCP_PACKAGE:-agentroom-ai}"',
        "",
        'case "$client" in',
        "  all|claude|codex) ;;",
        "  *)",
        '    echo "AgentRoom install error: client must be all, claude, or codex." >&2',
        '    echo "Example: curl -fsSL https://agent-room.venture-ia.com/install.sh | sh -s -- claude MyProject" >&2',
        "    exit 1",
        "    ;;",
        "esac",
        "",
        "if ! command -v node >/dev/null 2>&1; then",
        '  echo "AgentRoom install error: Node.js >=20.11 is required." >&2',
        '  echo "Install Node.js first, then run this command again." >&2',
        "  exit 1",
        "fi",
        "",
        "if ! command -v npm >/dev/null 2>&1; then",
        '  echo "AgentRoom install error: npm is required." >&2',
        '  echo "Install npm first, then run this command again." >&2',
        "  exit 1",
        "fi",
        "",
        'echo "Installing AgentRoom for $project_name ($client)..."',
        'npx -y "$package_spec" init "$client" --name "$project_name" --package "$mcp_package_spec"',
        'echo "AgentRoom install complete."'
    ].join("\n")}\n`;
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
    })[character] ?? character);
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
function requestProjectContext(req) {
    const context = requestContext(req);
    if (!context.project)
        throw new Error("AgentRoom project context required.");
    return context;
}
//# sourceMappingURL=hosted-relay.js.map