import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { processInboxAutonomously } from "../src/core/autonomous.js";
import { AgentRoomStore } from "../src/core/storage.js";

describe("AgentRoomStore", () => {
  it("creates a room, connects a project and records coordination objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-store-"));
    try {
      await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo-saas", dependencies: { react: "^19.0.0" } }), "utf8");
      await writeFile(path.join(root, ".env"), "TOKEN=secret", "utf8");
      const store = new AgentRoomStore(root);
      const project = await store.connectProject({ agentKind: "Codex", humanOwner: "Dev A" });
      const sameProject = await store.connectProject({ agentKind: "Codex", humanOwner: "Dev A" });
      const question = await store.askQuestion({
        fromProjectId: project.id,
        toProjectId: project.id,
        topic: "content.updated",
        question: "Is the webhook retried?",
        impact: "Imports may miss content updates.",
        urgency: "blocking"
      });
      await store.answerQuestion({
        questionId: question.id,
        answer: "Yes, retry twice.",
        confidence: "high"
      });
      await store.recordDecision({
        title: "Retry importer twice",
        reason: "Transient webhook failures happen.",
        status: "approved",
        approvedBy: ["Dev A"],
        affects: [project.name],
        risk: "Delayed imports remain possible."
      });
      const contract = await store.publishContract({
        id: undefined,
        providerProjectId: project.id,
        consumerProjectId: project.id,
        version: "v1",
        status: "active",
        resources: [{ kind: "GraphQL", name: "CaseStudy" }],
        breakingChangesRequireHumanApproval: true
      });
      const state = await store.getState();

      expect(state.room.inviteCode).toMatch(/^ar_/);
      expect(state.projects).toHaveLength(1);
      expect(sameProject.id).toBe(project.id);
      expect(state.questions[0]?.status).toBe("answered");
      expect(state.decisions[0]?.status).toBe("approved");
      expect(contract.id).toMatch(/^contract_/);
      expect(state.contracts[0]?.id).toBe(contract.id);
      expect(state.summary).toContain("demo-saas");
      await expect(store.listVisibleFiles()).resolves.not.toContain(".env");
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prevents answering questions for another project", async () => {
    const rootA = await mkdtemp(path.join(os.tmpdir(), "agentroom-answer-a-"));
    const rootB = await mkdtemp(path.join(os.tmpdir(), "agentroom-answer-b-"));
    try {
      const storeA = new AgentRoomStore(rootA);
      const projectA = await storeA.connectProject({ name: "Provider" });
      const storeB = new AgentRoomStore(rootB, { roomDir: storeA.roomDir });
      const projectB = await storeB.connectProject({ name: "Consumer" });
      const question = await storeB.askQuestion({
        fromProjectId: projectB.id,
        toProjectId: projectA.id,
        topic: "contract.field",
        question: "Is field optional?",
        impact: "Importer needs to know.",
        urgency: "normal"
      });

      await expect(
        storeB.answerQuestionForProject(projectB.id, {
          questionId: question.id,
          answer: "Pretend answer.",
          confidence: "medium"
        })
      ).rejects.toThrow(/cannot answer/);
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it("updates decision, contract and access request approval states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-approvals-"));
    try {
      const store = new AgentRoomStore(root);
      const project = await store.connectProject({ name: "Approval Demo" });
      const decision = await store.recordDecision({
        title: "Approve fallback",
        reason: "Importer needs a stable fallback.",
        status: "proposed",
        approvedBy: [],
        affects: [project.name],
        risk: "Low"
      });
      const approved = await store.updateDecisionStatus({
        decisionId: decision.id,
        status: "approved",
        approvedBy: "Matho"
      });
      expect(approved.status).toBe("approved");
      expect(approved.approvedBy).toContain("Matho");
      await expect(store.updateDecisionStatus({ decisionId: decision.id, status: "rejected" })).rejects.toThrow(/Invalid decision transition/);

      const contract = await store.publishContract({
        providerProjectId: project.id,
        consumerProjectId: project.id,
        version: "v1",
        status: "draft",
        resources: [{ kind: "JSON", name: "CaseStudy" }],
        breakingChangesRequireHumanApproval: true
      });
      await expect(store.updateContractStatus({ contractId: contract.id, status: "active" })).resolves.toMatchObject({
        status: "active"
      });
      await expect(store.updateContractStatus({ contractId: contract.id, status: "draft" })).rejects.toThrow(/Invalid contract transition/);

      const access = await store.requestAccess({
        fromProjectId: project.id,
        toProjectId: project.id,
        path: "config/content-source.json",
        reason: "Need to verify source URL.",
        scope: "read-only"
      });
      await expect(store.updateAccessRequestStatus({ accessRequestId: access.id, status: "approved" })).resolves.toMatchObject({
        status: "approved"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not infer field nullability from unrelated null evidence", async () => {
    const rootA = await mkdtemp(path.join(os.tmpdir(), "agentroom-autonomous-a-"));
    const rootB = await mkdtemp(path.join(os.tmpdir(), "agentroom-autonomous-b-"));
    try {
      await writeFile(path.join(rootA, "README.md"), "Legacy notes mention optional null values for a different field.\n", "utf8");
      const storeA = new AgentRoomStore(rootA);
      const projectA = await storeA.connectProject({ name: "Provider" });
      const storeB = new AgentRoomStore(rootB, { roomDir: storeA.roomDir });
      const projectB = await storeB.connectProject({ name: "Consumer" });
      await storeB.askQuestion({
        fromProjectId: projectB.id,
        toProjectId: projectA.id,
        topic: "case_study.heroImage",
        question: "Can heroImage be null?",
        impact: "Importer needs to know.",
        urgency: "blocking"
      });

      const result = await processInboxAutonomously(storeA);
      expect(result.answered).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});
