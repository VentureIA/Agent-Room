import type { AccessRequest, Project, Question } from "./types.js";
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
export type DirectQuestionResolution = {
    status: "answered";
    questionId: string;
    answer: string;
    confidence: "low" | "medium" | "high";
    evidenceFiles: string[];
    source: "local-project";
} | {
    status: "pending";
    questionId: string;
    reason: string;
    source: "local-project" | "remote-project" | "unavailable-project";
};
type Evidence = {
    file: string;
    line: number;
    text: string;
};
export type EvidenceReader = {
    listVisibleFiles(): Promise<string[]>;
    readAllowedProjectFile(relativePath: string): Promise<string>;
};
export declare function processInboxAutonomously(store: AgentRoomStore, options?: ProcessInboxOptions): Promise<ProcessInboxResult>;
export declare function resolveQuestionForLocalProject(store: AgentRoomStore, question: Question, toProject: Project, options?: ProcessInboxOptions): Promise<DirectQuestionResolution>;
export declare function draftAnswerFromEvidence(reader: EvidenceReader, question: Question, project: Project, maxFiles: number): Promise<{
    answer: string;
    suggestedResolution: string;
    confidence: "medium" | "high";
    evidence: Evidence[];
} | undefined>;
export {};
