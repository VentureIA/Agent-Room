import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { draftAnswerFromEvidence } from "./autonomous.js";
import { detectProject } from "./detect.js";
import { ensureSafeDirectory, exists, writeTextFile } from "./files.js";
import { getProjectAgentRoomDir, readProjectLink, writeRemoteProjectLink } from "./registry.js";
import { classifyPath, parsePermissions, readAllowedFile } from "./permissions.js";
import { defaultPermissionsMarkdown, renderProjectCard } from "./project-card.js";
const REMOTE_INVITE_PREFIX = "arr_";
export class RemoteAgentRoomClient {
    projectRoot;
    link;
    constructor(projectRoot, link) {
        if (!link.relayUrl || !link.projectToken || !link.projectId) {
            throw new Error("This project is not linked to a remote AgentRoom relay.");
        }
        this.projectRoot = path.resolve(projectRoot);
        this.link = link;
    }
    static async forLinkedProject(projectRoot = process.cwd()) {
        const link = await readProjectLink(projectRoot);
        if (!isRemoteLink(link))
            return undefined;
        return new RemoteAgentRoomClient(projectRoot, link);
    }
    static async requireLinkedProject(projectRoot = process.cwd()) {
        const client = await RemoteAgentRoomClient.forLinkedProject(projectRoot);
        if (!client)
            throw new Error("This project is not connected to a remote AgentRoom relay.");
        return client;
    }
    async getState() {
        return this.request(`/api/rooms/${this.link.roomId}/state`);
    }
    async getCurrentProject() {
        return this.request(`/api/rooms/${this.link.roomId}/current-project`);
    }
    async getProjectByReference(reference) {
        const state = await this.getState();
        const normalized = reference.toLowerCase();
        const project = state.projects.find((candidate) => candidate.id === reference || candidate.name.toLowerCase() === normalized);
        if (!project)
            throw new Error(`Project not found: ${reference}.`);
        return project;
    }
    async askQuestion(input) {
        return this.request(`/api/rooms/${this.link.roomId}/questions`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async answerQuestionForProject(_projectId, input) {
        return this.request(`/api/rooms/${this.link.roomId}/answers`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async recordDecision(input) {
        return this.request(`/api/rooms/${this.link.roomId}/decisions`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async publishContract(input) {
        return this.request(`/api/rooms/${this.link.roomId}/contracts`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async requestAccess(input) {
        return this.request(`/api/rooms/${this.link.roomId}/access-requests`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async reportTestResult(input) {
        return this.request(`/api/rooms/${this.link.roomId}/test-results`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async publishFileActivity(input) {
        return this.request(`/api/rooms/${this.link.roomId}/file-activity`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async checkFileBeforeEdit(input) {
        return this.request(`/api/rooms/${this.link.roomId}/file-alerts/check`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    }
    async confirmFileAlert(input) {
        return this.request(`/api/rooms/${this.link.roomId}/file-alerts/${input.alertId}/confirm`, {
            method: "POST",
            body: JSON.stringify({
                decision: input.decision,
                confirmedBy: input.confirmedBy,
                note: input.note
            })
        });
    }
    async listFileAlerts() {
        return this.request(`/api/rooms/${this.link.roomId}/file-alerts`);
    }
    async processInboxAutonomously(options = {}) {
        const currentProject = await this.getCurrentProject();
        const state = await this.getState();
        const questions = state.questions
            .filter((question) => question.status === "open" && question.toProjectId === currentProject.id)
            .slice(0, options.maxQuestions ?? 5);
        const result = { project: currentProject, answered: [], skipped: [] };
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
    async listVisibleFiles() {
        const policy = parsePermissions(await this.readPermissionsMarkdown());
        const files = await listProjectFiles(this.projectRoot);
        return files.filter((file) => classifyPath(file, policy) === "visible");
    }
    async readAllowedProjectFile(relativePath) {
        const policy = parsePermissions(await this.readPermissionsMarkdown());
        return readAllowedFile(this.projectRoot, relativePath, policy);
    }
    async readPermissionsMarkdown() {
        return fs.readFile(path.join(getProjectAgentRoomDir(this.projectRoot), "permissions.md"), "utf8");
    }
    async request(endpoint, init = {}) {
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
        return response.json();
    }
}
export async function connectRemoteRoom(projectRoot, relayUrl, adminToken, input) {
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const project = await buildRemoteProjectInput(projectRoot, input);
    const response = await relayRequest(normalizedRelayUrl, "/api/rooms", adminToken, {
        method: "POST",
        body: JSON.stringify({ project })
    });
    const remoteInviteCode = createRemoteInviteCode(response.room.inviteCode, normalizedRelayUrl);
    await prepareRemoteProjectFiles(projectRoot, response.project);
    await writeRemoteProjectLink(projectRoot, {
        roomId: response.room.id,
        inviteCode: remoteInviteCode,
        relayUrl: normalizedRelayUrl,
        dashboardUrl: response.dashboardUrl,
        projectId: response.project.id,
        projectToken: response.projectToken
    });
    return { room: response.room, project: response.project, inviteCode: remoteInviteCode, relayUrl: normalizedRelayUrl, dashboardUrl: response.dashboardUrl };
}
export async function joinRemoteRoom(projectRoot, relayUrl, inviteCode, input) {
    const parsedInvite = parseJoinInviteCode(inviteCode);
    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const project = await buildRemoteProjectInput(projectRoot, input);
    const response = await relayRequest(normalizedRelayUrl, "/api/join", undefined, {
        method: "POST",
        body: JSON.stringify({ inviteCode: parsedInvite.inviteCode, project })
    });
    const remoteInviteCode = createRemoteInviteCode(response.room.inviteCode, normalizedRelayUrl);
    await prepareRemoteProjectFiles(projectRoot, response.project);
    await writeRemoteProjectLink(projectRoot, {
        roomId: response.room.id,
        inviteCode: remoteInviteCode,
        relayUrl: normalizedRelayUrl,
        projectId: response.project.id,
        projectToken: response.projectToken
    });
    return { room: response.room, project: response.project, inviteCode: remoteInviteCode, relayUrl: normalizedRelayUrl };
}
export function createRemoteInviteCode(inviteCode, relayUrl) {
    const payload = {
        v: 1,
        inviteCode,
        relayUrl: normalizeRelayUrl(relayUrl)
    };
    return `${REMOTE_INVITE_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}
export function parseJoinInviteCode(inviteCode) {
    if (!inviteCode.startsWith(REMOTE_INVITE_PREFIX))
        return { inviteCode };
    try {
        const payload = JSON.parse(Buffer.from(inviteCode.slice(REMOTE_INVITE_PREFIX.length), "base64url").toString("utf8"));
        if (payload.v !== 1 || typeof payload.inviteCode !== "string" || typeof payload.relayUrl !== "string") {
            throw new Error("Invalid payload");
        }
        return {
            inviteCode: payload.inviteCode,
            relayUrl: normalizeRelayUrl(payload.relayUrl)
        };
    }
    catch {
        throw new Error("Invalid remote AgentRoom invite token.");
    }
}
export function isRemoteLink(link) {
    return Boolean(link?.relayUrl && link.projectId && link.projectToken && (link.mode === "remote" || !link.roomDir));
}
async function buildRemoteProjectInput(projectRoot, input) {
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
async function prepareRemoteProjectFiles(projectRoot, project) {
    const agentRoomDir = getProjectAgentRoomDir(projectRoot);
    await ensureSafeDirectory(agentRoomDir);
    const permissionsPath = path.join(agentRoomDir, "permissions.md");
    if (!(await exists(permissionsPath))) {
        await writeTextFile(permissionsPath, defaultPermissionsMarkdown());
    }
    await writeTextFile(path.join(agentRoomDir, "project-card.md"), renderProjectCard(project));
}
async function relayRequest(relayUrl, endpoint, token, init) {
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
    return response.json();
}
async function listProjectFiles(root) {
    const results = [];
    async function walk(current, depth) {
        if (depth > 8)
            return;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
                continue;
            const absolute = path.join(current, entry.name);
            const relative = path.relative(root, absolute);
            if (entry.isDirectory()) {
                await walk(absolute, depth + 1);
            }
            else if (entry.isFile()) {
                results.push(relative);
            }
        }
    }
    await walk(root, 0);
    return results.sort();
}
function normalizeRelayUrl(relayUrl) {
    const parsed = new URL(relayUrl);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
}
//# sourceMappingURL=remote.js.map