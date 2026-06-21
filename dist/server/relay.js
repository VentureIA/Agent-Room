import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { z } from "zod";
import { AgentRoomStore } from "../core/storage.js";
import { updateRoomRelayUrl, writeProjectLink } from "../core/registry.js";
import { answerSchema, connectProjectSchema, contractSchema, decisionSchema, fileActivitySchema, fileAlertConfirmationSchema, fileEditCheckSchema, questionSchema } from "../core/types.js";
const relayConnectProjectSchema = connectProjectSchema.omit({ path: true });
export async function startRelay(options = {}) {
    const port = options.port ?? 4317;
    if (port !== 0)
        await assertPortAvailable(port);
    const store = options.root ? await AgentRoomStore.requireLinkedProject(options.root) : await AgentRoomStore.requireLinkedProject();
    await store.initialize();
    const sessionToken = randomBytes(24).toString("base64url");
    const launchToken = randomBytes(24).toString("base64url");
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({
        server,
        path: "/ws",
        verifyClient: ({ origin, req }, done) => {
            done(isAllowedOrigin(origin) && hasSessionToken(req.headers.cookie, sessionToken));
        }
    });
    app.use(rejectInvalidHost);
    app.use(rejectExternalOrigins);
    app.use(attachSessionCookie(sessionToken, launchToken));
    app.use("/api", requireSession(sessionToken));
    app.use(express.json({ limit: "1mb" }));
    app.get("/api/state", async (_req, res, next) => {
        try {
            res.json(await store.getState());
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/projects", async (req, res, next) => {
        try {
            const project = await store.connectProject(relayConnectProjectSchema.parse(req.body));
            await broadcastState(store, wss);
            res.status(201).json(project);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/questions", async (req, res, next) => {
        try {
            const question = await store.askQuestion(questionSchema.parse(req.body));
            await broadcastState(store, wss);
            res.status(201).json(question);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/answers", async (req, res, next) => {
        try {
            const answer = await store.answerQuestion(answerSchema.parse(req.body));
            await broadcastState(store, wss);
            res.json(answer);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/decisions", async (req, res, next) => {
        try {
            const decision = await store.recordDecision(decisionSchema.parse(req.body));
            await broadcastState(store, wss);
            res.status(201).json(decision);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/decisions/:id/status", async (req, res, next) => {
        try {
            const input = z
                .object({
                status: z.enum(["approved", "rejected", "applied"]),
                approvedBy: z.string().optional()
            })
                .parse(req.body);
            const decision = await store.updateDecisionStatus({
                decisionId: req.params.id,
                status: input.status,
                approvedBy: input.approvedBy
            });
            await broadcastState(store, wss);
            res.json(decision);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/contracts", async (req, res, next) => {
        try {
            const contract = await store.publishContract(contractSchema.parse(req.body));
            await broadcastState(store, wss);
            res.status(201).json(contract);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/contracts/:id/status", async (req, res, next) => {
        try {
            const input = z.object({ status: z.enum(["draft", "active", "deprecated"]) }).parse(req.body);
            const contract = await store.updateContractStatus({ contractId: req.params.id, status: input.status });
            await broadcastState(store, wss);
            res.json(contract);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/access-requests/:id/status", async (req, res, next) => {
        try {
            const input = z.object({ status: z.enum(["approved", "denied"]) }).parse(req.body);
            const request = await store.updateAccessRequestStatus({ accessRequestId: req.params.id, status: input.status });
            await broadcastState(store, wss);
            res.json(request);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/file-activity", async (req, res, next) => {
        try {
            const activity = await store.publishFileActivity(fileActivitySchema.parse(req.body));
            await broadcastState(store, wss);
            res.status(201).json(activity);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/file-alerts/check", async (req, res, next) => {
        try {
            const currentProject = await store.getCurrentProject();
            const result = await store.checkFileBeforeEditForProject(currentProject.id, fileEditCheckSchema.parse(req.body));
            await broadcastState(store, wss);
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/file-alerts", async (_req, res, next) => {
        try {
            const currentProject = await store.getCurrentProject();
            res.json(await store.listFileAlertsForProject(currentProject.id));
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/file-alerts/:id/confirm", async (req, res, next) => {
        try {
            const currentProject = await store.getCurrentProject();
            const alert = await store.confirmFileAlertForProject(currentProject.id, {
                alertId: String(req.params.id ?? ""),
                ...fileAlertConfirmationSchema.parse(req.body)
            });
            await broadcastState(store, wss);
            res.json(alert);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/files", async (_req, res, next) => {
        try {
            res.json({ files: await store.listVisibleFiles() });
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/files/read", async (req, res, next) => {
        try {
            const relativePath = String(req.query.path ?? "");
            const content = await store.readAllowedProjectFile(relativePath);
            res.type("text/plain").send(content);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/summary", async (_req, res, next) => {
        try {
            const state = await store.getState();
            res.json({ summary: state.summary });
        }
        catch (error) {
            next(error);
        }
    });
    app.use("/api", (_req, res) => {
        res.status(404).json({ error: "AgentRoom API route not found." });
    });
    const uiDir = await resolveUiDir();
    if (await exists(uiDir)) {
        app.use(express.static(uiDir));
        app.get(/.*/, (_req, res) => res.sendFile(path.join(uiDir, "index.html")));
    }
    else {
        app.get("/", (_req, res) => {
            res.type("html").send(`
        <main style="font-family: sans-serif; max-width: 720px; margin: 64px auto; line-height: 1.5">
          <h1>AgentRoom relay is running</h1>
          <p>Run <code>npm run build</code> to build the dashboard UI, then restart <code>agentroom --no-open</code>.</p>
          <p>API: <a href="/api/state">/api/state</a></p>
        </main>
      `);
        });
    }
    app.use((error, _req, res, next) => {
        void next;
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(400).json({ error: message });
    });
    wss.on("connection", async (socket) => {
        socket.send(JSON.stringify({ type: "state", state: await store.getState() }));
    });
    const actualPort = await listen(server, port).catch((error) => {
        wss.close();
        server.close();
        throw error;
    });
    const url = `http://127.0.0.1:${actualPort}/?agentroom_token=${launchToken}`;
    const relayOrigin = `http://127.0.0.1:${actualPort}/`;
    const room = await store.initialize();
    const updatedRecord = await updateRoomRelayUrl(room.id, relayOrigin);
    if (updatedRecord)
        await writeProjectLink(store.projectRoot, updatedRecord);
    return { url, server, store };
}
function attachSessionCookie(sessionToken, launchToken) {
    let launchTokenUsed = false;
    return (req, res, next) => {
        const presentedToken = typeof req.query.agentroom_token === "string" ? req.query.agentroom_token : undefined;
        if (!req.path.startsWith("/api") && presentedToken === launchToken && !launchTokenUsed) {
            launchTokenUsed = true;
            res.cookie("agentroom_session", sessionToken, {
                httpOnly: true,
                sameSite: "strict",
                secure: false
            });
        }
        next();
    };
}
function requireSession(token) {
    return (req, res, next) => {
        if (hasSessionToken(req.headers.cookie, token)) {
            next();
            return;
        }
        res.status(401).json({ error: "AgentRoom session required. Open the local dashboard first." });
    };
}
function hasSessionToken(cookieHeader, token) {
    return (cookieHeader ?? "")
        .split(";")
        .map((part) => part.trim())
        .includes(`agentroom_session=${token}`);
}
function rejectExternalOrigins(req, res, next) {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
        next();
        return;
    }
    res.status(403).json({ error: "AgentRoom only accepts local dashboard requests." });
}
function rejectInvalidHost(req, res, next) {
    const host = req.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        next();
        return;
    }
    res.status(403).json({ error: "AgentRoom only accepts local host requests." });
}
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    try {
        const host = new URL(origin).hostname;
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
            return true;
        }
    }
    catch {
        return false;
    }
    return false;
}
async function listen(server, port) {
    await new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
    });
    const address = server.address();
    return typeof address === "object" && address ? address.port : port;
}
async function assertPortAvailable(port) {
    const probe = createServer();
    try {
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                probe.off("listening", onListening);
                reject(error);
            };
            const onListening = () => {
                probe.off("error", onError);
                resolve();
            };
            probe.once("error", onError);
            probe.once("listening", onListening);
            probe.listen(port, "127.0.0.1");
        });
    }
    finally {
        await new Promise((resolve) => {
            if (!probe.listening) {
                resolve();
                return;
            }
            probe.close(() => resolve());
        });
    }
}
async function broadcastState(store, wss) {
    if (!wss)
        return;
    const payload = JSON.stringify({ type: "state", state: await store.getState() });
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN)
            client.send(payload);
    }
}
async function resolveUiDir() {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const builtUi = path.resolve(moduleDir, "..", "ui");
    if (path.basename(path.dirname(moduleDir)) === "dist" && (await exists(path.join(builtUi, "index.html"))))
        return builtUi;
    return path.resolve(moduleDir, "..", "..", "dist", "ui");
}
async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=relay.js.map