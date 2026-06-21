import type { Server } from "node:http";
import { AgentRoomStore } from "../core/storage.js";
export type RelayOptions = {
    port?: number;
    root?: string;
};
export declare function startRelay(options?: RelayOptions): Promise<{
    url: string;
    server: Server;
    store: AgentRoomStore;
}>;
