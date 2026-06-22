import { promises as fs } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { detectProject } from "./detect.js";
import { appendTextFile, ensureSafeDirectory, exists, listFiles, writeJson, writeTextFile } from "./files.js";
import { createId, nowIso, slugify } from "./ids.js";
import { classifyPath, parsePermissions, readAllowedFile } from "./permissions.js";
import { defaultPermissionsMarkdown, renderProjectCard } from "./project-card.js";
import {
  ensureRoomDirectories,
  getAgentRoomHome,
  getProjectAgentRoomDir,
  registerRoom,
  resolveLinkedRoom,
  writeProjectLink,
  type RoomRecord
} from "./registry.js";
import { buildHumanSummary } from "./summary.js";
import type {
  AccessRequest,
  Agent,
  Contract,
  Decision,
  FileActivity,
  FileAlert,
  FileEditCheck,
  Message,
  Project,
  ProjectSnapshot,
  ProjectSnapshotFile,
  Question,
  Room,
  RoomState
} from "./types.js";

type StoredRow = Record<string, unknown>;

export class AgentRoomStore {
  readonly projectRoot: string;
  readonly projectAgentRoomDir: string;
  readonly roomDir: string;
  readonly agentroomDir: string;
  private db?: Database.Database;

  constructor(projectRoot = process.cwd(), options: { roomDir?: string } = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.projectAgentRoomDir = getProjectAgentRoomDir(this.projectRoot);
    this.roomDir = path.resolve(options.roomDir ?? this.projectAgentRoomDir);
    this.agentroomDir = this.roomDir;
  }

  static async forLinkedProject(projectRoot = process.cwd()): Promise<AgentRoomStore> {
    const linkedRoom = await resolveLinkedRoom(projectRoot);
    return new AgentRoomStore(projectRoot, { roomDir: linkedRoom?.roomDir });
  }

  static async requireLinkedProject(projectRoot = process.cwd()): Promise<AgentRoomStore> {
    const linkedRoom = await resolveLinkedRoom(projectRoot);
    if (!linkedRoom) {
      throw new Error("This project is not connected to AgentRoom yet. Run agentroom connect or agentroom join <invite> first.");
    }
    return new AgentRoomStore(projectRoot, { roomDir: linkedRoom.roomDir });
  }

  static async createSharedRoom(
    projectRoot = process.cwd(),
    input: {
      name?: string;
      role?: string;
      agentKind?: string;
      humanOwner?: string;
      path?: string;
    } = {}
  ): Promise<{ store: AgentRoomStore; project: Project; room: Room; record: RoomRecord }> {
    const existingRoom = await resolveLinkedRoom(projectRoot);
    if (existingRoom) {
      const store = new AgentRoomStore(projectRoot, { roomDir: existingRoom.roomDir });
      const project = await store.connectProject(input);
      const room = await store.initialize();
      const record = await registerRoom(room, existingRoom.roomDir, existingRoom.relayUrl);
      await writeProjectLink(projectRoot, record);
      return { store, project, room, record };
    }

    const roomDir = path.join(getAgentRoomHome(), "rooms", createId("room"));
    const store = new AgentRoomStore(projectRoot, { roomDir });
    const room = await store.initialize();
    const record = await registerRoom(room, roomDir);
    await writeProjectLink(projectRoot, record);
    const project = await store.connectProject(input);
    return { store, project, room, record };
  }

  static async joinSharedRoom(
    projectRoot: string,
    record: RoomRecord,
    input: {
      name?: string;
      role?: string;
      agentKind?: string;
      humanOwner?: string;
      path?: string;
    } = {}
  ): Promise<{ store: AgentRoomStore; project: Project; room: Room }> {
    const store = new AgentRoomStore(projectRoot, { roomDir: record.roomDir });
    const room = await store.readExistingRoom();
    if (room.inviteCode !== record.inviteCode) {
      throw new Error(`Invite code ${record.inviteCode} does not match room ${room.inviteCode}.`);
    }
    await writeProjectLink(projectRoot, record);
    const project = await store.connectProject(input);
    return { store, project, room };
  }

  async initialize(): Promise<Room> {
    await ensureRoomDirectories(this.roomDir);
    await this.ensureDefaultPermissions();
    const db = this.openDb();
    this.ensureSchema(db);
    const existing = db.prepare("select * from rooms limit 1").get() as StoredRow | undefined;
    if (existing) return mapRoom(existing);

    const room: Room = {
      id: createId("room"),
      name: path.basename(this.projectRoot),
      inviteCode: `ar_${createId("invite").replace("invite_", "")}`,
      createdAt: nowIso()
    };
    db.prepare("insert into rooms (id, name, invite_code, created_at) values (?, ?, ?, ?)").run(
      room.id,
      room.name,
      room.inviteCode,
      room.createdAt
    );
    await this.writeRoomManifest(room);
    return room;
  }

