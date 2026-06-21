import type { PermissionPolicy } from "./types.js";
export declare function parsePermissions(markdown: string): PermissionPolicy;
export declare function classifyPath(relativePath: string, policy: PermissionPolicy): "visible" | "ask-first" | "hidden";
export declare function readAllowedFile(root: string, relativePath: string, policy: PermissionPolicy): Promise<string>;
export declare function redactSecrets(content: string, terms: string[]): string;
