import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  CircleHelp,
  FileKey2,
  FileWarning,
  FolderCheck,
  GitBranch,
  Globe2,
  KeyRound,
  Link2,
  MessageSquarePlus,
  ShieldQuestion,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldAlert,
  SplitSquareHorizontal,
  Trash2
} from "lucide-react";
import "./styles.css";

type Project = {
  id: string;
  name: string;
  role: string;
  stack: string[];
  agentKind: string;
  humanOwner: string;
};

type Question = {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  topic: string;
  question: string;
  impact: string;
  urgency: "low" | "normal" | "blocking";
  status: "open" | "answered" | "closed";
  answer?: string;
};

type Decision = {
  id: string;
  title: string;
  reason: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  approvedBy: string[];
  affects: string[];
  risk: string;
};

type Contract = {
  id: string;
  providerProjectId: string;
  consumerProjectId: string;
  version: string;
  status: "draft" | "active" | "deprecated";
  resources: Array<{ kind: string; name: string }>;
};

type AccessRequest = {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  path: string;
  reason: string;
  scope: "read-only";
  status: "pending" | "approved" | "denied";
};

type FileAlert = {
  id: string;
  path: string;
  status: "active" | "continued" | "cancelled";
  triggeredByProjectId: string;
  conflictingProjectId: string;
  reason: string;
  createdAt: string;
  resolution?: "continue" | "cancel";
};

type RoomState = {
  room: { id: string; name: string; inviteCode: string };
  projects: Project[];
  questions: Question[];
  decisions: Decision[];
  contracts: Contract[];
  accessRequests: AccessRequest[];
  fileAlerts: FileAlert[];
  summary: string;
};

type DashboardInfo = {
  mode: "local" | "remote";
  roomId?: string;
  inviteCode?: string;
  currentProjectId?: string;
};

type PermissionSection = "visible" | "askFirst" | "hidden" | "alwaysRedact";

type PermissionDraft = Record<PermissionSection, string[]>;

const emptyState: RoomState = {
  room: { id: "", name: "AgentRoom", inviteCode: "" },
  projects: [],
  questions: [],
  decisions: [],
  contracts: [],
  accessRequests: [],
  fileAlerts: [],
  summary: ""
};

