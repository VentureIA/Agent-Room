import { type Server } from "node:http";
export type HostedRelayOptions = {
    port?: number;
    host?: string;
    dataDir?: string;
    adminToken?: string;
    allowOpenRoomCreate?: boolean;
};
export declare function startHostedRelay(options?: HostedRelayOptions): Promise<{
    url: string;
    server: Server;
}>;
