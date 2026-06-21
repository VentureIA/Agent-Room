import { z } from "zod";
export declare const messageTypes: readonly ["FYI", "QUESTION", "ANSWER", "PROPOSAL", "DECISION", "BLOCKER", "CONTRACT_CHANGE", "ACCESS_REQUEST", "TEST_RESULT", "HANDOFF"];
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
    fields?: Array<{
        name: string;
        type: string;
        required: boolean;
    }>;
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
    summary: string;
};
export declare const connectProjectSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodString>;
    agentKind: z.ZodDefault<z.ZodString>;
    humanOwner: z.ZodDefault<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const questionSchema: z.ZodObject<{
    fromProjectId: z.ZodString;
    toProjectId: z.ZodString;
    topic: z.ZodString;
    question: z.ZodString;
    impact: z.ZodDefault<z.ZodString>;
    urgency: z.ZodDefault<z.ZodEnum<{
        low: "low";
        normal: "normal";
        blocking: "blocking";
    }>>;
}, z.core.$strip>;
export declare const answerSchema: z.ZodObject<{
    questionId: z.ZodString;
    answer: z.ZodString;
    suggestedResolution: z.ZodOptional<z.ZodString>;
    confidence: z.ZodDefault<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
}, z.core.$strip>;
export declare const decisionSchema: z.ZodObject<{
    title: z.ZodString;
    reason: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        proposed: "proposed";
        approved: "approved";
        rejected: "rejected";
        applied: "applied";
    }>>;
    approvedBy: z.ZodDefault<z.ZodArray<z.ZodString>>;
    affects: z.ZodDefault<z.ZodArray<z.ZodString>>;
    risk: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const contractSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    providerProjectId: z.ZodString;
    consumerProjectId: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        draft: "draft";
        deprecated: "deprecated";
    }>>;
    resources: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        name: z.ZodString;
        fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            type: z.ZodString;
            required: z.ZodBoolean;
        }, z.core.$strip>>>;
        payload: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    breakingChangesRequireHumanApproval: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