function App() {
  const [state, setState] = useState<RoomState>(emptyState);
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo>({ mode: "local" });
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState("");

  async function refresh() {
    const nextState = await fetchJson<RoomState>("/api/state");
    setState(nextState);
    setLoading(false);
  }

  useEffect(() => {
    fetchJson<DashboardInfo>("/api/dashboard-info")
      .then(setDashboardInfo)
      .catch(() => setDashboardInfo({ mode: "local" }));
    refresh().catch(() => setLoading(false));
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as { type: string; state: RoomState };
      if (payload.type === "state") setState(payload.state);
    });
    return () => socket.close();
  }, []);

  const metrics = useMemo(
    () => ({
      incompatibilities: state.questions.filter((question) => question.urgency === "blocking" && question.status === "open").length,
      openQuestions: state.questions.filter((question) => question.status === "open").length,
      pendingDecisions: state.decisions.filter((decision) => decision.status === "proposed").length,
      pendingAccess: state.accessRequests.filter((request) => request.status === "pending").length,
      activeFileAlerts: state.fileAlerts.filter((alert) => alert.status === "active").length,
      syncedContracts: state.contracts.filter((contract) => contract.status === "active").length
    }),
    [state]
  );

  async function connectCurrentProject() {
    setActionStatus("Connecting project...");
    await fetchJson("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentKind: "Codex" })
    });
    setActionStatus("Project connected.");
    await refresh();
  }

  async function seedDemo() {
    if (state.projects.length < 1) await connectCurrentProject();
    const latest = await fetchJson<RoomState>("/api/state");
    const from = latest.projects[0];
    const to = latest.projects[1] ?? latest.projects[0];
    if (!from || !to) return;
    await fetchJson("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromProjectId: from.id,
        toProjectId: to.id,
        topic: "case_study.heroImage",
        question: "Is heroImage always present?",
        impact: "The consuming project may render a broken page if the field is null.",
        urgency: "blocking"
      })
    });
    await fetchJson("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Use fallback image when heroImage is null",
        reason: "Older content can exist without a hero image.",
        status: "proposed",
        affects: [from.name, to.name],
        risk: "Pages may show empty media until the fallback is implemented."
      })
    });
    setActionStatus("Demo coordination items added.");
    await refresh();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dashboardInfo.mode === "remote" ? "Hosted relay online" : "Local relay online"}</p>
          <h1>AgentRoom</h1>
        </div>
        <div className="top-actions">
          <span className="invite">
            <KeyRound size={16} /> {state.room.inviteCode || "No invite yet"}
          </span>
          <button className="icon-button" onClick={refresh} aria-label="Refresh dashboard" title="Refresh dashboard">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {dashboardInfo.mode === "local" ? (
        <section className="command-strip">
          <button onClick={connectCurrentProject}>
            <Link2 size={18} /> Connect project
          </button>
          <button onClick={seedDemo}>
            <MessageSquarePlus size={18} /> Add demo flow
          </button>
          <span>{actionStatus || (loading ? "Loading room state..." : "Ready")}</span>
        </section>
      ) : (
        <section className="command-strip">
          <span>{actionStatus || (loading ? "Loading remote room state..." : "Remote dashboard ready")}</span>
        </section>
      )}

      <section className="overview">
        <Metric label="Incompatibilities" value={metrics.incompatibilities} tone="danger" />
        <Metric label="Open questions" value={metrics.openQuestions} tone="ink" />
        <Metric label="Decisions to validate" value={metrics.pendingDecisions} tone="warn" />
        <Metric label="Access requests" value={metrics.pendingAccess} tone="violet" />
        <Metric label="File alerts" value={metrics.activeFileAlerts} tone="danger" />
      </section>

      <section className="project-map">
        <ProjectPane project={state.projects[0]} fallback="Connect the provider project" />
        <div className="bridge" aria-label="Project dependency bridge">
          <SplitSquareHorizontal size={24} />
          <span>{state.contracts.length} contracts</span>
        </div>
        <ProjectPane project={state.projects[1]} fallback="Connect the consumer project" />
      </section>

      <section className="work-grid">
        <Panel title="Questions" icon={<CircleHelp size={18} />}>
          {state.questions.length === 0 ? (
            <Empty text="No structured questions yet." />
          ) : (
            state.questions.map((question) => <QuestionRow key={question.id} question={question} projects={state.projects} />)
          )}
        </Panel>

        <Panel title="Decisions" icon={<CheckCircle2 size={18} />}>
          {state.decisions.length === 0 ? (
            <Empty text="No decisions recorded yet." />
          ) : (
            state.decisions.map((decision) => <DecisionRow key={decision.id} decision={decision} onRefresh={refresh} />)
          )}
        </Panel>

        <Panel title="Access" icon={<ShieldQuestion size={18} />}>
          {state.accessRequests.length === 0 ? (
            <Empty text="No access requests yet." />
          ) : (
            state.accessRequests.map((request) => <AccessRequestRow key={request.id} request={request} projects={state.projects} onRefresh={refresh} />)
          )}
        </Panel>

        <Panel title="File Alerts" icon={<FileWarning size={18} />}>
          {state.fileAlerts.length === 0 ? (
            <Empty text="No file collision alerts yet." />
          ) : (
            state.fileAlerts.map((alert) => <FileAlertRow key={alert.id} alert={alert} projects={state.projects} />)
          )}
        </Panel>

        <Panel title="Contracts" icon={<FileKey2 size={18} />}>
          {state.contracts.length === 0 ? (
            <Empty text="Publish JSON contracts for endpoints, schemas, resources or webhooks." />
          ) : (
            state.contracts.map((contract) => <ContractRow key={contract.id} contract={contract} projects={state.projects} onRefresh={refresh} />)
          )}
        </Panel>

        <Panel title="Permissions" icon={<ShieldCheck size={18} />}>
          <PermissionsEditor projects={state.projects} preferredProjectId={dashboardInfo.currentProjectId} onSaved={refresh} />
        </Panel>
      </section>

      <section className="summary-band">
        <div>
          <p className="eyebrow">Human summary</p>
          <pre>{state.summary || "Connect a project to generate the first coordination summary."}</pre>
        </div>
        <GitBranch size={34} />
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectPane({ project, fallback }: { project?: Project; fallback: string }) {
  if (!project) {
    return (
      <article className="project-pane muted">
        <p className="eyebrow">Waiting</p>
        <h2>{fallback}</h2>
        <p>AgentRoom will show role, stack, agent and owner once connected.</p>
      </article>
    );
  }

  return (
    <article className="project-pane">
      <p className="eyebrow">{project.agentKind}</p>
      <h2>{project.name}</h2>
      <p>{project.role}</p>
      <div className="tags">
        {(project.stack.length > 0 ? project.stack : ["Unknown stack"]).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <small>Owner: {project.humanOwner}</small>
    </article>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        {icon}
        <h2>{title}</h2>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function QuestionRow({ question, projects }: { question: Question; projects: Project[] }) {
  const from = projects.find((project) => project.id === question.fromProjectId)?.name ?? "Unknown";
  const to = projects.find((project) => project.id === question.toProjectId)?.name ?? "Unknown";
  return (
    <article className={`row urgency-${question.urgency}`}>
      <div>
        <strong>{question.topic}</strong>
        <p>{question.question}</p>
        <small>
          {from} to {to}
        </small>
      </div>
      <span>{question.status}</span>
    </article>
  );
}

function DecisionRow({ decision, onRefresh }: { decision: Decision; onRefresh: () => Promise<void> }) {
  return (
    <article className="row">
      <div>
        <strong>{decision.title}</strong>
        <p>{decision.reason}</p>
        <small>{decision.risk}</small>
      </div>
      <RowActions status={decision.status}>
        {decision.status === "proposed" && (
          <>
            <button className="small-button" onClick={() => updateStatus(`/api/decisions/${decision.id}/status`, "approved", onRefresh)}>
              Approve
            </button>
            <button className="small-button ghost" onClick={() => updateStatus(`/api/decisions/${decision.id}/status`, "rejected", onRefresh)}>
              Reject
            </button>
          </>
        )}
      </RowActions>
    </article>
  );
}

function ContractRow({ contract, projects, onRefresh }: { contract: Contract; projects: Project[]; onRefresh: () => Promise<void> }) {
  const provider = projects.find((project) => project.id === contract.providerProjectId)?.name ?? "Provider";
  const consumer = projects.find((project) => project.id === contract.consumerProjectId)?.name ?? "Consumer";
  return (
    <article className="row">
      <div>
        <strong>{contract.id}</strong>
        <p>
          {provider} to {consumer}, {contract.resources.length} resource(s)
        </p>
      </div>
      <RowActions status={contract.status}>
        {contract.status === "draft" && (
          <button className="small-button" onClick={() => updateStatus(`/api/contracts/${contract.id}/status`, "active", onRefresh)}>
            Activate
          </button>
        )}
        {contract.status === "active" && (
          <button className="small-button ghost" onClick={() => updateStatus(`/api/contracts/${contract.id}/status`, "deprecated", onRefresh)}>
            Deprecate
          </button>
        )}
      </RowActions>
    </article>
  );
}

function AccessRequestRow({ request, projects, onRefresh }: { request: AccessRequest; projects: Project[]; onRefresh: () => Promise<void> }) {
  const from = projects.find((project) => project.id === request.fromProjectId)?.name ?? "Unknown";
  const to = projects.find((project) => project.id === request.toProjectId)?.name ?? "Unknown";
  return (
    <article className="row">
      <div>
        <strong>{request.path}</strong>
        <p>{request.reason}</p>
        <small>
          {from} requests {request.scope} access from {to}
        </small>
      </div>
      <RowActions status={request.status}>
        {request.status === "pending" && (
          <>
            <button className="small-button" onClick={() => updateStatus(`/api/access-requests/${request.id}/status`, "approved", onRefresh)}>
              Approve
            </button>
            <button className="small-button ghost" onClick={() => updateStatus(`/api/access-requests/${request.id}/status`, "denied", onRefresh)}>
              Deny
            </button>
          </>
        )}
      </RowActions>
    </article>
  );
}

function FileAlertRow({ alert, projects }: { alert: FileAlert; projects: Project[] }) {
  const triggeredBy = projects.find((project) => project.id === alert.triggeredByProjectId)?.name ?? "Current project";
  const conflicting = projects.find((project) => project.id === alert.conflictingProjectId)?.name ?? "Other project";
  return (
    <article className={`row ${alert.status === "active" ? "urgency-blocking" : ""}`}>
      <div>
        <strong>{alert.path}</strong>
        <p>{alert.reason}</p>
        <small>
          {triggeredBy} vs {conflicting}
        </small>
      </div>
      <RowActions status={alert.resolution ?? alert.status}>{null}</RowActions>
    </article>
  );
}

function RowActions({ status, children }: { status: string; children: React.ReactNode }) {
  return (
    <div className="row-actions">
      <span>{status}</span>
      {children}
    </div>
  );
}

function PermissionsEditor({
  projects,
  preferredProjectId,
  onSaved
}: {
  projects: Project[];
  preferredProjectId?: string;
  onSaved: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("");
  const [draft, setDraft] = useState<PermissionDraft>(emptyPermissionDraft);
  const [status, setStatus] = useState("Select a project to review its visibility rules.");
  const [saving, setSaving] = useState(false);
  const shareEverything = isShareEverythingDraft(draft);
  const visibleCount = shareEverything ? "All" : String(draft.visible.length);
  const chosenProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (projectId || projects.length === 0) return;
    const preferredProject = projects.find((project) => project.id === preferredProjectId);
    setProjectId((preferredProject ?? projects[0])!.id);
  }, [preferredProjectId, projectId, projects]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setStatus("Loading permissions...");
    fetchJson<{ markdown: string }>(`/api/projects/${projectId}/permissions`)
      .then((payload) => {
        if (cancelled) return;
        setDraft(parsePermissionsMarkdown(payload.markdown));
        setStatus("Permissions loaded.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Unable to load permissions.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (projects.length === 0) return <Empty text="Connect a project before editing permissions." />;

  function chooseEverything() {
    setDraft(fullAccessDraft());
    setStatus("Everything selected.");
  }

  function chooseFolders() {
    setDraft((current) => {
      if (!isShareEverythingDraft(current)) return current;
      return defaultPermissionDraft();
    });
    setStatus("Folder selection active.");
  }

  function toggleVisibleArea(pattern: string) {
    setDraft((current) => {
      const base = isShareEverythingDraft(current) ? { ...defaultPermissionDraft(), visible: [] } : current;
      return {
        ...base,
        visible: base.visible.includes(pattern)
          ? base.visible.filter((item) => item !== pattern)
          : [...base.visible, pattern]
      };
    });
  }

  function toggleAskFirstArea(pattern: string) {
    setDraft((current) => ({
      ...current,
      askFirst: current.askFirst.includes(pattern)
        ? current.askFirst.filter((item) => item !== pattern)
        : [...current.askFirst, pattern]
    }));
  }

  async function savePermissions() {
    if (!projectId) return;
    setSaving(true);
    setStatus("Saving permissions...");
    try {
      await fetchJson(`/api/projects/${projectId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: renderPermissionsMarkdown(draft) })
      });
      setStatus("Permissions saved.");
      await onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save permissions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="permissions-editor">
      <label className="field-label">
        Project
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <div className="permission-mode-grid">
        <button className={`permission-mode ${shareEverything ? "selected" : ""}`} onClick={chooseEverything}>
          <Globe2 size={22} />
          <span>
            <strong>Everything</strong>
            <small>Protected secrets stay closed</small>
          </span>
        </button>
        <button className={`permission-mode ${!shareEverything ? "selected" : ""}`} onClick={chooseFolders}>
          <FolderCheck size={22} />
          <span>
            <strong>Choose folders</strong>
            <small>{visibleCount} shared</small>
          </span>
        </button>
      </div>

      {!shareEverything ? (
        <section className="permission-picker">
          <div className="permission-section-heading">
            <strong>Shared</strong>
            <span>{chosenProject?.name ?? "Project"}</span>
          </div>
          <div className="permission-folder-grid">
            {visibleAreaOptions.map((option) => (
              <button
                key={option.pattern}
                className={`folder-toggle ${draft.visible.includes(option.pattern) ? "active" : ""}`}
                onClick={() => toggleVisibleArea(option.pattern)}
              >
                <FolderCheck size={18} />
                <span>{option.label}</span>
                <code>{option.pattern}</code>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="permission-picker compact">
        <div className="permission-section-heading">
          <strong>Ask before sharing</strong>
          <span>{draft.askFirst.length}</span>
        </div>
        <div className="permission-folder-grid compact">
          {askFirstOptions.map((option) => (
            <button
              key={option.pattern}
              className={`folder-toggle warning ${draft.askFirst.includes(option.pattern) ? "active" : ""}`}
              onClick={() => toggleAskFirstArea(option.pattern)}
            >
              <ShieldAlert size={17} />
              <span>{option.label}</span>
              <code>{option.pattern}</code>
            </button>
          ))}
        </div>
      </section>

      <div className="permission-safety-grid">
        <PermissionColumn
          title="Protected"
          section="hidden"
          items={draft.hidden}
          tone="hidden"
          onChange={setDraft}
        />
        <PermissionColumn
          title="Redacted"
          section="alwaysRedact"
          items={draft.alwaysRedact}
          tone="redact"
          onChange={setDraft}
        />
      </div>

      <div className="permission-quickbar">
        <button className="small-button" onClick={() => setDraft(defaultPermissionDraft())}>
          Recommended
        </button>
        <button className="small-button ghost" onClick={() => setDraft(lockedDownDraft())}>
          Lock down
        </button>
      </div>

      <div className="permission-footer">
        <span>{status}</span>
        <button onClick={savePermissions} disabled={saving}>
          <Save size={16} /> Save
        </button>
      </div>
    </div>
  );
}

function PermissionColumn({
  title,
  section,
  items,
  tone,
  onChange
}: {
  title: string;
  section: PermissionSection;
  items: string[];
  tone: string;
  onChange: React.Dispatch<React.SetStateAction<PermissionDraft>>;
}) {
  function removeItem(index: number) {
    onChange((draft) => ({
      ...draft,
      [section]: draft[section].filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  return (
    <section className={`permission-column ${tone}`}>
      <div className="permission-column-title">
        <strong>{title}</strong>
      </div>
      <div className="permission-chips">
        {items.length === 0 ? (
          <span className="empty-chip">None</span>
        ) : (
          items.map((item, index) => (
            <span className="permission-chip" key={`${section}-${item}-${index}`}>
              {item}
              <button className="mini-icon-button ghost" onClick={() => removeItem(index)} aria-label={`Remove ${item}`} title={`Remove ${item}`}>
                <Trash2 size={15} />
              </button>
            </span>
          ))
        )}
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

const emptyPermissionDraft: PermissionDraft = {
  visible: [],
  askFirst: [],
  hidden: [],
  alwaysRedact: []
};

const visibleAreaOptions: Array<{ label: string; pattern: string }> = [
  { label: "README", pattern: "README.md" },
  { label: "Package", pattern: "package.json" },
  { label: "Docs", pattern: "docs/**" },
  { label: "API", pattern: "src/api/**" },
  { label: "Types", pattern: "src/types/**" },
  { label: "Source", pattern: "src/**" },
  { label: "App", pattern: "app/**" },
  { label: "Pages", pattern: "pages/**" },
  { label: "Components", pattern: "components/**" },
  { label: "Lib", pattern: "lib/**" },
  { label: "Tests", pattern: "tests/**" },
  { label: "Fixtures", pattern: "tests/fixtures/**" },
  { label: "WordPress ACF", pattern: "wordpress/acf-json/**" },
  { label: "OpenAPI", pattern: "openapi.yaml" },
  { label: "GraphQL", pattern: "schema.graphql" },
  { label: "Composer", pattern: "composer.json" }
];

const askFirstOptions: Array<{ label: string; pattern: string }> = [
  { label: "Auth", pattern: "src/auth/**" },
  { label: "Config", pattern: "config/**" },
  { label: "Migrations", pattern: "src/database/migrations/**" },
  { label: "Billing", pattern: "src/billing/**" }
];

function isShareEverythingDraft(draft: PermissionDraft): boolean {
  return draft.visible.includes("**");
}

function defaultPermissionDraft(): PermissionDraft {
  return {
    visible: [
      "README.md",
      "docs/**",
      "src/api/**",
      "src/types/**",
      "tests/fixtures/**",
      "wordpress/acf-json/**",
      "package.json",
      "composer.json",
      "schema.graphql",
      "openapi.yaml"
    ],
    askFirst: ["src/auth/**", "src/database/migrations/**", "config/**"],
    hidden: [".env*", "secrets/**", "private/**", "src/billing/**", ".git/**", "node_modules/**", "vendor/**", "dist/**", "build/**"],
    alwaysRedact: ["API keys", "tokens", "passwords", "private keys", "customer data"]
  };
}

function fullAccessDraft(): PermissionDraft {
  return {
    visible: ["**"],
    askFirst: [],
    hidden: [".env*", "secrets/**", "private/**", ".git/**", "node_modules/**", "vendor/**"],
    alwaysRedact: ["API keys", "tokens", "passwords", "private keys", "customer data"]
  };
}

function lockedDownDraft(): PermissionDraft {
  return {
    visible: ["README.md", "package.json"],
    askFirst: [],
    hidden: [".env*", "secrets/**", "private/**", ".git/**", "node_modules/**", "vendor/**", "dist/**", "build/**", "src/**"],
    alwaysRedact: ["API keys", "tokens", "passwords", "private keys", "customer data"]
  };
}

const permissionHeadings: Record<string, PermissionSection> = {
  visible: "visible",
  "ask first": "askFirst",
  hidden: "hidden",
  "always redact": "alwaysRedact"
};

function parsePermissionsMarkdown(markdown: string): PermissionDraft {
  const draft: PermissionDraft = { visible: [], askFirst: [], hidden: [], alwaysRedact: [] };
  let active: PermissionSection | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      active = permissionHeadings[heading[1]?.trim().toLowerCase() ?? ""];
      continue;
    }
    const item = line.match(/^-\s+(.+)$/);
    if (item && active) draft[active].push(item[1]!.trim());
  }
  return draft;
}

function renderPermissionsMarkdown(draft: PermissionDraft): string {
  return [
    "# agentroom.permissions.md",
    "",
    ...renderPermissionSection("Visible", draft.visible),
    ...renderPermissionSection("Ask First", draft.askFirst),
    ...renderPermissionSection("Hidden", draft.hidden),
    ...renderPermissionSection("Always Redact", draft.alwaysRedact)
  ].join("\n");
}

function renderPermissionSection(title: string, items: string[]): string[] {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);
  return [`## ${title}`, ...cleanItems.map((item) => `- ${item}`), ""];
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function updateStatus(url: string, status: string, onRefresh: () => Promise<void>) {
  await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  await onRefresh();
}

createRoot(document.getElementById("root")!).render(<App />);
