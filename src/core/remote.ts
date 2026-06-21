import { promises as fs } from "node:fs";
import path from "node:path";
import { draftAnswerFromEvidence, type ProcessInboxOptions, type ProcessInboxResult } from "./autonomous.js";
import { detectProject } from "./detect.js";
import { ensureSafeDirectory, exists, writeTextFile } from "./files.js";
import { getProjectAgentRoomDir, readProjectLink, writeRemoteProjectLink, type ProjectRoomLink } from "./registry.js";
import { classifyPath, parsePermissions, readAllowedFile } from "./permissions.js";
import { defaultPermissionsMarkdown, renderProjectCard } from "./project-card.js";
import type { AccessRequest, Contract, Decision, FileActivity, FileAlert, FileEditCheck, Message, Project, Question, Room, RoomState } from "./types.js";

export type RemoteProjectInput = {
  name?: string;
  role?: string;
  agentKind?: string;
  humanOwner?: string;
};

export type RemoteConnectResult = {
  room: Room;
  project: Project;
  inviteCode: string;
  relayUrl: string;
  dashboardUrl?: string;
};

export class RemoteAgentRoomClient {
  readonly projectRoot: string;
  readonly link: ProjectRoomLink;

  constructor(projectRoot: string, link: ProjectRoomLink) {
    if (!link.relayUrl || !link.projectToken || !link.projectId) {
      throw new Error("This project is not linked to a remote AgentRoom relay.");
    }
    this.projectRoot = path.resolve(projectRoot);
    this.link = link;
  }

  static async forLinkedProject(projectRoot = process.cwd()): Promise<RemoteAgentRoomClient | undefined> {
    const link = await readProjectLink(projectRoot);
    if (!isRemoteLink(link)) return undefined;
    return new RemoteAgentRoomClient(projectRoot, link);
  }

  static async requireLinkedProject(projectRoot = process.cwd()): Promise<RemoteAgentRoomClient> {
    const client = await RemoteAgentRoomClient.forLinkedProject(projectRoot);
    if (!client) throw new Error("This project is not connected to a remote AgentRoom relay.");
    return client;
  }

  async getState(): Promise<RoomState> {
    return this.request<RoomState>(`/api/rooms/${this.link.roomId}/state`);
  }

  async getCurrentProject(): Promise<Project> {
    return this.request<Project>(`/api/rooms/${this.link.roomId}/current-project`);
  }

  async getProjectByReference(reference: string): Promise<Project> {
    const state = await this.getState();
    const normalized = reference.toLowerCase();
    const project = state.projects.find((candidate) => candidate.id === reference || candidate.name.toLowerCase() === normalized);
    if (!project) throw new Error(`Project not found: ${reference}.`);
    return project;
  }