  async readExistingRoom(): Promise<Room> {
    const dbPath = path.join(this.roomDir, "events.db");
    if (!(await exists(dbPath))) {
      throw new Error(`AgentRoom room does not exist or is not initialized: ${this.roomDir}`);
    }
    const db = this.openDb();
    this.ensureSchema(db);
    const existing = db.prepare("select * from rooms limit 1").get() as StoredRow | undefined;
    if (!existing) {
      throw new Error(`AgentRoom room has no room manifest: ${this.roomDir}`);
    }
    return mapRoom(existing);
  }

  async connectProject(input: {
    name?: string;
    role?: string;
    agentKind?: string;
    humanOwner?: string;
    path?: string;
  }): Promise<Project> {
    const room = await this.initialize();
    const projectPath = path.resolve(input.path ?? this.projectRoot);
    const existing = this.openDb().prepare("select * from projects where path = ? limit 1").get(projectPath) as StoredRow | undefined;
    if (existing) {
      const project = await this.updateExistingProject(mapProject(existing), input);
      await this.ensureProjectLocalFiles(project);
      return project;
    }

    const detection = await detectProject(projectPath);
    const project: Project = {
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
    db.prepare(
      "insert into projects (id, name, path, role, stack_json, agent_kind, human_owner, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      project.id,
      project.name,
      project.path,
      project.role,
      JSON.stringify(project.stack),
      project.agentKind,
      project.humanOwner,
      project.createdAt
    );

    const agent: Agent = {
      id: createId("agent"),
      projectId: project.id,
      name: `${project.agentKind} for ${project.name}`,
      kind: project.agentKind,
      status: "active"
    };
    db.prepare("insert into agents (id, project_id, name, kind, status) values (?, ?, ?, ?, ?)").run(
      agent.id,
      agent.projectId,
      agent.name,
      agent.kind,
      agent.status
    );

    const projectAgentRoomDir = getProjectAgentRoomDir(projectPath);
    await ensureSafeDirectory(projectAgentRoomDir);
    await writeTextFile(path.join(projectAgentRoomDir, "project-card.md"), renderProjectCard(project));
    await this.ensureDefaultPermissions(projectPath);
    await this.appendEvent(room.id, agent.id, "FYI", { event: "project_connected", projectId: project.id });
    return project;
  }

  async connectRemoteProject(input: {
    name: string;
    role?: string;
    agentKind?: string;
    humanOwner?: string;
    path?: string;
    stack?: string[];
  }): Promise<Project> {
    const room = await this.initialize();
    const projectPath = input.path ?? `remote://${slugify(input.name)}`;
    const existing = this.openDb().prepare("select * from projects where path = ? limit 1").get(projectPath) as StoredRow | undefined;
    if (existing) {
      return this.updateExistingProject(mapProject(existing), input);
    }

    const project: Project = {
      id: createId("project"),
      name: input.name,
      path: projectPath,
      role: input.role ?? "Remote project",
      stack: input.stack ?? [],
      agentKind: input.agentKind ?? "Codex",
      humanOwner: input.humanOwner ?? "Human owner",
      createdAt: nowIso()
    };
    const db = this.openDb();
    db.prepare(
      "insert into projects (id, name, path, role, stack_json, agent_kind, human_owner, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      project.id,
      project.name,
      project.path,
      project.role,
      JSON.stringify(project.stack),
      project.agentKind,
      project.humanOwner,
      project.createdAt
    );

    const agent: Agent = {
      id: createId("agent"),
      projectId: project.id,
      name: `${project.agentKind} for ${project.name}`,
      kind: project.agentKind,
      status: "active"
    };
    db.prepare("insert into agents (id, project_id, name, kind, status) values (?, ?, ?, ?, ?)").run(
      agent.id,
      agent.projectId,
      agent.name,
      agent.kind,
      agent.status
    );
    await this.appendEvent(room.id, agent.id, "FYI", { event: "remote_project_connected", projectId: project.id });
    return project;
  }

  async getState(): Promise<RoomState> {
    const room = await this.initialize();
    const db = this.openDb();
    const state: RoomState = {
      room,
      projects: (db.prepare("select * from projects order by created_at").all() as StoredRow[]).map(mapProject),
      agents: (db.prepare("select * from agents order by name").all() as StoredRow[]).map(mapAgent),
      messages: (db.prepare("select * from messages order by created_at desc limit 100").all() as StoredRow[]).map(mapMessage),
      questions: (db.prepare("select * from questions order by created_at desc").all() as StoredRow[]).map(mapQuestion),
      decisions: (db.prepare("select * from decisions order by created_at desc").all() as StoredRow[]).map(mapDecision),
      contracts: (db.prepare("select * from contracts order by id").all() as StoredRow[]).map(mapContract),
      accessRequests: (db.prepare("select * from access_requests order by created_at desc").all() as StoredRow[]).map(mapAccessRequest),
      fileActivities: (db.prepare("select * from file_activities order by updated_at desc").all() as StoredRow[]).map(mapFileActivity),
      fileAlerts: (db.prepare("select * from file_alerts order by created_at desc").all() as StoredRow[]).map(mapFileAlert),
      summary: ""
    };
    state.summary = buildHumanSummary(state);
    await writeTextFile(path.join(this.roomDir, "summaries", "latest.md"), state.summary);
    return state;
  }

  async getCurrentProject(): Promise<Project> {
    const db = this.openDb();
    const row = db.prepare("select * from projects where path = ? limit 1").get(this.projectRoot) as StoredRow | undefined;
    if (row) return mapProject(row);
    throw new Error("Current project is not registered in this AgentRoom yet. Run agentroom setup, connect, or join first.");
  }

  async getProjectByReference(reference: string): Promise<Project> {
    const normalized = reference.toLowerCase();
    const row = this.openDb()
      .prepare("select * from projects where id = ? or lower(name) = ? limit 1")
      .get(reference, normalized) as StoredRow | undefined;
    if (!row) throw new Error(`Project not found: ${reference}.`);
    return mapProject(row);
  }

  async askQuestion(input: Omit<Question, "id" | "roomId" | "status" | "createdAt">): Promise<Question> {
    const room = await this.initialize();
    this.assertProjectExists(input.fromProjectId);
    this.assertProjectExists(input.toProjectId);
    const question: Question = {
      id: createId("q"),
      roomId: room.id,
      status: "open",
      createdAt: nowIso(),
      ...input
    };
    this.openDb()
      .prepare(
        "insert into questions (id, room_id, from_project_id, to_project_id, topic, question, impact, urgency, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        question.id,
        question.roomId,
        question.fromProjectId,
        question.toProjectId,
        question.topic,
        question.question,
        question.impact,
        question.urgency,
        question.status,
        question.createdAt
      );
    await this.appendJsonl("questions.jsonl", question);
    return question;
  }

  async answerQuestion(input: {
    questionId: string;
    answer: string;
    suggestedResolution?: string;
    confidence: "low" | "medium" | "high";
  }): Promise<Question> {
    const answeredAt = nowIso();
    const result = this.openDb()
      .prepare(
        "update questions set status = 'answered', answer = ?, suggested_resolution = ?, confidence = ?, answered_at = ? where id = ? and status = 'open'"
      )
      .run(input.answer, input.suggestedResolution ?? null, input.confidence, answeredAt, input.questionId);
    const question = this.openDb().prepare("select * from questions where id = ?").get(input.questionId) as StoredRow | undefined;
    if (!question) throw new Error(`Question not found: ${input.questionId}`);
    if (result.changes === 0) throw new Error(`Question is not open and cannot be answered: ${input.questionId}`);
    return mapQuestion(question);
  }

  async answerQuestionForProject(
    projectId: string,
    input: {
      questionId: string;
      answer: string;
      suggestedResolution?: string;
      confidence: "low" | "medium" | "high";
    }
  ): Promise<Question> {
    const question = this.openDb().prepare("select * from questions where id = ?").get(input.questionId) as StoredRow | undefined;
    if (!question) throw new Error(`Question not found: ${input.questionId}`);
    const mapped = mapQuestion(question);
    if (mapped.toProjectId !== projectId) {
      throw new Error(`Project ${projectId} cannot answer question ${input.questionId}; it is addressed to ${mapped.toProjectId}.`);
    }
    return this.answerQuestion(input);
  }

  async upsertProjectSnapshotForProject(projectId: string, files: ProjectSnapshotFile[]): Promise<ProjectSnapshot> {
    this.assertProjectExists(projectId);
    const snapshot: ProjectSnapshot = {
      projectId,
      files,
      updatedAt: nowIso()
    };
    this.openDb()
      .prepare(
        `insert into project_snapshots (project_id, files_json, updated_at)
         values (?, ?, ?)
         on conflict(project_id) do update set
          files_json = excluded.files_json,
          updated_at = excluded.updated_at`
      )
      .run(snapshot.projectId, JSON.stringify(snapshot.files), snapshot.updatedAt);
    return snapshot;
  }

  async getProjectSnapshotForProject(projectId: string): Promise<ProjectSnapshot | undefined> {
    this.assertProjectExists(projectId);
    const row = this.openDb()
      .prepare("select * from project_snapshots where project_id = ? limit 1")
      .get(projectId) as StoredRow | undefined;
    return row ? mapProjectSnapshot(row) : undefined;
  }

  async recordDecision(input: Omit<Decision, "id" | "roomId" | "createdAt">): Promise<Decision> {
    const room = await this.initialize();
    const decision: Decision = { id: createId("d"), roomId: room.id, createdAt: nowIso(), ...input };
    this.openDb()
      .prepare(
        "insert into decisions (id, room_id, title, reason, status, approved_by_json, affects_json, risk, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        decision.id,
        decision.roomId,
        decision.title,
        decision.reason,
        decision.status,
        JSON.stringify(decision.approvedBy),
        JSON.stringify(decision.affects),
        decision.risk,
        decision.createdAt
      );
    await this.writeDecisionsMarkdown();
    return decision;
  }

  async updateDecisionStatus(input: {
    decisionId: string;
    status: "approved" | "rejected" | "applied";
    approvedBy?: string;
  }): Promise<Decision> {
    const existing = this.openDb().prepare("select * from decisions where id = ?").get(input.decisionId) as StoredRow | undefined;
    if (!existing) throw new Error(`Decision not found: ${input.decisionId}`);
    const decision = mapDecision(existing);
    if (!isAllowedDecisionTransition(decision.status, input.status)) {
      throw new Error(`Invalid decision transition: ${decision.status} -> ${input.status}.`);
    }
    const approvedBy = input.status === "approved" || input.status === "applied"
      ? [...new Set([...decision.approvedBy, input.approvedBy ?? "Human owner"])]
      : [];
    this.openDb()
      .prepare("update decisions set status = ?, approved_by_json = ? where id = ?")
      .run(input.status, JSON.stringify(approvedBy), input.decisionId);
    await this.writeDecisionsMarkdown();
    const updated = this.openDb().prepare("select * from decisions where id = ?").get(input.decisionId) as StoredRow;
    return mapDecision(updated);
  }

  async publishContract(input: Omit<Contract, "id"> & { id?: string }): Promise<Contract> {
    const { id, ...rest } = input;
    const contract: Contract = { ...rest, id: id ?? createId("contract") };
    this.assertProjectExists(contract.providerProjectId);
    this.assertProjectExists(contract.consumerProjectId);
    const existing = this.openDb().prepare("select * from contracts where id = ?").get(contract.id) as StoredRow | undefined;
    if (existing && mapContract(existing).status !== "draft") {
      throw new Error(`Contract ${contract.id} is not draft. Create a new version/id instead of overwriting it.`);
    }
    this.openDb()
      .prepare(
        "insert or replace into contracts (id, provider_project_id, consumer_project_id, version, payload_json, status) values (?, ?, ?, ?, ?, ?)"
      )
      .run(
        contract.id,
        contract.providerProjectId,
        contract.consumerProjectId,
        contract.version,
        JSON.stringify({
          resources: contract.resources,
          breakingChangesRequireHumanApproval: contract.breakingChangesRequireHumanApproval
        }),
        contract.status
      );
    await writeJson(path.join(this.roomDir, "contracts", `${slugify(contract.id)}.json`), contract);
    return contract;
  }

  async updateContractStatus(input: {
    contractId: string;
    status: "active" | "deprecated" | "draft";
  }): Promise<Contract> {
    const existing = this.openDb().prepare("select * from contracts where id = ?").get(input.contractId) as StoredRow | undefined;
    if (!existing) throw new Error(`Contract not found: ${input.contractId}`);
    const contractBefore = mapContract(existing);
    if (!isAllowedContractTransition(contractBefore.status, input.status)) {
      throw new Error(`Invalid contract transition: ${contractBefore.status} -> ${input.status}.`);
    }
    this.openDb().prepare("update contracts set status = ? where id = ?").run(input.status, input.contractId);
    const updated = this.openDb().prepare("select * from contracts where id = ?").get(input.contractId) as StoredRow;
    const contract = mapContract(updated);
    await writeJson(path.join(this.roomDir, "contracts", `${slugify(contract.id)}.json`), contract);
    return contract;
  }

  async requestAccess(input: Omit<AccessRequest, "id" | "status" | "createdAt">): Promise<AccessRequest> {
    this.assertProjectExists(input.fromProjectId);
    this.assertProjectExists(input.toProjectId);
    const request: AccessRequest = { id: createId("access"), status: "pending", createdAt: nowIso(), ...input };
    this.openDb()
      .prepare(
        "insert into access_requests (id, from_project_id, to_project_id, path, reason, scope, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        request.id,
        request.fromProjectId,
        request.toProjectId,
        request.path,
        request.reason,
        request.scope,
        request.status,
        request.createdAt
      );
    return request;
  }

  async updateAccessRequestStatus(input: {
    accessRequestId: string;
    status: "approved" | "denied";
  }): Promise<AccessRequest> {
    const result = this.openDb()
      .prepare("update access_requests set status = ? where id = ? and status = 'pending'")
      .run(input.status, input.accessRequestId);
    const updated = this.openDb().prepare("select * from access_requests where id = ?").get(input.accessRequestId) as StoredRow | undefined;
    if (!updated) throw new Error(`Access request not found: ${input.accessRequestId}`);
    if (result.changes === 0) throw new Error(`Access request is not pending: ${input.accessRequestId}`);
    return mapAccessRequest(updated);
  }

  async reportTestResult(input: {
    status: "passed" | "failed" | "skipped";
    command: string;
    summary: string;
    affects?: string[];
  }): Promise<Message> {
    const room = await this.initialize();
    const currentProject = await this.getCurrentProject();
    const agent = this.openDb().prepare("select * from agents where project_id = ? limit 1").get(currentProject.id) as StoredRow | undefined;
    if (!agent) throw new Error(`No active agent registered for project ${currentProject.name}.`);
    return this.appendEvent(room.id, String(agent.id), "TEST_RESULT", {
      projectId: currentProject.id,
      status: input.status,
      command: input.command,
      summary: input.summary,
      affects: input.affects ?? []
    });
  }

  async reportTestResultForProject(
    projectId: string,
    input: {
      status: "passed" | "failed" | "skipped";
      command: string;
      summary: string;
      affects?: string[];
    }
  ): Promise<Message> {
    const room = await this.initialize();
    this.assertProjectExists(projectId);
    const agent = this.openDb().prepare("select * from agents where project_id = ? limit 1").get(projectId) as StoredRow | undefined;
    if (!agent) throw new Error(`No active agent registered for project ${projectId}.`);
    return this.appendEvent(room.id, String(agent.id), "TEST_RESULT", {
      projectId,
      status: input.status,
      command: input.command,
      summary: input.summary,
      affects: input.affects ?? []
    });
  }

  async publishFileActivity(input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt">): Promise<FileActivity> {
    const currentProject = await this.getCurrentProject();
    return this.publishFileActivityForProject(currentProject.id, input);
  }

  async publishFileActivityForProject(
    projectId: string,
    input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt">
  ): Promise<FileActivity> {
    const room = await this.initialize();
    this.assertProjectExists(projectId);
    const normalizedPath = normalizeProjectPath(input.path);
    const existing = this.openDb()
      .prepare("select * from file_activities where project_id = ? and path = ? limit 1")
      .get(projectId, normalizedPath) as StoredRow | undefined;
    const now = nowIso();
    const activity: FileActivity = {
      id: existing ? String(existing.id) : createId("fileact"),
      roomId: room.id,
      projectId,
      path: normalizedPath,
      status: input.status,
      branch: input.branch,
      repository: input.repository,
      lastCommit: input.lastCommit,
      contentHash: input.contentHash,
      note: input.note,
      createdAt: existing ? String(existing.created_at) : now,
      updatedAt: now
    };
    this.openDb()
      .prepare(
        `insert into file_activities
          (id, room_id, project_id, path, status, branch, repository, last_commit, content_hash, note, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, path) do update set
          status = excluded.status,
          branch = excluded.branch,
          repository = excluded.repository,
          last_commit = excluded.last_commit,
          content_hash = excluded.content_hash,
          note = excluded.note,
          updated_at = excluded.updated_at`
      )
      .run(
        activity.id,
        activity.roomId,
        activity.projectId,
        activity.path,
        activity.status,
        activity.branch ?? null,
        activity.repository ?? null,
        activity.lastCommit ?? null,
        activity.contentHash ?? null,
        activity.note ?? null,
        activity.createdAt,
        activity.updatedAt
      );
    return activity;
  }

  async checkFileBeforeEditForProject(
    projectId: string,
    input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt"> & { intent?: string }
  ): Promise<FileEditCheck> {
    const room = await this.initialize();
    this.assertProjectExists(projectId);
    const normalizedPath = normalizeProjectPath(input.path);
    const candidates = (this.openDb()
      .prepare(
        `select * from file_activities
         where path = ?
           and project_id != ?
           and status in ('editing', 'modified', 'staged')
         order by updated_at desc`
      )
      .all(normalizedPath, projectId) as StoredRow[])
      .map(mapFileActivity)
      .filter((activity) => isSameWorkContext(input, activity));

    if (candidates.length === 0) {
      await this.publishFileActivityForProject(projectId, {
        path: normalizedPath,
        status: "editing",
        branch: input.branch,
        repository: input.repository,
        lastCommit: input.lastCommit,
        contentHash: input.contentHash,
        note: input.note ?? `Intent: ${input.intent ?? "edit"}`
      });
      return {
        ok: true,
        requiresUserConfirmation: false,
        path: normalizedPath,
        alerts: [],
        message: `No AgentRoom file collision detected for ${normalizedPath}.`
      };
    }

    const alerts: FileAlert[] = [];
    for (const conflict of candidates) {
      const alert = await this.createFileAlert({
        roomId: room.id,
        path: normalizedPath,
        triggeredByProjectId: projectId,
        conflictingProjectId: conflict.projectId,
        conflictingActivityId: conflict.id,
        branch: input.branch,
        repository: input.repository,
        lastCommit: input.lastCommit,
        reason: `Another project has ${conflict.status} activity on ${normalizedPath}. Ask the human before continuing.`
      });
      alerts.push(alert);
    }

    return {
      ok: false,
      requiresUserConfirmation: true,
      path: normalizedPath,
      alerts,
      message: `AgentRoom detected ${alerts.length} possible file collision(s) on ${normalizedPath}. Ask the human if you should continue before editing.`
    };
  }

  async confirmFileAlertForProject(
    projectId: string,
    input: {
      alertId: string;
      decision: "continue" | "cancel";
      confirmedBy?: string;
      note?: string;
    }
  ): Promise<FileAlert> {
    this.assertProjectExists(projectId);
    const existing = this.openDb().prepare("select * from file_alerts where id = ?").get(input.alertId) as StoredRow | undefined;
    if (!existing) throw new Error(`File alert not found: ${input.alertId}`);
    const alert = mapFileAlert(existing);
    if (alert.triggeredByProjectId !== projectId) {
      throw new Error(`Project ${projectId} cannot confirm file alert ${input.alertId}; it belongs to ${alert.triggeredByProjectId}.`);
    }
    if (alert.status !== "active") throw new Error(`File alert is already resolved: ${input.alertId}.`);
    const status = input.decision === "continue" ? "continued" : "cancelled";
    this.openDb()
      .prepare(
        "update file_alerts set status = ?, resolved_at = ?, resolved_by_project_id = ?, resolution = ?, note = ? where id = ?"
      )
      .run(status, nowIso(), projectId, input.decision, input.note ?? input.confirmedBy ?? null, input.alertId);
    if (input.decision === "continue") {
      await this.publishFileActivityForProject(projectId, {
        path: alert.path,
        status: "editing",
        branch: alert.branch,
        repository: alert.repository,
        lastCommit: alert.lastCommit,
        note: `Human confirmed continued editing despite alert ${alert.id}.`
      });
    }
    const updated = this.openDb().prepare("select * from file_alerts where id = ?").get(input.alertId) as StoredRow;
    return mapFileAlert(updated);
  }

  async listFileAlertsForProject(projectId?: string): Promise<FileAlert[]> {
    const rows = projectId
      ? this.openDb()
          .prepare("select * from file_alerts where triggered_by_project_id = ? or conflicting_project_id = ? order by created_at desc")
          .all(projectId, projectId)
      : this.openDb().prepare("select * from file_alerts order by created_at desc").all();
    return (rows as StoredRow[]).map(mapFileAlert);
  }

  async listVisibleFiles(): Promise<string[]> {
    const policy = await this.loadPermissionPolicy();
    const files = await listFiles(this.projectRoot);
    return files.filter((file) => classifyPath(file, policy) === "visible");
  }

  async readAllowedProjectFile(relativePath: string): Promise<string> {
    const policy = await this.loadPermissionPolicy();
    return readAllowedFile(this.projectRoot, relativePath, policy);
  }

  async readPermissionsMarkdown(): Promise<string> {
    await this.initialize();
    return fs.readFile(path.join(this.projectAgentRoomDir, "permissions.md"), "utf8");
  }

  async writePermissionsMarkdown(markdown: string): Promise<string> {
    await this.initialize();
    const permissionsPath = path.join(this.projectAgentRoomDir, "permissions.md");
    await writeTextFile(permissionsPath, markdown);
    return permissionsPath;
  }

  async readPermissionsMarkdownForProject(projectId: string): Promise<string> {
    const project = this.getProjectById(projectId);
    const stored = this.openDb()
      .prepare("select markdown from project_permissions where project_id = ? limit 1")
      .get(projectId) as StoredRow | undefined;
    if (stored) return String(stored.markdown);
    if (project.path.startsWith("remote://")) return defaultPermissionsMarkdown();
    const permissionsPath = path.join(getProjectAgentRoomDir(project.path), "permissions.md");
    if (!(await exists(permissionsPath))) await this.ensureDefaultPermissions(project.path);
    return fs.readFile(permissionsPath, "utf8");
  }

  async writePermissionsMarkdownForProject(projectId: string, markdown: string): Promise<string> {
    const project = this.getProjectById(projectId);
    this.openDb()
      .prepare(
        `insert into project_permissions (project_id, markdown, updated_at)
         values (?, ?, ?)
         on conflict(project_id) do update set
          markdown = excluded.markdown,
          updated_at = excluded.updated_at`
      )
      .run(projectId, markdown, nowIso());
    if (project.path.startsWith("remote://")) return `remote://${projectId}/permissions.md`;
    const permissionsPath = path.join(getProjectAgentRoomDir(project.path), "permissions.md");
    await writeTextFile(permissionsPath, markdown);
    return permissionsPath;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private openDb(): Database.Database {
    if (this.db) return this.db;
    const dbPath = path.join(this.roomDir, "events.db");
    this.db = new Database(dbPath);
    this.ensureSchema(this.db);
    return this.db;
  }

  private async ensureDefaultPermissions(projectRoot = this.projectRoot): Promise<void> {
    const projectAgentRoomDir = getProjectAgentRoomDir(projectRoot);
    const permissionsPath = path.join(projectAgentRoomDir, "permissions.md");
    if (!(await exists(permissionsPath))) {
      await ensureSafeDirectory(projectAgentRoomDir);
      await writeTextFile(permissionsPath, defaultPermissionsMarkdown());
    }
  }

  private async ensureProjectLocalFiles(project: Project): Promise<void> {
    const projectAgentRoomDir = getProjectAgentRoomDir(project.path);
    await ensureSafeDirectory(projectAgentRoomDir);
    await this.ensureDefaultPermissions(project.path);
    const projectCardPath = path.join(projectAgentRoomDir, "project-card.md");
    await writeTextFile(projectCardPath, renderProjectCard(project));
  }

  private async updateExistingProject(
    project: Project,
    input: {
      name?: string;
      role?: string;
      agentKind?: string;
      humanOwner?: string;
    }
  ): Promise<Project> {
    const nextProject: Project = {
      ...project,
      name: input.name ?? project.name,
      role: input.role ?? project.role,
      agentKind: input.agentKind ?? project.agentKind,
      humanOwner: input.humanOwner ?? project.humanOwner
    };
    this.openDb()
      .prepare("update projects set name = ?, role = ?, agent_kind = ?, human_owner = ? where id = ?")
      .run(nextProject.name, nextProject.role, nextProject.agentKind, nextProject.humanOwner, nextProject.id);
    this.openDb()
      .prepare("update agents set name = ?, kind = ? where project_id = ?")
      .run(`${nextProject.agentKind} for ${nextProject.name}`, nextProject.agentKind, nextProject.id);
    return nextProject;
  }

  private ensureSchema(db: Database.Database): void {
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
      create table if not exists project_snapshots (
        project_id text primary key,
        files_json text not null,
        updated_at text not null
      );
      create table if not exists project_permissions (
        project_id text primary key,
        markdown text not null,
        updated_at text not null
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
      create table if not exists file_activities (
        id text primary key,
        room_id text not null,
        project_id text not null,
        path text not null,
        status text not null,
        branch text,
        repository text,
        last_commit text,
        content_hash text,
        note text,
        created_at text not null,
        updated_at text not null,
        unique(project_id, path)
      );
      create table if not exists file_alerts (
        id text primary key,
        room_id text not null,
        path text not null,
        status text not null,
        triggered_by_project_id text not null,
        conflicting_project_id text not null,
        activity_id text,
        conflicting_activity_id text,
        branch text,
        repository text,
        last_commit text,
        reason text not null,
        created_at text not null,
        resolved_at text,
        resolved_by_project_id text,
        resolution text,
        note text
      );
    `);
  }

  private async appendEvent(
    roomId: string,
    fromAgentId: string,
    type: Message["type"],
    payload: Record<string, unknown>,
    toAgentId?: string
  ): Promise<Message> {
    const message: Message = {
      id: createId("msg"),
      roomId,
      fromAgentId,
      toAgentId,
      type,
      payload,
      createdAt: nowIso()
    };
    this.openDb()
      .prepare(
        "insert into messages (id, room_id, from_agent_id, to_agent_id, type, payload_json, created_at) values (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(message.id, message.roomId, message.fromAgentId, message.toAgentId ?? null, message.type, JSON.stringify(message.payload), message.createdAt);
    await this.appendJsonl("events.jsonl", message);
    return message;
  }

  private async loadPermissionPolicy() {
    const permissionsPath = path.join(this.projectAgentRoomDir, "permissions.md");
    const markdown = await fs.readFile(permissionsPath, "utf8");
    return parsePermissions(markdown);
  }

  private async appendJsonl(fileName: string, value: unknown): Promise<void> {
    await appendTextFile(path.join(this.roomDir, fileName), `${JSON.stringify(value)}\n`);
  }

  private async writeRoomManifest(room: Room): Promise<void> {
    await writeJson(path.join(this.roomDir, "room.json"), room);
  }

  private async writeDecisionsMarkdown(): Promise<void> {
    const decisions = (this.openDb().prepare("select * from decisions order by created_at desc").all() as StoredRow[]).map(mapDecision);
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
    await writeTextFile(path.join(this.roomDir, "decisions.md"), body);
  }

  private assertProjectExists(projectId: string): void {
    const row = this.openDb().prepare("select id from projects where id = ? limit 1").get(projectId) as StoredRow | undefined;
    if (!row) throw new Error(`Project does not exist in this AgentRoom: ${projectId}`);
  }

  private getProjectById(projectId: string): Project {
    const row = this.openDb().prepare("select * from projects where id = ? limit 1").get(projectId) as StoredRow | undefined;
    if (!row) throw new Error(`Project does not exist in this AgentRoom: ${projectId}`);
    return mapProject(row);
  }

  private async createFileAlert(input: {
    roomId: string;
    path: string;
    triggeredByProjectId: string;
    conflictingProjectId: string;
    activityId?: string;
    conflictingActivityId?: string;
    branch?: string;
    repository?: string;
    lastCommit?: string;
    reason: string;
  }): Promise<FileAlert> {
    const existing = this.openDb()
      .prepare(
        `select * from file_alerts
         where path = ?
           and status = 'active'
           and triggered_by_project_id = ?
           and conflicting_project_id = ?
         limit 1`
      )
      .get(input.path, input.triggeredByProjectId, input.conflictingProjectId) as StoredRow | undefined;
    if (existing) return mapFileAlert(existing);
    const alert: FileAlert = {
      id: createId("filealert"),
      roomId: input.roomId,
      path: input.path,
      status: "active",
      triggeredByProjectId: input.triggeredByProjectId,
      conflictingProjectId: input.conflictingProjectId,
      activityId: input.activityId,
      conflictingActivityId: input.conflictingActivityId,
      branch: input.branch,
      repository: input.repository,
      lastCommit: input.lastCommit,
      reason: input.reason,
      createdAt: nowIso()
    };
    this.openDb()
      .prepare(
        `insert into file_alerts
          (id, room_id, path, status, triggered_by_project_id, conflicting_project_id, activity_id, conflicting_activity_id, branch, repository, last_commit, reason, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        alert.id,
        alert.roomId,
        alert.path,
        alert.status,
        alert.triggeredByProjectId,
        alert.conflictingProjectId,
        alert.activityId ?? null,
        alert.conflictingActivityId ?? null,
        alert.branch ?? null,
        alert.repository ?? null,
        alert.lastCommit ?? null,
        alert.reason,
        alert.createdAt
      );
    return alert;
  }
}

function parseJsonArray<T = string>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  return JSON.parse(value) as T[];
}

function mapRoom(row: StoredRow): Room {
  return {
    id: String(row.id),
    name: String(row.name),
    inviteCode: String(row.invite_code),
    createdAt: String(row.created_at)
  };
}

function mapProject(row: StoredRow): Project {
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

function mapAgent(row: StoredRow): Agent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    kind: String(row.kind),
    status: row.status === "active" || row.status === "idle" ? row.status : "unknown"
  };
}

function mapMessage(row: StoredRow): Message {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: row.to_agent_id ? String(row.to_agent_id) : undefined,
    type: row.type as Message["type"],
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: String(row.created_at)
  };
}

