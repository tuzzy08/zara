import * as ls from "langsmith/vitest";
import { expect } from "vitest";

import {
  createReferencePstnMediaEvalOutput,
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
          },
        },
        () => {
          const output = createReferencePstnMediaEvalOutput(fixture);
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
            tags: ["dataset:pstn-media.v1", ...runConfig.tags],
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