  async askQuestion(input: {
    toProjectId: string;
    topic: string;
    question: string;
    impact: string;
    urgency: "low" | "normal" | "blocking";
  }): Promise<Question> {
    return this.request<Question>(`/api/rooms/${this.link.roomId}/questions`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async answerQuestionForProject(
    _projectId: string,
    input: {
      questionId: string;
      answer: string;
      suggestedResolution?: string;
      confidence: "low" | "medium" | "high";
    }
  ): Promise<Question> {
    return this.request<Question>(`/api/rooms/${this.link.roomId}/answers`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async recordDecision(input: Omit<Decision, "id" | "roomId" | "createdAt">): Promise<Decision> {
    return this.request<Decision>(`/api/rooms/${this.link.roomId}/decisions`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async publishContract(input: Omit<Contract, "id"> & { id?: string }): Promise<Contract> {
    return this.request<Contract>(`/api/rooms/${this.link.roomId}/contracts`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async requestAccess(input: Omit<AccessRequest, "id" | "status" | "createdAt">): Promise<AccessRequest> {
    return this.request<AccessRequest>(`/api/rooms/${this.link.roomId}/access-requests`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async reportTestResult(input: {
    status: "passed" | "failed" | "skipped";
    command: string;
    summary: string;
    affects?: string[];
  }): Promise<Message> {
    return this.request<Message>(`/api/rooms/${this.link.roomId}/test-results`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async publishFileActivity(input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt">): Promise<FileActivity> {
    return this.request<FileActivity>(`/api/rooms/${this.link.roomId}/file-activity`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async checkFileBeforeEdit(input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt"> & { intent?: string }): Promise<FileEditCheck> {
    return this.request<FileEditCheck>(`/api/rooms/${this.link.roomId}/file-alerts/check`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async confirmFileAlert(input: {
    alertId: string;
    decision: "continue" | "cancel";
    confirmedBy?: string;
    note?: string;
  }): Promise<FileAlert> {
    return this.request<FileAlert>(`/api/rooms/${this.link.roomId}/file-alerts/${input.alertId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        decision: input.decision,
        confirmedBy: input.confirmedBy,
        note: input.note
      })
    });
  }

  async listFileAlerts(): Promise<FileAlert[]> {
    return this.request<FileAlert[]>(`/api/rooms/${this.link.roomId}/file-alerts`);
  }

  async processInboxAutonomously(options: ProcessInboxOptions = {}): Promise<ProcessInboxResult> {
    const currentProject = await this.getCurrentProject();
    const state = await this.getState();
    const questions = state.questions
      .filter((question) => question.status === "open" && question.toProjectId === currentProject.id)
      .slice(0, options.maxQuestions ?? 5);

    const result: ProcessInboxResult = { project: currentProject, answered: [], skipped: [] };
    for (const question of questions) {
      const draft = await draftAnswerFromEvidence(this, question, currentProject, options.maxFiles ?? 30);
      if (!draft) {
        result.skipped.push({
          questionId: question.id,
          reason: "No reliable evidence found in files visible by current AgentRoom permissions."
        });
        continue;
      }

      const answered = await this.answerQuestionForProject(currentProject.id, {
        questionId: question.id,
        answer: draft.answer,
        suggestedResolution: draft.suggestedResolution,
        confidence: draft.confidence
      });
      result.answered.push({
        questionId: answered.id,
        answer: draft.answer,
        confidence: draft.confidence,
        evidenceFiles: [...new Set(draft.evidence.map((item) => item.file))]
      });
    }
    return result;
  }

  async listVisibleFiles(): Promise<string[]> {
    const policy = parsePermissions(await this.readPermissionsMarkdown());
    const files = await listProjectFiles(this.projectRoot);
    return files.filter((file) => classifyPath(file, policy) === "visible");
  }

  async readAllowedProjectFile(relativePath: string): Promise<string> {
    const policy = parsePermissions(await this.readPermissionsMarkdown());
    return readAllowedFile(this.projectRoot, relativePath, policy);
  }

  async readPermissionsMarkdown(): Promise<string> {
    return fs.readFile(path.join(getProjectAgentRoomDir(this.projectRoot), "permissions.md"), "utf8");
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.link.relayUrl}${endpoint}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.link.projectToken}`,
        ...init.headers
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AgentRoom relay request failed (${response.status}): ${body}`);
    }
    return response.json() as Promise<T>;
  }
}

export async function connectRemoteRoom(
  projectRoot: string,
  relayUrl: string,
  adminToken: string | undefined,
  input: RemoteProjectInput
): Promise<RemoteConnectResult> {
  const project = await buildRemoteProjectInput(projectRoot, input);
  const response = await relayRequest<RemoteJoinPayload>(relayUrl, "/api/rooms", adminToken, {
    method: "POST",
    body: JSON.stringify({ project })
  });
  await prepareRemoteProjectFiles(projectRoot, response.project);
  await writeRemoteProjectLink(projectRoot, {
    roomId: response.room.id,
    inviteCode: response.room.inviteCode,
    relayUrl,
    dashboardUrl: response.dashboardUrl,
    projectId: response.project.id,
    projectToken: response.projectToken
  });
  return { room: response.room, project: response.project, inviteCode: response.room.inviteCode, relayUrl: normalizeRelayUrl(relayUrl), dashboardUrl: response.dashboardUrl };
}

export async function joinRemoteRoom(
  projectRoot: string,
  relayUrl: string,
  inviteCode: string,
  input: RemoteProjectInput
): Promise<RemoteConnectResult> {
  const project = await buildRemoteProjectInput(projectRoot, input);
  const response = await relayRequest<RemoteJoinPayload>(relayUrl, "/api/join", undefined, {
    method: "POST",
    body: JSON.stringify({ inviteCode, project })
  });
  await prepareRemoteProjectFiles(projectRoot, response.project);
  await writeRemoteProjectLink(projectRoot, {
    roomId: response.room.id,
    inviteCode: response.room.inviteCode,
    relayUrl,
    projectId: response.project.id,
    projectToken: response.projectToken
  });
  return { room: response.room, project: response.project, inviteCode: response.room.inviteCode, relayUrl: normalizeRelayUrl(relayUrl) };
}

export function isRemoteLink(link: ProjectRoomLink | undefined): link is ProjectRoomLink & {
  relayUrl: string;
  projectId: string;
  projectToken: string;
} {
  return Boolean(link?.relayUrl && link.projectId && link.projectToken && (link.mode === "remote" || !link.roomDir));
}

async function buildRemoteProjectInput(projectRoot: string, input: RemoteProjectInput) {
  const detection = await detectProject(projectRoot);
  return {
    name: input.name ?? detection.name,
    role: input.role ?? detection.role,
    agentKind: input.agentKind ?? detection.agentHints[0] ?? "Codex",
    humanOwner: input.humanOwner ?? "Human owner",
    path: `remote://${path.basename(path.resolve(projectRoot))}`,
    stack: detection.stack
  };
}

async function prepareRemoteProjectFiles(projectRoot: string, project: Project): Promise<void> {
  const agentRoomDir = getProjectAgentRoomDir(projectRoot);
  await ensureSafeDirectory(agentRoomDir);
  const permissionsPath = path.join(agentRoomDir, "permissions.md");
  if (!(await exists(permissionsPath))) {
    await writeTextFile(permissionsPath, defaultPermissionsMarkdown());
  }
  await writeTextFile(path.join(agentRoomDir, "project-card.md"), renderProjectCard(project));
}

async function relayRequest<T>(relayUrl: string, endpoint: string, token: string | undefined, init: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeRelayUrl(relayUrl)}${endpoint}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AgentRoom relay request failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

async function listProjectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 8) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        results.push(relative);
      }
    }
  }
  await walk(root, 0);
  return results.sort();
}

function normalizeRelayUrl(relayUrl: string): string {
  const parsed = new URL(relayUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

type RemoteJoinPayload = {
  room: Room;
  project: Project;
  projectToken: string;
  dashboardUrl?: string;
};
