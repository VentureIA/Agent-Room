import type { AccessRequest, Contract, Decision, Project, Question, Room, RoomState } from "./types.js";
export declare class AgentRoomStore {
    readonly projectRoot: string;
    readonly agentroomDir: string;
    private db?;
    constructor(projectRoot?: string);
    initialize(): Promise<Room>;
    connectProject(input: {
        name?: string;
        role?: string;
        agentKind?: string;
        humanOwner?: string;
        path?: string;
    }): Promise<Project>;
    getState(): Promise<RoomState>;
    askQuestion(input: Omit<Question, "id" | "roomId" | "status" | "createdAt">): Promise<Question>;
    answerQuestion(input: {
        questionId: string;
        answer: string;
        suggestedResolution?: string;
        confidence: "low" | "medium" | "high";
    }): Promise<Question>;
    recordDecision(input: Omit<Decision, "id" | "roomId" | "createdAt">): Promise<Decision>;
    publishContract(input: Omit<Contract, "id"> & {
        id?: string;
    }): Promise<Contract>;
    requestAccess(input: Omit<AccessRequest, "id" | "status" | "createdAt">): Promise<AccessRequest>;
    listVisibleFiles(): Promise<string[]>;
    close(): void;
    private openDb;
    private ensureSchema;
    private appendEvent;
    private appendJsonl;
    private writeRoomManifest;
    private writeDecisionsMarkdown;
}
