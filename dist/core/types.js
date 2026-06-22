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
];
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
    files: z.array(z.object({
        path: z.string().min(1),
        content: z.string()
    })).default([])
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
    resources: z.array(z.object({
        kind: z.string(),
        name: z.string(),
        fields: z
            .array(z.object({ name: z.string(), type: z.string(), required: z.boolean() }))
            .optional(),
        payload: z.string().optional()
    })),
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
//# sourceMappingURL=types.js.map