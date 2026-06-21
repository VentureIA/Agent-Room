import { describe, expect, it } from "vitest";
import { buildHumanSummary } from "../src/core/summary.js";
import type { RoomState } from "../src/core/types.js";

describe("buildHumanSummary", () => {
  it("surfaces blockers and proposed decisions", () => {
    const state: RoomState = {
      room: { id: "room_1", name: "Demo", inviteCode: "ar_demo", createdAt: "now" },
      projects: [
        {
          id: "p1",
          name: "WordPress",
          path: "/tmp/wp",
          role: "Content provider",
          stack: ["WordPress"],
          agentKind: "Claude",
          humanOwner: "Dev A",
          createdAt: "now"
        }
      ],
      agents: [],
      messages: [],
      questions: [
        {
          id: "q1",
          roomId: "room_1",
          fromProjectId: "p1",
          toProjectId: "p1",
          topic: "heroImage",
          question: "Can it be null?",
          impact: "Pages may break.",
          urgency: "blocking",
          status: "open",
          createdAt: "now"
        }
      ],
      decisions: [
        {
          id: "d1",
          roomId: "room_1",
          title: "Add fallback image",
          reason: "Older posts may not have images.",
          status: "proposed",
          approvedBy: [],
          affects: ["WordPress"],
          risk: "Missing media",
          createdAt: "now"
        }
      ],
      contracts: [],
      accessRequests: [],
      fileActivities: [],
      fileAlerts: [],
      summary: ""
    };

    const summary = buildHumanSummary(state);
    expect(summary).toContain("heroImage");
    expect(summary).toContain("Add fallback image");
    expect(summary).toContain("Aucun contrat partage");
  });
});
