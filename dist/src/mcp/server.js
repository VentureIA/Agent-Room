import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentRoomStore } from "../core/storage.js";
export async function runMcpServer(root = process.cwd()) {
    const store = new AgentRoomStore(root);
    await store.initialize();
    const server = new McpServer({
        name: "agentroom",
        version: "0.1.0"
    });
    server.registerTool("summarize_room", {
        title: "Summarize AgentRoom",
        description: "Return a human-readable summary of the current local AgentRoom.",
        inputSchema: {}
    }, async () => {
        const state = await store.getState();
        return text(state.summary);
    });
    server.registerTool("publish_project_card", {
        title: "Publish Project Card",
        description: "Connect the current project and publish its AgentRoom project card.",
        inputSchema: {
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner")
        }
    }, async (input) => text(JSON.stringify(await store.connectProject(input), null, 2)));
    server.registerTool("ask_question", {
        title: "Ask Question",
        description: "Ask a structured project-to-project question.",
        inputSchema: {
            fromProjectId: z.string(),
            toProjectId: z.string(),
            topic: z.string(),
            question: z.string(),
            impact: z.string(),
            urgency: z.enum(["low", "normal", "blocking"]).default("normal")
        }
    }, async (input) => text(JSON.stringify(await store.askQuestion(input), null, 2)));
    server.registerTool("answer_question", {
        title: "Answer Question",
        description: "Answer a structured AgentRoom question.",
        inputSchema: {
            questionId: z.string(),
            answer: z.string(),
            suggestedResolution: z.string().optional(),
            confidence: z.enum(["low", "medium", "high"]).default("medium")
        }
    }, async (input) => text(JSON.stringify(await store.answerQuestion(input), null, 2)));
    server.registerTool("record_decision", {
        title: "Record Decision",
        description: "Record a decision after human approval or as a proposal.",
        inputSchema: {
            title: z.string(),
            reason: z.string(),
            status: z.enum(["proposed", "approved", "rejected", "applied"]).default("proposed"),
            approvedBy: z.array(z.string()).default([]),
            affects: z.array(z.string()).default([]),
            risk: z.string().default("No risk documented yet.")
        }
    }, async (input) => text(JSON.stringify(await store.recordDecision(input), null, 2)));
    server.registerTool("publish_contract", {
        title: "Publish Contract",
        description: "Publish or update a simple integration contract.",
        inputSchema: {
            id: z.string().optional(),
            providerProjectId: z.string(),
            consumerProjectId: z.string(),
            version: z.string().default("v1"),
            status: z.enum(["draft", "active", "deprecated"]).default("draft"),
            resources: z.array(z.object({
                kind: z.string(),
                name: z.string(),
                fields: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() })).optional(),
                payload: z.string().optional()
            })),
            breakingChangesRequireHumanApproval: z.boolean().default(true)
        }
    }, async (input) => text(JSON.stringify(await store.publishContract(input), null, 2)));
    server.registerTool("read_inbox", {
        title: "Read Inbox",
        description: "Read open questions and pending decisions.",
        inputSchema: {}
    }, async () => {
        const state = await store.getState();
        return text(JSON.stringify({
            questions: state.questions.filter((question) => question.status === "open"),
            decisions: state.decisions.filter((decision) => decision.status === "proposed")
        }, null, 2));
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
function text(value) {
    return {
        content: [{ type: "text", text: value }]
    };
}
//# sourceMappingURL=server.js.map