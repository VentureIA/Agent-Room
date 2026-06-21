import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { AgentRoomStore } from "../core/storage.js";
import { parsePermissions, readAllowedFile } from "../core/permissions.js";
import { answerSchema, connectProjectSchema, contractSchema, decisionSchema, questionSchema } from "../core/types.js";
export async function startRelay(options = {}) {
    const port = options.port ?? 4317;
    const store = new AgentRoomStore(options.root);
    await store.initialize();
    const app = express();
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
            const project = await store.connectProject(connectProjectSchema.parse(req.body));
            await broadcastState(store, res.locals.wss);
            res.status(201).json(project);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/questions", async (req, res, next) => {
        try {
            const question = await store.askQuestion(questionSchema.parse(req.body));
            await broadcastState(store, res.locals.wss);
            res.status(201).json(question);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/answers", async (req, res, next) => {
        try {
            const answer = await store.answerQuestion(answerSchema.parse(req.body));
            await broadcastState(store, res.locals.wss);
            res.json(answer);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/decisions", async (req, res, next) => {
        try {
            const decision = await store.recordDecision(decisionSchema.parse(req.body));
            await broadcastState(store, res.locals.wss);
            res.status(201).json(decision);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/contracts", async (req, res, next) => {
        try {
            const contract = await store.publishContract(contractSchema.parse(req.body));
            await broadcastState(store, res.locals.wss);
            res.status(201).json(contract);
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
            const policy = await loadPolicy(store.agentroomDir);
            const content = await readAllowedFile(store.projectRoot, relativePath, policy);
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
    const uiDir = path.resolve("dist/ui");
    if (await exists(uiDir)) {
        app.use(express.static(uiDir));
        app.get("*", (_req, res) => res.sendFile(path.join(uiDir, "index.html")));
    }
    else {
        app.get("/", (_req, res) => {
            res.type("html").send(`
        <main style="font-family: sans-serif; max-width: 720px; margin: 64px auto; line-height: 1.5">
          <h1>AgentRoom relay is running</h1>
          <p>Run <code>npm run build</code> to build the dashboard UI, or use <code>npm run dev:ui</code> during development.</p>
          <p>API: <a href="/api/state">/api/state</a></p>
        </main>
      `);
        });
    }
    app.use((error, _req, res, _next) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(400).json({ error: message });
    });
    const server = app.listen(port);
    const wss = new WebSocketServer({ server, path: "/ws" });
    app.use((_req, res, next) => {
        res.locals.wss = wss;
        next();
    });
    wss.on("connection", async (socket) => {
        socket.send(JSON.stringify({ type: "state", state: await store.getState() }));
    });
    return { url: `http://localhost:${port}`, server, store };
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
async function loadPolicy(agentroomDir) {
    const markdown = await fs.readFile(path.join(agentroomDir, "permissions.md"), "utf8");
    return parsePermissions(markdown);
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