function mapQuestion(row: StoredRow): Question {
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

function mapProjectSnapshot(row: StoredRow): ProjectSnapshot {
  return {
    projectId: String(row.project_id),
    files: parseJsonArray<ProjectSnapshotFile>(String(row.files_json)),
    updatedAt: String(row.updated_at)
  };
}

function mapDecision(row: StoredRow): Decision {
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

function mapContract(row: StoredRow): Contract {
  const payload = JSON.parse(String(row.payload_json)) as Pick<Contract, "resources" | "breakingChangesRequireHumanApproval">;
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

function mapAccessRequest(row: StoredRow): AccessRequest {
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

function mapFileActivity(row: StoredRow): FileActivity {
  const status = row.status === "editing" || row.status === "staged" ? row.status : "modified";
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    projectId: String(row.project_id),
    path: String(row.path),
    status,
    branch: row.branch ? String(row.branch) : undefined,
    repository: row.repository ? String(row.repository) : undefined,
    lastCommit: row.last_commit ? String(row.last_commit) : undefined,
    contentHash: row.content_hash ? String(row.content_hash) : undefined,
    note: row.note ? String(row.note) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapFileAlert(row: StoredRow): FileAlert {
  const status = row.status === "continued" || row.status === "cancelled" ? row.status : "active";
  const resolution = row.resolution === "continue" || row.resolution === "cancel" ? row.resolution : undefined;
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    path: String(row.path),
    status,
    triggeredByProjectId: String(row.triggered_by_project_id),
    conflictingProjectId: String(row.conflicting_project_id),
    activityId: row.activity_id ? String(row.activity_id) : undefined,
    conflictingActivityId: row.conflicting_activity_id ? String(row.conflicting_activity_id) : undefined,
    branch: row.branch ? String(row.branch) : undefined,
    repository: row.repository ? String(row.repository) : undefined,
    lastCommit: row.last_commit ? String(row.last_commit) : undefined,
    reason: String(row.reason),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
    resolvedByProjectId: row.resolved_by_project_id ? String(row.resolved_by_project_id) : undefined,
    resolution,
    note: row.note ? String(row.note) : undefined
  };
}

function normalizeProjectPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`File activity path must be project-relative: ${value}`);
  }
  return normalized;
}

function isSameWorkContext(
  input: { branch?: string; repository?: string },
  activity: Pick<FileActivity, "branch" | "repository">
): boolean {
  if (input.repository && activity.repository && input.repository !== activity.repository) return false;
  if (input.branch && activity.branch && input.branch !== activity.branch) return false;
  return true;
}

function isAllowedDecisionTransition(from: Decision["status"], to: "approved" | "rejected" | "applied"): boolean {
  if (from === "proposed") return to === "approved" || to === "rejected";
  if (from === "approved") return to === "applied";
  return false;
}

function isAllowedContractTransition(from: Contract["status"], to: Contract["status"]): boolean {
  if (from === "draft") return to === "active";
  if (from === "active") return to === "deprecated";
  return false;
}
