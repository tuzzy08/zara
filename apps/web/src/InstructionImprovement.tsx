import { useEffect, useRef, useState } from "react";
import { Button, Textarea } from "@zara/ui";
import { maxAgentInstructionsCharacters, type InstructionImprovementRequest, type InstructionImprovementResult } from "@zara/core";
import { requestJson } from "./apiClient";
import "./instructionImprovement.css";

export function InstructionImprovement({ organizationId, context, value, onChange }: {
  organizationId: string;
  context: Omit<InstructionImprovementRequest, "instructions">;
  value: string;
  onChange: (instructions: string) => void;
}) {
  const [review, setReview] = useState<{ result: InstructionImprovementResult; settings: string } | null>(null);
  const [suggested, setSuggested] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const settings = JSON.stringify({ organizationId, context });
  const stale = review !== null && (review.settings !== settings
    || (value !== review.result.originalInstructions && value !== applied));

  async function improve() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setReview(null);
    setApplied(null);
    try {
      const result = await requestJson<InstructionImprovementResult>(
        `/organizations/${encodeURIComponent(organizationId)}/agents/improve-instructions`,
        { method: "POST", signal: controller.signal, body: JSON.stringify({ ...context, instructions: value }) },
      );
      if (controller.signal.aborted) return;
      setReview({ result, settings });
      setSuggested(result.instructions);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Instructions could not be improved.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="instruction-improvement">
    <Button type="button" className="workflow-button workflow-button-secondary" onClick={() => { void improve(); }}
      disabled={busy || !value.trim() || value.length > maxAgentInstructionsCharacters || !context.agentClass}>
      {busy ? "Improving instructions…" : "Improve instructions"}
    </Button>
    {busy ? <p role="status">Preparing a draft for review…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {review ? <section aria-label="Review improved instructions" className="instruction-review">
      <details><summary>Original instructions</summary><pre>{review.result.originalInstructions}</pre></details>
      <label><span>Suggested instructions</span><Textarea aria-label="Suggested instructions" value={suggested}
        maxLength={maxAgentInstructionsCharacters} rows={10} onChange={event => setSuggested(event.target.value)} /></label>
      <p className="instruction-review-count">{suggested.length.toLocaleString()} / {maxAgentInstructionsCharacters.toLocaleString()} characters</p>
      {([ ["Changes and reasons", review.result.changes], ["Missing information", review.result.questions],
        ["Configuration conflicts", review.result.conflicts] ] as const).map(([title, items]) => items.length ?
        <div key={title}><h4>{title}</h4><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null)}
      <p>Check business facts before use. Applying this draft does not publish it.</p>
      {stale ? <p role="alert">Instructions or settings changed. Generate a new suggestion.</p> : null}
      <div className="instruction-review-actions">
        <Button type="button" className="workflow-button workflow-button-primary" disabled={stale || busy || !suggested.trim() || suggested.length > maxAgentInstructionsCharacters}
          onClick={() => { setApplied(suggested); onChange(suggested); }}>Use these instructions</Button>
        {applied !== null ? <Button type="button" className="workflow-button workflow-button-secondary" disabled={stale || value !== applied}
          onClick={() => { setApplied(null); onChange(review.result.originalInstructions); }}>Restore original</Button> : null}
        <Button type="button" className="workflow-button workflow-button-secondary" onClick={() => { setReview(null); }}>Close review</Button>
      </div>
    </section> : null}
  </div>;
}
