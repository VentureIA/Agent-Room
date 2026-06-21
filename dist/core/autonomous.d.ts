import type { AccessRequest, Project } from "./types.js";
import { AgentRoomStore } from "./storage.js";
export type ProcessInboxOptions = {
    maxQuestions?: number;
    maxFiles?: number;
};
export type ProcessInboxResult = {
    project: Project;
    answered: Array<{
        questionId: string;
        answer: string;
        confidence: "low" | "medium" | "high";
        evidenceFiles: string[];
    }>;
    skipped: Array<{
        questionId: string;
        reason: string;
        accessRequest?: AccessRequest;
    }>;
};
export declare function processInboxAutonomously(store: AgentRoomStore, options?: ProcessInboxOptions): Promise<ProcessInboxResult>;
