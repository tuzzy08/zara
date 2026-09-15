import * as ls from "langsmith/vitest";
import { expect } from "vitest";

import { loadRuntimeEvalFixtures } from "./runtime-eval-fixtures";
import {
  resolveRuntimeEvalRunConfig,
  scoreRuntimeEvalExample,
} from "./runtime-evaluators";
import { executeRuntimeEval } from "./runtime-eval-executor";

const runConfig = resolveRuntimeEvalRunConfig();

ls.describe(
  "zara.runtime.packet-fixtures.v2",
  () => {
    loadRuntimeEvalFixtures().forEach((fixture) => {
      ls.test(
        fixture.id,
        {
          inputs: fixture.inputs,
          referenceOutputs: fixture.referenceOutputs,
          metadata: {
            suite: fixture.suite,
            datasetVersion: runConfig.datasetVersion,
            packetSchema: runConfig.metadata.packetSchema,
          },
        },
        async () => {
          const output = await executeRuntimeEval(fixture.inputs);
          const scorecard = scoreRuntimeEvalExample(fixture, output as Record<string, unknown>);

          Object.entries(scorecard.scores).forEach(([key, score]) => {
            ls.logFeedback({
              key,
              score,
              comment: scorecard.explanations[key],
            });
          });
          expect(scorecard.passed).toBe(true);

          return {
            output,
            scorecard,
            tags: runConfig.tags,
          };
        },
      );
    });
  },
  {
    enableTestTracking: runConfig.upload,
    testSuiteName: runConfig.experimentName,
    projectName: runConfig.project,
    metadata: runConfig.metadata,
  },
);
