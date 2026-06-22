import { z } from "zod";

export const messageTypes = [
  "FYI",
  "QUESTION",
  "ANSWER",
  "PROPOSAL",
  "DECISION",
  "BLOCKER",
  "CONTRACT_CHANGE",
  "ACCESS_REQUEST",
  "TEST_RESULT",
  "HANDOFF"
] as const;

export type MessageType = (typeof messageTypes)[number];

export type Room = {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  role: string;
  stack: string[];
  agentKind: string;
  humanOwner: string;
  createdAt: string;
};

export type Agent = {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  status: "active" | "idle" | "unknown";
};

export type Message = {
  id: string;
  roomId: string;
  fromAgentId: string;
  toAgentId?: string;
  type: MessageType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Question = {
  id: string;
  roomId: string;
  fromProjectId: string;
  toProjectId: string;
  topic: string;
  question: string;
  impact: string;
  urgency: "low" | "normal" | "blocking";
  status: "open" | "answered" | "closed";
  answer?: string;
  suggestedResolution?: string;
  confidence?: "low" | "medium" | "high";
  createdAt: string;
  answeredAt?: string;
};

export type ProjectSnapshotFile = {
  path: string;
  content: string;
};

export type ProjectSnapshot = {
  projectId: string;
  files: ProjectSnapshotFile[];
  updatedAt: string;
};

export type Decision = {
  id: string;
  roomId: string;
  title: string;
  reason: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  approvedBy: string[];
  affects: string[];
  risk: string;
  createdAt: string;
};

export type ContractResource = {
  kind: string;
  name: string;
  fields?: Array<{ name: string; type: string; required: boolean }>;
  payload?: string;
};

export type Contract = {
  id: string;
  providerProjectId: string;
  consumerProjectId: string;
  version: string;
  status: "draft" | "active" | "deprecated";
  resources: ContractResource[];
  breakingChangesRequireHumanApproval: boolean;
};

export type AccessRequest = {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  path: string;
  reason: string;
  scope: "read-only";
  status: "pending" | "approved" | "denied";
  createdAt: string;
};

export type FileActivityStatus = "editing" | "modified" | "staged";

export type FileActivity = {
  id: string;
  roomId: string;
  projectId: string;
  path: string;
  status: FileActivityStatus;
  branch?: string;
  repository?: string;
  lastCommit?: string;
  contentHash?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type FileAlert = {
  id: string;
  roomId: string;
  path: string;
  status: "active" | "continued" | "cancelled";
  triggeredByProjectId: string;
  conflictingProjectId: string;
  activityId?: string;
  conflictingActivityId?: string;
  branch?: string;
  repository?: string;
  lastCommit?: string;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByProjectId?: string;
  resolution?: "continue" | "cancel";
  note?: string;
};

export type FileEditCheck = {
  ok: boolean;
  requiresUserConfirmation: boolean;
  path: string;
  alerts: FileAlert[];
  message: string;
};

export type PermissionPolicy = {
  visible: string[];
  askFirst: string[];
  hidden: string[];
  alwaysRedact: string[];
};

export type RoomState = {
  room: Room;
  projects: Project[];
  agents: Agent[];
  messages: Message[];
  questions: Question[];
  decisions: Decision[];
  contracts: Contract[];
  accessRequests: AccessRequest[];
  fileActivities: FileActivity[];
  fileAlerts: FileAlert[];
  summary: string;
};

export const connectProjectSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  agentKind: z.string().default("Codex"),
  humanOwner: z.string().default("Human owner"),
  path: z.string().optional()
});

export const questionSchema = z.object({
  fromProjectId: z.string(),
  toProjectId: z.string(),
  topic: z.string().min(1),
  question: z.string().min(1),
  impact: z.string().default("Needs clarification before integration work continues."),
  urgency: z.enum(["low", "normal", "blocking"]).default("normal")
});

export const answerSchema = z.object({
  questionId: z.string(),
  answer: z.string().min(1),
  suggestedResolution: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).default("medium")
});

export const projectSnapshotSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string()
    })
  ).default([])
});

export const projectPermissionsSchema = z.object({
  markdown: z.string().min(1).max(100_000)
});

export const decisionSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  status: z.enum(["proposed", "approved", "rejected", "applied"]).default("proposed"),
  approvedBy: z.array(z.string()).default([]),
  affects: z.array(z.string()).default([]),
  risk: z.string().default("No risk documented yet.")
});

export const contractSchema = z.object({
  id: z.string().optional(),
  providerProjectId: z.string(),
  consumerProjectId: z.string(),
  version: z.string().default("v1"),
  status: z.enum(["draft", "active", "deprecated"]).default("draft"),
  resources: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      fields: z
        .array(z.object({ name: z.string(), type: z.string(), required: z.boolean() }))
        .optional(),
      payload: z.string().optional()
    })
  ),
  breakingChangesRequireHumanApproval: z.boolean().default(true)
});

export const fileActivitySchema = z.object({
  path: z.string().min(1),
  status: z.enum(["editing", "modified", "staged"]).default("modified"),
  branch: z.string().optional(),
  repository: z.string().optional(),
  lastCommit: z.string().optional(),
  contentHash: z.string().optional(),
  note: z.string().optional()
});

export const fileEditCheckSchema = fileActivitySchema.extend({
  intent: z.string().default("edit")
});

export const fileAlertConfirmationSchema = z.object({
  decision: z.enum(["continue", "cancel"]),
  confirmedBy: z.string().default("Human owner"),
  note: z.string().optional()
});
