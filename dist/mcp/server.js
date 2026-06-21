import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import open from "open";
import { z } from "zod";
import { processInboxAutonomously, resolveQuestionForLocalProject } from "../core/autonomous.js";
import { installMcpConfig } from "../core/install.js";
import { findRoomByInvite, readProjectLink } from "../core/registry.js";
import { connectRemoteRoom, joinRemoteRoom, RemoteAgentRoomClient } from "../core/remote.js";
import { setupAgentRoom } from "../core/setup.js";
import { AgentRoomStore } from "../core/storage.js";
import { startRelay } from "../server/relay.js";
const execFileAsync = promisify(execFile);
export async function runMcpServer(root = process.env.AGENTROOM_PROJECT_ROOT ?? process.cwd()) {
    const server = new McpServer({
        name: "agentroom",
        version: "0.1.3"
    });
    const requireStore = () => AgentRoomStore.requireLinkedProject(root);
    const requireClient = async () => (await RemoteAgentRoomClient.forLinkedProject(root)) ?? (await AgentRoomStore.requireLinkedProject(root));
    let dashboardRelay;
    const askWithDirectResolution = async (store, currentProject, toProject, input) => {
        const question = store instanceof RemoteAgentRoomClient
            ? await store.askQuestion({
                toProjectId: toProject.id,
                topic: input.topic,
                question: input.question,
                impact: input.impact,
                urgency: input.urgency
            })
            : await store.askQuestion({
                fromProjectId: currentProject.id,
                toProjectId: toProject.id,
                topic: input.topic,
                question: input.question,
                impact: input.impact,
                urgency: input.urgency
            });
        if (input.direct === false || store instanceof RemoteAgentRoomClient) {
            return {
                question,
                directAnswer: {
                    status: "pending",
                    reason: store instanceof RemoteAgentRoomClient
                        ? "Remote rooms need the target project agent or a relay-side worker to answer asynchronously."
                        : "Direct resolution was disabled for this question."
                }
            };
        }
        const directAnswer = await resolveQuestionForLocalProject(store, question, toProject, { maxFiles: input.maxFiles ?? 50 });
        return {
            question: directAnswer.status === "answered"
                ? {
                    ...question,
                    status: "answered",
                    answer: directAnswer.answer,
                    confidence: directAnswer.confidence
                }
                : question,
            directAnswer
        };
    };
    registerAgentRoomPrompts(server);
    server.registerTool("setup_project", {
        title: "Setup AgentRoom Project",
        description: "Prepare the current project for AgentRoom from inside the agent interface. Creates or repairs permissions, project card, agent guide, and MCP config files.",
        inputSchema: {
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner")
        }
    }, async (input) => {
        const setup = await setupAgentRoom(root, input);
        return text(JSON.stringify({
            project: setup.project,
            room: setup.room,
            createdRoom: setup.createdRoom,
            sharedRoom: setup.store.roomDir,
            files: setup.files
        }, null, 2));
    });
    server.registerTool("install_client_config", {
        title: "Install Client Config",
        description: "Install AgentRoom MCP into a project-local or custom Codex/Claude Code JSON config file.",
        inputSchema: {
            client: z.enum(["codex", "claude"]),
            configPath: z.string().optional(),
            scope: z.enum(["project", "custom"]).default("project"),
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner")
        }
    }, async (input) => text(JSON.stringify(await installMcpConfig(root, input), null, 2)));
    server.registerTool("install_all_client_configs", {
        title: "Install All Client Configs",
        description: "Install project-local AgentRoom MCP configs for both Codex and Claude Code.",
        inputSchema: {
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner")
        }
    }, async (input) => {
        const codex = await installMcpConfig(root, { ...input, client: "codex" });
        const claude = await installMcpConfig(root, { ...input, client: "claude" });
        return text(JSON.stringify({ codex, claude }, null, 2));
    });
    server.registerTool("connect_project", {
        title: "Connect Project",
        description: "Connect the current project to a new or existing local AgentRoom and publish its project card.",
        inputSchema: {
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner"),
            relayUrl: z.string().url().optional(),
            relayAdminToken: z.string().optional()
        }
    }, async (input) => {
        if (input.relayUrl) {
            const connected = await connectRemoteRoom(root, input.relayUrl, input.relayAdminToken ?? process.env.AGENTROOM_RELAY_ADMIN_TOKEN, input);
            return text(JSON.stringify(connected, null, 2));
        }
        const connected = await AgentRoomStore.createSharedRoom(root, input);
        return text(JSON.stringify({
            project: connected.project,
            room: connected.room,
            inviteCode: connected.room.inviteCode,
            sharedRoom: connected.record.roomDir,
            projectFiles: connected.store.projectAgentRoomDir
        }, null, 2));
    });
    server.registerTool("join_room", {
        title: "Join Room",
        description: "Join an existing local AgentRoom from an invite code and register the current project.",
        inputSchema: {
            inviteCode: z.string(),
            name: z.string().optional(),
            role: z.string().optional(),
            agentKind: z.string().default("Codex"),
            humanOwner: z.string().default("Human owner"),
            relayUrl: z.string().url().optional()
        }
    }, async (input) => {
        if (input.relayUrl) {
            const joined = await joinRemoteRoom(root, input.relayUrl, input.inviteCode, input);
            return text(JSON.stringify(joined, null, 2));
        }
        const record = await findRoomByInvite(input.inviteCode);
        if (!record)
            throw new Error(`No local AgentRoom invite found for ${input.inviteCode}.`);
        const joined = await AgentRoomStore.joinSharedRoom(root, record, input);
        return text(JSON.stringify({
            project: joined.project,
            room: joined.room,
            inviteCode: joined.room.inviteCode,
            sharedRoom: record.roomDir
        }, null, 2));
    });
    server.registerTool("get_current_project", {
        title: "Get Current Project",
        description: "Return the AgentRoom project associated with the current MCP server working directory.",
        inputSchema: {}
    }, async () => text(JSON.stringify(await (await requireClient()).getCurrentProject(), null, 2)));
    server.registerTool("get_status", {
        title: "Get AgentRoom Status",
        description: "Return room status, project counts, and local link information for the current project.",
        inputSchema: {}
    }, async () => {
        const client = await requireClient();
        const state = await client.getState();
        const link = await readProjectLink(root);
        return text(JSON.stringify({
            room: state.room,
            counts: {
                projects: state.projects.length,
                questions: state.questions.length,
                openQuestions: state.questions.filter((question) => question.status === "open").length,
                decisions: state.decisions.length,
                contracts: state.contracts.length
            },
            linkedRoom: link?.mode === "remote" ? link.relayUrl : link?.roomDir
        }, null, 2));
    });
    server.registerTool("open_dashboard", {
        title: "Open Dashboard",
        description: "Start the local AgentRoom dashboard relay from MCP and return the launch-token URL for the human approval cockpit.",
        inputSchema: {
            port: z.number().int().min(0).max(65535).default(4317),
            openBrowser: z.boolean().default(true)
        }
    }, async (input) => {
        const link = await readProjectLink(root);
        if (link?.mode === "remote") {
            if (link.dashboardUrl) {
                if (input.openBrowser)
                    await open(link.dashboardUrl);
                return text(JSON.stringify({
                    url: link.dashboardUrl,
                    openedBrowser: input.openBrowser,
                    mode: "remote",
                    relayUrl: link.relayUrl,
                    inviteCode: link.inviteCode
                }, null, 2));
            }
            return text(JSON.stringify({
                mode: "remote",
                relayUrl: link.relayUrl,
                inviteCode: link.inviteCode,
                dashboardUrl: null,
                note: "This project joined a hosted room but does not store the human dashboard token. Ask the room creator for the dashboard link printed by connect_project."
            }, null, 2));
        }
        if (!dashboardRelay)
            dashboardRelay = await startRelay({ root, port: input.port });
        if (input.openBrowser)
            await open(dashboardRelay.url);
        const publicUrl = new URL(dashboardRelay.url).origin;
        return text(JSON.stringify({
            url: publicUrl,
            openedBrowser: input.openBrowser,
            sharedRoom: dashboardRelay.store.roomDir
        }, null, 2));
    });
    server.registerTool("start_agent_session", {
        title: "Start Agent Session",
        description: "Run the recommended AgentRoom startup workflow: status, current project, room summary, inbox, and safe autonomous inbox processing.",
        inputSchema: {
            processInbox: z.boolean().default(true),
            maxQuestions: z.number().int().positive().max(20).default(5),
            maxFiles: z.number().int().positive().max(200).default(30)
        }
    }, async (input) => {
        const store = await requireClient();
        const processed = input.processInbox
            ? store instanceof RemoteAgentRoomClient
                ? await store.processInboxAutonomously({ maxQuestions: input.maxQuestions, maxFiles: input.maxFiles })
                : await processInboxAutonomously(store, { maxQuestions: input.maxQuestions, maxFiles: input.maxFiles })
            : undefined;
        const state = await store.getState();
        const currentProject = await store.getCurrentProject();
        const inbox = buildMcpInbox(state, currentProject.id);
        return text(JSON.stringify({
            currentProject,
            room: state.room,
            summary: state.summary,
            inbox,
            processed
        }, null, 2));
    });
    server.registerTool("coordinate_task_context", {
        title: "Coordinate Task Context",
        description: "Before doing a task, autonomously process this project's inbox, inspect connected projects, ask needed context questions, and return direct answers when available. Use this proactively; do not wait for the human to request AgentRoom.",
        inputSchema: {
            goal: z.string(),
            autoAsk: z.boolean().default(true),
            includeProjectSummaries: z.boolean().default(true),
            maxProjects: z.number().int().positive().max(10).default(4),
            maxQuestions: z.number().int().positive().max(20).default(5),
            maxFiles: z.number().int().positive().max(200).default(50)
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        const processed = store instanceof RemoteAgentRoomClient
            ? await store.processInboxAutonomously({ maxQuestions: input.maxQuestions, maxFiles: input.maxFiles })
            : await processInboxAutonomously(store, { maxQuestions: input.maxQuestions, maxFiles: input.maxFiles });
        const state = await store.getState();
        const otherProjects = selectCoordinationTargets(state.projects, currentProject, input.goal, input.maxProjects);
        const shouldAsk = input.autoAsk && input.includeProjectSummaries && shouldAutoAskForContext(input.goal, otherProjects);
        const contextQuestions = [];
        if (shouldAsk) {
            for (const project of otherProjects) {
                const questionText = buildTaskContextQuestion(input.goal, project);
                const existing = findExistingContextQuestion(state.questions, currentProject.id, project.id, questionText);
                if (existing) {
                    contextQuestions.push({
                        project: projectSummary(project),
                        question: existing,
                        directAnswer: existing.status === "answered"
                            ? {
                                status: "answered",
                                questionId: existing.id,
                                answer: existing.answer,
                                confidence: existing.confidence ?? "medium",
                                source: "existing-question"
                            }
                            : {
                                status: "pending",
                                questionId: existing.id,
                                reason: "A matching question is already open."
                            },
                        reusedExistingAnswer: true
                    });
                    continue;
                }
                const asked = await askWithDirectResolution(store, currentProject, project, {
                    topic: "task.context",
                    question: questionText,
                    impact: `The current task may depend on ${project.name}'s context.`,
                    urgency: "normal",
                    direct: true,
                    maxFiles: input.maxFiles
                });
                contextQuestions.push({
                    project: projectSummary(project),
                    question: asked.question,
                    directAnswer: asked.directAnswer,
                    reusedExistingAnswer: false
                });
            }
        }
        return text(JSON.stringify({
            currentProject,
            goal: input.goal,
            processedInbox: processed,
            connectedProjects: state.projects.map(projectSummary),
            autoAsked: shouldAsk,
            contextQuestions,
            instruction: "Use answered context immediately. If directAnswer.status is pending, continue only when the missing context is non-blocking; otherwise explain the blocker and what AgentRoom is waiting for. Keep using ask_question proactively whenever new cross-project uncertainty appears."
        }, null, 2));
    });
    server.registerTool("list_projects", {
        title: "List Projects",
        description: "List projects connected to the current AgentRoom.",
        inputSchema: {}
    }, async () => {
        const state = await (await requireClient()).getState();
        return text(JSON.stringify(state.projects, null, 2));
    });
    server.registerTool("get_invite_code", {
        title: "Get Invite Code",
        description: "Return the local invite code for adding another project to this AgentRoom.",
        inputSchema: {}
    }, async () => {
        const remote = await RemoteAgentRoomClient.forLinkedProject(root);
        if (remote)
            return text(remote.link.inviteCode);
        const room = await (await requireStore()).initialize();
        return text(room.inviteCode);
    });
    server.registerTool("summarize_room", {
        title: "Summarize AgentRoom",
        description: "Return a human-readable summary of the current local AgentRoom.",
        inputSchema: {}
    }, async () => {
        const store = await requireClient();
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
    }, async (input) => {
        const remote = await RemoteAgentRoomClient.forLinkedProject(root);
        if (remote)
            return text(JSON.stringify(await remote.getCurrentProject(), null, 2));
        return text(JSON.stringify(await (await requireStore()).connectProject(input), null, 2));
    });
    server.registerTool("ask_question", {
        title: "Ask Question",
        description: "Ask a structured project-to-project question. By default AgentRoom immediately tries to resolve local target-project questions and returns the answer inline when evidence is available.",
        inputSchema: {
            toProject: z.string(),
            topic: z.string(),
            question: z.string(),
            impact: z.string(),
            urgency: z.enum(["low", "normal", "blocking"]).default("normal"),
            direct: z.boolean().default(true),
            maxFiles: z.number().int().positive().max(200).default(50)
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        const toProject = await store.getProjectByReference(input.toProject);
        const result = await askWithDirectResolution(store, currentProject, toProject, input);
        return text(JSON.stringify({
            ...result,
            instruction: result.directAnswer.status === "answered"
                ? "Show this answer directly to the user now. Do not ask them to call read_inbox or process_inbox."
                : "Tell the user the question is pending and explain the reason. Do not pretend the target project answered."
        }, null, 2));
    });
    server.registerTool("answer_question", {
        title: "Answer Question",
        description: "Answer a structured AgentRoom question.",
        inputSchema: {
            questionId: z.string(),
            answer: z.string(),
            suggestedResolution: z.string().optional(),
            confidence: z.enum(["low", "medium", "high"]).default("medium")
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        return text(JSON.stringify(await store.answerQuestionForProject(currentProject.id, input), null, 2));
    });
    server.registerTool("record_decision", {
        title: "Record Decision",
        description: "Record a decision after human approval or as a proposal.",
        inputSchema: {
            title: z.string(),
            reason: z.string(),
            affects: z.array(z.string()).default([]),
            risk: z.string().default("No risk documented yet.")
        }
    }, async (input) => {
        const store = await requireClient();
        return text(JSON.stringify(await store.recordDecision({
            ...input,
            status: "proposed",
            approvedBy: []
        }), null, 2));
    });
    server.registerTool("publish_contract", {
        title: "Publish Contract",
        description: "Publish or update a simple integration contract.",
        inputSchema: {
            id: z.string().optional(),
            providerProjectId: z.string(),
            consumerProjectId: z.string(),
            version: z.string().default("v1"),
            resources: z.array(z.object({
                kind: z.string(),
                name: z.string(),
                fields: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() })).optional(),
                payload: z.string().optional()
            })),
            breakingChangesRequireHumanApproval: z.boolean().default(true)
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        if (input.providerProjectId !== currentProject.id && input.consumerProjectId !== currentProject.id) {
            throw new Error("Current project must be the provider or consumer for contracts published through MCP.");
        }
        return text(JSON.stringify(await store.publishContract({ ...input, status: "draft" }), null, 2));
    });
    server.registerTool("read_inbox", {
        title: "Read Inbox",
        description: "Read open questions and pending decisions.",
        inputSchema: {}
    }, async () => {
        const store = await requireClient();
        const state = await store.getState();
        const currentProject = await store.getCurrentProject();
        return text(JSON.stringify(buildMcpInbox(state, currentProject.id), null, 2));
    });
    server.registerTool("list_visible_files", {
        title: "List Visible Files",
        description: "List project-relative files visible under this project's AgentRoom permissions.",
        inputSchema: {
            limit: z.number().int().positive().max(1000).default(200)
        }
    }, async (input) => {
        const store = await requireClient();
        const files = await store.listVisibleFiles();
        return text(JSON.stringify(files.slice(0, input.limit), null, 2));
    });
    server.registerTool("read_permissions", {
        title: "Read Permissions",
        description: "Read the current project's AgentRoom permissions markdown.",
        inputSchema: {}
    }, async () => {
        const remote = await RemoteAgentRoomClient.forLinkedProject(root);
        if (remote)
            return text(await remote.readPermissionsMarkdown());
        return text(await (await requireStore()).readPermissionsMarkdown());
    });
    server.registerTool("propose_permissions_update", {
        title: "Propose Permissions Update",
        description: "Create a proposed decision with replacement permissions markdown. The dashboard/human approval path must apply sensitive permission changes.",
        inputSchema: {
            markdown: z.string(),
            reason: z.string().default("Agent proposes updated AgentRoom visibility rules.")
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        return text(JSON.stringify(await store.recordDecision({
            title: `Update AgentRoom permissions for ${currentProject.name}`,
            reason: `${input.reason}\n\nProposed permissions:\n\n${input.markdown}`,
            status: "proposed",
            approvedBy: [],
            affects: [currentProject.name],
            risk: "Changing visible paths may expose sensitive files if reviewed carelessly."
        }), null, 2));
    });
    server.registerTool("read_allowed_file", {
        title: "Read Allowed File",
        description: "Read a project-relative file only if AgentRoom permissions mark it visible. Secret-like values are redacted.",
        inputSchema: {
            path: z.string()
        }
    }, async (input) => text(await (await requireClient()).readAllowedProjectFile(input.path)));
    server.registerTool("check_file_before_edit", {
        title: "Check File Before Edit",
        description: "Preflight a file edit. If another project has touched the same file, stop and ask the human for native yes/no confirmation before editing.",
        inputSchema: {
            path: z.string(),
            intent: z.string().default("edit"),
            note: z.string().optional()
        }
    }, async (input) => {
        const client = await requireClient();
        const currentProject = await client.getCurrentProject();
        const activity = await buildFileActivityInput(root, input.path, "editing", input.note ?? `Intent: ${input.intent}`);
        const result = client instanceof RemoteAgentRoomClient
            ? await client.checkFileBeforeEdit({ ...activity, intent: input.intent })
            : await client.checkFileBeforeEditForProject(currentProject.id, { ...activity, intent: input.intent });
        return text(JSON.stringify({
            ...result,
            currentProject,
            userPrompt: result.requiresUserConfirmation ? buildFileAlertPrompt(result.path, result.alerts.length) : null,
            nextTool: result.requiresUserConfirmation ? "confirm_file_alert" : null,
            nativeInstruction: result.requiresUserConfirmation
                ? "Stop. Ask the human in Codex/Claude whether to continue despite this AgentRoom file alert. Do not edit the file until the human explicitly says yes."
                : "Safe to continue."
        }, null, 2));
    });
    server.registerTool("confirm_file_alert", {
        title: "Confirm File Alert",
        description: "Record the human yes/no decision after check_file_before_edit returned requiresUserConfirmation.",
        inputSchema: {
            alertId: z.string(),
            decision: z.enum(["continue", "cancel"]),
            confirmedBy: z.string().default("Human owner"),
            note: z.string().optional()
        }
    }, async (input) => {
        const client = await requireClient();
        const currentProject = await client.getCurrentProject();
        const alert = client instanceof RemoteAgentRoomClient
            ? await client.confirmFileAlert(input)
            : await client.confirmFileAlertForProject(currentProject.id, input);
        return text(JSON.stringify({
            alert,
            mayEdit: input.decision === "continue",
            nativeInstruction: input.decision === "continue"
                ? "The human approved continuing despite the AgentRoom file alert. You may edit the file."
                : "The human cancelled. Do not edit the file; coordinate with the other project first."
        }, null, 2));
    });
    server.registerTool("publish_file_activity", {
        title: "Publish File Activity",
        description: "Publish that this project is editing, modified, or staged on a project-relative file path.",
        inputSchema: {
            path: z.string(),
            status: z.enum(["editing", "modified", "staged"]).default("modified"),
            note: z.string().optional()
        }
    }, async (input) => {
        const client = await requireClient();
        const activityInput = await buildFileActivityInput(root, input.path, input.status, input.note);
        const activity = client instanceof RemoteAgentRoomClient
            ? await client.publishFileActivity(activityInput)
            : await client.publishFileActivity(activityInput);
        return text(JSON.stringify(activity, null, 2));
    });
    server.registerTool("list_file_alerts", {
        title: "List File Alerts",
        description: "List active and recently resolved AgentRoom file collision alerts for this project.",
        inputSchema: {}
    }, async () => {
        const client = await requireClient();
        const currentProject = await client.getCurrentProject();
        const alerts = client instanceof RemoteAgentRoomClient
            ? await client.listFileAlerts()
            : await client.listFileAlertsForProject(currentProject.id);
        return text(JSON.stringify(alerts, null, 2));
    });
    server.registerTool("request_access", {
        title: "Request Access",
        description: "Record a read-only access request instead of reading hidden or ask-first files directly.",
        inputSchema: {
            toProjectId: z.string(),
            path: z.string(),
            reason: z.string()
        }
    }, async (input) => {
        const store = await requireClient();
        const currentProject = await store.getCurrentProject();
        return text(JSON.stringify(await store.requestAccess({
            fromProjectId: currentProject.id,
            toProjectId: input.toProjectId,
            path: input.path,
            reason: input.reason,
            scope: "read-only"
        }), null, 2));
    });
    server.registerTool("process_inbox", {
        title: "Process Inbox",
        description: "Autonomously answer open questions for the current project when visible files provide evidence.",
        inputSchema: {
            maxQuestions: z.number().int().positive().max(20).default(5),
            maxFiles: z.number().int().positive().max(200).default(30)
        }
    }, async (input) => {
        const client = await requireClient();
        const result = client instanceof RemoteAgentRoomClient
            ? await client.processInboxAutonomously(input)
            : await processInboxAutonomously(client, input);
        return text(JSON.stringify(result, null, 2));
    });
    server.registerTool("report_test_result", {
        title: "Report Test Result",
        description: "Publish a test result event to the shared AgentRoom timeline.",
        inputSchema: {
            status: z.enum(["passed", "failed", "skipped"]),
            command: z.string(),
            summary: z.string(),
            affects: z.array(z.string()).default([])
        }
    }, async (input) => text(JSON.stringify(await (await requireClient()).reportTestResult(input), null, 2)));
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
function registerAgentRoomPrompts(server) {
    server.registerPrompt("agentroom_start_session", {
        description: "Start a coding session with AgentRoom context, inbox processing, and safety boundaries.",
        argsSchema: {
            goal: z.string().optional().describe("The user's current coding goal")
        }
    }, async ({ goal }) => promptText(`Start this session with AgentRoom.

Goal: ${goal ?? "No explicit goal provided."}

Use the MCP tools in this order:
1. Call setup_project if the project is not connected yet.
2. Call coordinate_task_context with the user's goal before starting implementation, even if the human did not explicitly ask for AgentRoom.
3. Use answered context immediately. If coordinate_task_context answered incoming inbox questions, include that evidence in your working context.
4. If new cross-project uncertainty appears while working, call ask_question immediately. ask_question tries direct resolution by default; when it returns directAnswer.status="answered", show and use that answer inline instead of telling the user to open the inbox later.
5. Only ask the human about AgentRoom when context is still blocking after automatic direct resolution and the target project is remote, offline, or lacks visible evidence.
6. Before editing or creating a file, call check_file_before_edit. If it returns requiresUserConfirmation, ask the human yes/no in the native agent chat and wait before editing.
7. Before touching shared contracts or sensitive permissions, create a proposed decision or request access.
8. Do not ask the human to run terminal commands unless MCP setup itself is missing.`));
    server.registerPrompt("agentroom_resolve_blockers", {
        description: "Resolve open AgentRoom questions and blockers conservatively.",
        argsSchema: {}
    }, async () => promptText(`Resolve AgentRoom blockers for this project.

Use read_inbox first. For each open question addressed to this project:
- Use process_inbox for evidence-backed automatic answers without waiting for the human.
- If evidence is insufficient, inspect list_visible_files and read_allowed_file.
- If required evidence is hidden or ask-first, call request_access.
- Never answer from a guess. Leave the question open when the evidence is not strong enough.`));
    server.registerPrompt("agentroom_publish_contract", {
        description: "Prepare a shared integration contract safely.",
        argsSchema: {
            contractGoal: z.string().optional().describe("What the contract should describe")
        }
    }, async ({ contractGoal }) => promptText(`Prepare an AgentRoom contract.

Contract goal: ${contractGoal ?? "Not specified."}

Use list_projects and summarize_room. Draft the smallest contract that describes the shared boundary. Call publish_contract only as draft. If the contract would be breaking or activate/deprecate behavior, record_decision first for human approval.`));
    server.registerPrompt("agentroom_review_permissions", {
        description: "Review project visibility and propose safe AgentRoom permissions.",
        argsSchema: {}
    }, async () => promptText(`Review AgentRoom permissions for this project.

Use read_permissions and list_visible_files. Identify files that should be visible, ask-first, hidden, or always redacted. Do not call update_permissions until the human explicitly approves the final markdown.`));
}
function selectCoordinationTargets(projects, currentProject, goal, maxProjects) {
    const normalizedGoal = goal.toLowerCase();
    return projects
        .filter((project) => project.id !== currentProject.id)
        .map((project) => ({
        project,
        score: (normalizedGoal.includes(project.name.toLowerCase()) ? 20 : 0) +
            (project.stack.some((item) => normalizedGoal.includes(item.toLowerCase())) ? 8 : 0) +
            (project.role && normalizedGoal.includes(project.role.toLowerCase()) ? 5 : 0)
    }))
        .sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name))
        .slice(0, maxProjects)
        .map((item) => item.project);
}
function shouldAutoAskForContext(goal, targets) {
    if (targets.length === 0)
        return false;
    return /\b(api|auth|contract|schema|endpoint|webhook|import|sync|integration|connect|shared|provider|consumer|database|migration|deploy|wordpress|saas|context|contexte|intégration|integration|connecter|connecte|synchroniser|importer|résume|resume|objectif)\b/i.test(goal);
}
function buildTaskContextQuestion(goal, project) {
    return [
        `For this task: "${goal}"`,
        `What should ${project.name} share with the current project?`,
        "Answer with the relevant purpose, architecture, endpoints, schemas, contracts, webhooks, files, constraints, and risks. Cite visible evidence when possible."
    ].join("\n");
}
function findExistingContextQuestion(questions, fromProjectId, toProjectId, questionText) {
    return questions
        .filter((question) => question.fromProjectId === fromProjectId &&
        question.toProjectId === toProjectId &&
        question.topic === "task.context" &&
        question.question === questionText &&
        question.status !== "closed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
function projectSummary(project) {
    return {
        id: project.id,
        name: project.name,
        role: project.role,
        stack: project.stack,
        path: project.path
    };
}
function promptText(value) {
    return {
        messages: [
            {
                role: "user",
                content: { type: "text", text: value }
            }
        ]
    };
}
function buildMcpInbox(state, currentProjectId) {
    return {
        questions: state.questions.filter((question) => question.status === "open" && question.toProjectId === currentProjectId),
        decisions: state.decisions.filter((decision) => decision.status === "proposed"),
        accessRequests: state.accessRequests.filter((request) => request.status === "pending" && request.toProjectId === currentProjectId),
        fileAlerts: state.fileAlerts.filter((alert) => alert.status === "active" && (alert.triggeredByProjectId === currentProjectId || alert.conflictingProjectId === currentProjectId))
    };
}
function text(value) {
    return {
        content: [{ type: "text", text: value }]
    };
}
async function buildFileActivityInput(root, filePath, status, note) {
    const [branch, repository, lastCommit] = await Promise.all([
        gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
        gitOutput(root, ["config", "--get", "remote.origin.url"]),
        gitOutput(root, ["rev-parse", "HEAD"])
    ]);
    return {
        path: filePath,
        status,
        branch,
        repository,
        lastCommit,
        note
    };
}
async function gitOutput(root, args) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", root, ...args], { timeout: 2000 });
        const value = stdout.trim();
        return value || undefined;
    }
    catch {
        return undefined;
    }
}
function buildFileAlertPrompt(filePath, alertCount) {
    return `AgentRoom detected ${alertCount} possible file collision(s) for ${filePath}. Another connected project has touched this file. Continue anyway? Reply yes to continue, or no to stop and coordinate.`;
}
//# sourceMappingURL=server.js.map