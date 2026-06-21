import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  CircleHelp,
  FileKey2,
  FileWarning,
  GitBranch,
  KeyRound,
  Link2,
  MessageSquarePlus,
  ShieldQuestion,
  RefreshCw,
  ShieldCheck,
  SplitSquareHorizontal
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
};

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
          <PermissionRows />
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

function PermissionRows() {
  const rows = [
    ["Visible", "Documentation, API schemas, fixtures, public types"],
    ["Ask First", "Auth, migrations, config"],
    ["Hidden", "Secrets, billing, private folders, dependency folders"],
    ["Redacted", "Keys, tokens, passwords, private keys, customer data"]
  ];
  return (
    <div className="permission-list">
      {rows.map(([label, text]) => (
        <div key={label}>
          <strong>{label}</strong>
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
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
