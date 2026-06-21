import { promises as fs } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { detectProject } from "./detect.js";
import { exists, listFiles, writeJson } from "./files.js";
import { createId, nowIso, slugify } from "./ids.js";
import { defaultPermissionsMarkdown, renderProjectCard } from "./project-card.js";
import { buildHumanSummary } from "./summary.js";
export class AgentRoomStore {
    projectRoot;
    agentroomDir;
    db;
    constructor(projectRoot = process.cwd()) {
        this.projectRoot = path.resolve(projectRoot);
        this.agentroomDir = path.join(this.projectRoot, ".agentroom");
    }
    async initialize() {
        await fs.mkdir(path.join(this.agentroomDir, "contracts"), { recursive: true });
        await fs.mkdir(path.join(this.agentroomDir, "summaries"), { recursive: true });
        const db = this.openDb();
        this.ensureSchema(db);
        const existing = db.prepare("select * from rooms limit 1").get();
        if (existing)
            return mapRoom(existing);
        const room = {
            id: createId("room"),
            name: path.basename(this.projectRoot),
            inviteCode: `ar_${createId("invite").replace("invite_", "")}`,
            createdAt: nowIso()
        };
        db.prepare("insert into rooms (id, name, invite_code, created_at) values (?, ?, ?, ?)").run(room.id, room.name, room.inviteCode, room.createdAt);
        await this.writeRoomManifest(room);
        return room;
    }
    async connectProject(input) {
        const room = await this.initialize();
        const projectPath = path.resolve(input.path ?? this.projectRoot);
        const detection = await detectProject(projectPath);
        const project = {
            id: createId("project"),
            name: input.name ?? detection.name,
            path: projectPath,
            role: input.role ?? detection.role,
            stack: detection.stack,
            agentKind: input.agentKind ?? detection.agentHints[0] ?? "Codex",
            humanOwner: input.humanOwner ?? "Human owner",
            createdAt: nowIso()
        };
        const db = this.openDb();
        db.prepare("insert into projects (id, name, path, role, stack_json, agent_kind, human_owner, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(project.id, project.name, project.path, project.role, JSON.stringify(project.stack), project.agentKind, project.humanOwner, project.createdAt);
        const agent = {
            id: createId("agent"),
            projectId: project.id,
            name: `${project.agentKind} for ${project.name}`,
            kind: project.agentKind,
            status: "active"
        };
        db.prepare("insert into agents (id, project_id, name, kind, status) values (?, ?, ?, ?, ?)").run(agent.id, agent.projectId, agent.name, agent.kind, agent.status);
        await fs.writeFile(path.join(this.agentroomDir, "project-card.md"), renderProjectCard(project), "utf8");
        const permissionsPath = path.join(this.agentroomDir, "permissions.md");
        if (!(await exists(permissionsPath))) {
            await fs.writeFile(permissionsPath, defaultPermissionsMarkdown(), "utf8");
        }
        await this.appendEvent(room.id, agent.id, "FYI", { event: "project_connected", projectId: project.id });
        return project;
    }
    async getState() {
        const room = await this.initialize();
        const db = this.openDb();
        const state = {
            room,
            projects: db.prepare("select * from projects order by created_at").all().map(mapProject),
            agents: db.prepare("select * from agents order by name").all().map(mapAgent),
            messages: db.prepare("select * from messages order by created_at desc limit 100").all().map(mapMessage),
            questions: db.prepare("select * from questions order by created_at desc").all().map(mapQuestion),
            decisions: db.prepare("select * from decisions order by created_at desc").all().map(mapDecision),
            contracts: db.prepare("select * from contracts order by id").all().map(mapContract),
            accessRequests: db.prepare("select * from access_requests order by created_at desc").all().map(mapAccessRequest),
            summary: ""
        };
        state.summary = buildHumanSummary(state);
        await fs.writeFile(path.join(this.agentroomDir, "summaries", "latest.md"), state.summary, "utf8");
        return state;
    }
    async askQuestion(input) {
        const room = await this.initialize();
        const question = {
            id: createId("q"),
            roomId: room.id,
            status: "open",
            createdAt: nowIso(),
            ...input
        };
        this.openDb()
            .prepare("insert into questions (id, room_id, from_project_id, to_project_id, topic, question, impact, urgency, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(question.id, question.roomId, question.fromProjectId, question.toProjectId, question.topic, question.question, question.impact, question.urgency, question.status, question.createdAt);
        await this.appendJsonl("questions.jsonl", question);
        return question;
    }
    async answerQuestion(input) {
        const answeredAt = nowIso();
        this.openDb()
            .prepare("update questions set status = 'answered', answer = ?, suggested_resolution = ?, confidence = ?, answered_at = ? where id = ?")
            .run(input.answer, input.suggestedResolution ?? null, input.confidence, answeredAt, input.questionId);
        const question = this.openDb().prepare("select * from questions where id = ?").get(input.questionId);
        if (!question)
            throw new Error(`Question not found: ${input.questionId}`);
        return mapQuestion(question);
    }
    async recordDecision(input) {
        const room = await this.initialize();
        const decision = { id: createId("d"), roomId: room.id, createdAt: nowIso(), ...input };
        this.openDb()
            .prepare("insert into decisions (id, room_id, title, reason, status, approved_by_json, affects_json, risk, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(decision.id, decision.roomId, decision.title, decision.reason, decision.status, JSON.stringify(decision.approvedBy), JSON.stringify(decision.affects), decision.risk, decision.createdAt);
        await this.writeDecisionsMarkdown();
        return decision;
    }
    async publishContract(input) {
        const contract = { id: input.id ?? createId("contract"), ...input };
        this.openDb()
            .prepare("insert or replace into contracts (id, provider_project_id, consumer_project_id, version, payload_json, status) values (?, ?, ?, ?, ?, ?)")
            .run(contract.id, contract.providerProjectId, contract.consumerProjectId, contract.version, JSON.stringify({
            resources: contract.resources,
            breakingChangesRequireHumanApproval: contract.breakingChangesRequireHumanApproval
        }), contract.status);
        await writeJson(path.join(this.agentroomDir, "contracts", `${slugify(contract.id)}.json`), contract);
        return contract;
    }
    async requestAccess(input) {
        const request = { id: createId("access"), status: "pending", createdAt: nowIso(), ...input };
        this.openDb()
            .prepare("insert into access_requests (id, from_project_id, to_project_id, path, reason, scope, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(request.id, request.fromProjectId, request.toProjectId, request.path, request.reason, request.scope, request.status, request.createdAt);
        return request;
    }
    async listVisibleFiles() {
        return listFiles(this.projectRoot);
    }
    close() {
        this.db?.close();
        this.db = undefined;
    }
    openDb() {
        if (this.db)
            return this.db;
        const dbPath = path.join(this.agentroomDir, "events.db");
        this.db = new Database(dbPath);
        this.ensureSchema(this.db);
        return this.db;
    }
    ensureSchema(db) {
        db.exec(`
      create table if not exists rooms (
        id text primary key,
        name text not null,
        invite_code text not null,
        created_at text not null
      );
      create table if not exists projects (
        id text primary key,
        name text not null,
        path text not null,
        role text not null,
        stack_json text not null,
        agent_kind text not null,
        human_owner text not null,
        created_at text not null
      );
      create table if not exists agents (
        id text primary key,
        project_id text not null,
        name text not null,
        kind text not null,
        status text not null
      );
      create table if not exists messages (
        id text primary key,
        room_id text not null,
        from_agent_id text not null,
        to_agent_id text,
        type text not null,
        payload_json text not null,
        created_at text not null
      );
      create table if not exists questions (
        id text primary key,
        room_id text not null,
        from_project_id text not null,
        to_project_id text not null,
        topic text not null,
        question text not null,
        impact text not null,
        urgency text not null,
        status text not null,
        answer text,
        suggested_resolution text,
        confidence text,
        created_at text not null,
        answered_at text
      );
      create table if not exists decisions (
        id text primary key,
        room_id text not null,
        title text not null,
        reason text not null,
        status text not null,
        approved_by_json text not null,
        affects_json text not null,
        risk text not null,
        created_at text not null
      );
      create table if not exists contracts (
        id text primary key,
        provider_project_id text not null,
        consumer_project_id text not null,
        version text not null,
        payload_json text not null,
        status text not null
      );
      create table if not exists access_requests (
        id text primary key,
        from_project_id text not null,
        to_project_id text not null,
        path text not null,
        reason text not null,
        scope text not null,
        status text not null,
        created_at text not null
      );
    `);
    }
    async appendEvent(roomId, fromAgentId, type, payload, toAgentId) {
        const message = {
            id: createId("msg"),
            roomId,
            fromAgentId,
            toAgentId,
            type,
            payload,
            createdAt: nowIso()
        };
        this.openDb()
            .prepare("insert into messages (id, room_id, from_agent_id, to_agent_id, type, payload_json, created_at) values (?, ?, ?, ?, ?, ?, ?)")
            .run(message.id, message.roomId, message.fromAgentId, message.toAgentId ?? null, message.type, JSON.stringify(message.payload), message.createdAt);
        await this.appendJsonl("events.jsonl", message);
    }
    async appendJsonl(fileName, value) {
        await fs.appendFile(path.join(this.agentroomDir, fileName), `${JSON.stringify(value)}\n`, "utf8");
    }
    async writeRoomManifest(room) {
        await writeJson(path.join(this.agentroomDir, "room.json"), room);
    }
    async writeDecisionsMarkdown() {
        const decisions = this.openDb().prepare("select * from decisions order by created_at desc").all().map(mapDecision);
        const body = [
            "# Decisions",
            "",
            ...decisions.flatMap((decision) => [
                `## ${decision.title}`,
                "",
                `Status: ${decision.status}`,
                `Approved by: ${decision.approvedBy.join(", ") || "Pending"}`,
                `Affects: ${decision.affects.join(", ") || "Not specified"}`,
                "",
                decision.reason,
                ""
            ])
        ].join("\n");
        await fs.writeFile(path.join(this.agentroomDir, "decisions.md"), body, "utf8");
    }
}
function parseJsonArray(value) {
    if (typeof value !== "string")
        return [];
    return JSON.parse(value);
}
function mapRoom(row) {
    return {
        id: String(row.id),
        name: String(row.name),
        inviteCode: String(row.invite_code),
        createdAt: String(row.created_at)
    };
}
function mapProject(row) {
    return {
        id: String(row.id),
        name: String(row.name),
        path: String(row.path),
        role: String(row.role),
        stack: parseJsonArray(row.stack_json),
        agentKind: String(row.agent_kind),
        humanOwner: String(row.human_owner),
        createdAt: String(row.created_at)
    };
}
function mapAgent(row) {
    return {
        id: String(row.id),
        projectId: String(row.project_id),
        name: String(row.name),
        kind: String(row.kind),
        status: row.status === "active" || row.status === "idle" ? row.status : "unknown"
    };
}
function mapMessage(row) {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        fromAgentId: String(row.from_agent_id),
        toAgentId: row.to_agent_id ? String(row.to_agent_id) : undefined,
        type: row.type,
        payload: JSON.parse(String(row.payload_json)),
        createdAt: String(row.created_at)
    };
}
function mapQuestion(row) {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        fromProjectId: String(row.from_project_id),
        toProjectId: String(row.to_project_id),
        topic: String(row.topic),
        question: String(row.question),
        impact: String(row.impact),
        urgency: row.urgency === "blocking" || row.urgency === "low" ? row.urgency : "normal",
        status: row.status === "answered" || row.status === "closed" ? row.status : "open",
        answer: row.answer ? String(row.answer) : undefined,
        suggestedResolution: row.suggested_resolution ? String(row.suggested_resolution) : undefined,
        confidence: row.confidence === "low" || row.confidence === "high" ? row.confidence : row.confidence ? "medium" : undefined,
        createdAt: String(row.created_at),
        answeredAt: row.answered_at ? String(row.answered_at) : undefined
    };
}
function mapDecision(row) {
    return {
        id: String(row.id),
        roomId: String(row.room_id),
        title: String(row.title),
        reason: String(row.reason),
        status: row.status === "approved" || row.status === "rejected" || row.status === "applied" ? row.status : "proposed",
        approvedBy: parseJsonArray(row.approved_by_json),
        affects: parseJsonArray(row.affects_json),
        risk: String(row.risk),
        createdAt: String(row.created_at)
    };
}
function mapContract(row) {
    const payload = JSON.parse(String(row.payload_json));
    return {
        id: String(row.id),
        providerProjectId: String(row.provider_project_id),
        consumerProjectId: String(row.consumer_project_id),
        version: String(row.version),
        status: row.status === "active" || row.status === "deprecated" ? row.status : "draft",
        resources: payload.resources,
        breakingChangesRequireHumanApproval: payload.breakingChangesRequireHumanApproval
    };
}
function mapAccessRequest(row) {
    return {
        id: String(row.id),
        fromProjectId: String(row.from_project_id),
        toProjectId: String(row.to_project_id),
        path: String(row.path),
        reason: String(row.reason),
        scope: "read-only",
        status: row.status === "approved" || row.status === "denied" ? row.status : "pending",
        createdAt: String(row.created_at)
    };
}
//# sourceMappingURL=storage.js.map