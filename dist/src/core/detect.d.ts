export type ProjectDetection = {
    name: string;
    role: string;
    stack: string[];
    agentHints: string[];
};
export declare function detectProject(projectPath: string): Promise<ProjectDetection>;
