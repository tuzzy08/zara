# ISSUE-139: LangSmith Vitest runtime eval fixture harness

Status: Pending
Date: 2026-05-27
External: [Linear ZAR-72](https://linear.app/zara-voice/issue/ZAR-72/issue-139-langsmith-vitest-runtime-eval-fixture-harness)

## Work Completed

- Created the implementation issue in `docs/Issue-Backlog.md`.
- Documented the eval fixture, dataset, evaluator, and execution standards in `docs/Observability-And-Evals-Standard.md`.
- Linked eval expectations from `docs/Testing-Strategy.md` and `docs/Roadmap.md`.

## Tests Run

- Not run. This pass created documentation and backlog records only.

## Pending Work

- Add failing fixture-loader tests for packet and manifest projection eval examples.
- Add deterministic evaluator tests for intent, tool, transfer, policy, and redaction outcomes.
- Add a separate LangSmith Vitest config and eval script for `.eval.ts` files.
- Add minimal fake-output eval suites before introducing provider-backed or LLM-as-judge evals.
- Integrate `openevals` for qualitative scoring after deterministic scorecards are stable.

## Risks

- Evals could become flaky if qualitative judges are introduced before deterministic coverage is solid.
- Eval fixtures may accidentally include sensitive production data unless fixture creation follows the redaction standard.
- Running evals through the normal test command would slow or destabilize the strict TDD loop.

## Decisions

- Ordinary Vitest tests remain separate from LangSmith evals.
- Packet fixtures are the canonical eval input shape.
- LLM-as-judge evals are reserved for behavior that exact assertions cannot reliably score.

## Next Recommended Step

- Start with RED tests for fixture loading and deterministic scorecard functions, then add the separate LangSmith eval config.
