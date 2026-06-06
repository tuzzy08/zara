import { describe, expect, it } from "vitest";

import {
  classifyKnowledgeText,
  evaluateKnowledgeActivationApproval,
  evaluateKnowledgeConflicts,
} from "./knowledge-sync-safety";

describe("knowledge sync safety policy", () => {
  it("labels sensitive extracted knowledge and blocks obvious runtime secrets", () => {
    const classification = classifyKnowledgeText({
      text: [
        "Customer Jane Doe can be reached at jane@example.test or +1 (415) 555-0199.",
        "Password: hunter2. API key sk-test-1234567890abcdef should never be in knowledge.",
        "Card 4242 4242 4242 4242 with CVV 123 was pasted into the source.",
        "The patient asked about diabetes symptoms after surgery.",
        "The legal contract includes an arbitration clause.",
        "Internal only staff escalation playbook.",
      ].join(" "),
    });

    expect(classification.labels).toEqual([
      "pii",
      "credentials_secrets",
      "payment",
      "health",
      "legal",
      "internal_only",
    ]);
    expect(classification.activationBlockers).toEqual([
      expect.objectContaining({
        code: "credentials_or_secrets_detected",
        label: "credentials_secrets",
      }),
    ]);
  });

  it("requires owner or admin approval metadata for high-risk or sensitive records", () => {
    const sensitivePricing = evaluateKnowledgeActivationApproval({
      kind: "pricing",
      sensitivityLabels: ["payment"],
    });

    expect(sensitivePricing).toEqual({
      requiresApproval: true,
      requiredApproverRoles: ["owner", "admin"],
      requiredMetadata: [
        "actorUserId",
        "actorRole",
        "workspaceId",
        "reason",
        "beforeState",
        "afterState",
        "timestamp",
      ],
      reasons: ["high_risk_kind", "sensitive_labels"],
    });

    expect(
      evaluateKnowledgeActivationApproval({
        kind: "faq",
        sensitivityLabels: [],
      }),
    ).toEqual({
      requiresApproval: false,
      requiredApproverRoles: [],
      requiredMetadata: [],
      reasons: [],
    });
  });

  it("warns on same kind/title conflicts but only blocks unresolved high-risk conflicts", () => {
    const evaluation = evaluateKnowledgeConflicts({
      records: [
        {
          id: "policy-old",
          kind: "policy",
          title: "Refund approvals",
          text: "Refunds above $100 require manager approval.",
          sourcePriority: 20,
          conflictStatus: "unresolved",
        },
        {
          id: "policy-new",
          kind: "policy",
          title: "Refund approvals",
          text: "Refunds above $100 require owner approval.",
          sourcePriority: 90,
          conflictStatus: "unresolved",
        },
        {
          id: "faq-old",
          kind: "faq",
          title: "Support hours",
          text: "Support is open from 8am to 5pm.",
          sourcePriority: 10,
          conflictStatus: "unresolved",
        },
        {
          id: "faq-new",
          kind: "faq",
          title: "Support hours",
          text: "Support is open from 9am to 6pm.",
          sourcePriority: 40,
          conflictStatus: "unresolved",
        },
        {
          id: "legal-old",
          kind: "legal_compliance",
          title: "Warranty disclaimer",
          text: "Warranty disputes route to the legal desk.",
          sourcePriority: 50,
          conflictStatus: "resolved",
        },
        {
          id: "legal-new",
          kind: "legal_compliance",
          title: "Warranty disclaimer",
          text: "Warranty disputes route to the compliance desk.",
          sourcePriority: 80,
          conflictStatus: "resolved",
        },
      ],
    });

    expect(evaluation.warnings).toEqual([
      expect.objectContaining({
        kind: "policy",
        title: "Refund approvals",
        recordIds: ["policy-old", "policy-new"],
        sourcePriorities: [20, 90],
        status: "unresolved",
        blocksPublish: true,
      }),
      expect.objectContaining({
        kind: "faq",
        title: "Support hours",
        recordIds: ["faq-old", "faq-new"],
        sourcePriorities: [10, 40],
        status: "unresolved",
        blocksPublish: false,
      }),
      expect.objectContaining({
        kind: "legal_compliance",
        title: "Warranty disclaimer",
        recordIds: ["legal-old", "legal-new"],
        sourcePriorities: [50, 80],
        status: "resolved",
        blocksPublish: false,
      }),
    ]);
    expect(evaluation.publishBlockers).toEqual([
      {
        code: "unresolved_high_risk_conflict",
        kind: "policy",
        title: "Refund approvals",
        recordIds: ["policy-old", "policy-new"],
      },
    ]);
    expect(evaluation.canPublish).toBe(false);
  });
});
