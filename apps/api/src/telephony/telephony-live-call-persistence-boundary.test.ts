import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const liveCallMethods = new Set([
  "dispatchInboundCall",
  "dispatchOutboundCall",
  "runConnectionTestCall",
  "authorizeTwilioMediaStream",
  "recordTwilioMediaStreamLifecycle",
  "recordPstnPhoneTestCheckpoint",
  "recordPstnCallLifecycle",
  "transitionPstnCallLifecycle",
  "recordCallControlEvent",
  "applyCallRuntimePolicy",
  "resolveHumanFallback",
  "handleTwilioWebhook",
  "handleTwilioStatusCallback",
]);

describe("telephony live-call persistence boundary", () => {
  it("keeps whole-tenant snapshot persistence out of every live-call entry point", () => {
    const sourceText = readFileSync(
      new URL("./telephony.service.ts", import.meta.url),
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "telephony.service.ts",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const offenders: string[] = [];

    visit(sourceFile, (methodName, node) => {
      if (!liveCallMethods.has(methodName) || !ts.isCallExpression(node)) return;
      const target = node.expression.getText(sourceFile);
      if (
        target === "this.persistState" ||
        target === "this.stateRepository.save"
      ) {
        offenders.push(`${methodName}:${target}`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it("does not retain legacy in-memory token or webhook-dedupe snapshot fallbacks", () => {
    const serviceSource = readFileSync(
      new URL("./telephony.service.ts", import.meta.url),
      "utf8",
    );
    const modelSource = readFileSync(
      new URL("./telephony.models.ts", import.meta.url),
      "utf8",
    );

    expect(serviceSource).not.toContain("state.mediaStreamTokens");
    expect(serviceSource).not.toContain("processedWebhookEventIds");
    expect(serviceSource).not.toContain("persistenceByOrganizationId");
    expect(serviceSource).not.toContain("persistState");
    expect(modelSource).not.toContain("processedWebhookEventIds:");
    expect(modelSource).not.toContain("mediaStreamTokens:");
  });
});

function visit(
  sourceFile: ts.SourceFile,
  inspect: (methodName: string, node: ts.Node) => void,
) {
  const walk = (node: ts.Node, methodName?: string) => {
    const nextMethodName =
      ts.isMethodDeclaration(node) && node.name !== undefined
        ? node.name.getText(sourceFile)
        : methodName;

    if (nextMethodName !== undefined) {
      inspect(nextMethodName, node);
    }
    ts.forEachChild(node, (child) => walk(child, nextMethodName));
  };

  walk(sourceFile);
}
