import * as ls from "langsmith/vitest";
import { expect } from "vitest";

import {
  executePstnMediaEvalScenario,
  loadPstnMediaEvalFixtures,
  scorePstnMediaEvalExample,
} from "./pstn-media-evals";
import { resolveRuntimeEvalRunConfig } from "./runtime-evaluators";

const runConfig = resolveRuntimeEvalRunConfig();

ls.describe(
  "zara.pstn-media.v1",
  () => {
    loadPstnMediaEvalFixtures().forEach((fixture) => {
      ls.test(
        fixture.id,
        {
          inputs: fixture.inputs,
          referenceOutputs: fixture.referenceOutputs,
          metadata: {
            suite: fixture.suite,
            datasetVersion: runConfig.datasetVersion,
            releaseGate: fixture.inputs.releaseGate,
            runtimePath: fixture.inputs.runtimePath,
            runtimeProvider: fixture.inputs.runtimeProvider,
          },
        },
        async () => {
          const output = await executePstnMediaEvalScenario(fixture);
          const scorecard = scorePstnMediaEvalExample(fixture, output);

          Object.entries(scorecard.scores).forEach(([key, score]) => {
            ls.logFeedback({
              key,
              score,
              comment: scorecard.explanations[key as keyof typeof scorecard.explanations],
            });
          });
          expect(scorecard.passed).toBe(true);

          return {
            output,
            scorecard,
            tags: [
              "dataset:pstn-media.v1",
              `gate:${fixture.inputs.releaseGate}`,
              `runtime:${fixture.inputs.runtimePath}`,
              `provider:${fixture.inputs.runtimeProvider}`,
              ...runConfig.tags,
            ],
          };
        },
      );
    });
  },
  {
    enableTestTracking: runConfig.upload,
    testSuiteName: `zara.pstn-media.${runConfig.datasetVersion}`,
    projectName: runConfig.project,
    metadata: runConfig.metadata,
  },
);
