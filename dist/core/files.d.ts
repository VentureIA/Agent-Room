export declare function exists(filePath: string): Promise<boolean>;
export declare function readJson<T>(filePath: string): Promise<T | undefined>;
export declare function writeJson(filePath: string, value: unknown): Promise<void>;
export declare function writeTextFile(filePath: string, content: string): Promise<void>;
export declare function appendTextFile(filePath: string, content: string): Promise<void>;
export declare function ensureSafeDirectory(dirPath: string): Promise<void>;
export declare function listFiles(root: string, options?: {
    maxDepth?: number;
    ignored?: string[];
}): Promise<string[]>;
