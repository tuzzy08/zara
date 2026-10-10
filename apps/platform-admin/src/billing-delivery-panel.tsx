import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, FieldLabel, Textarea } from "@zara/ui";

interface Decision {
  id: string;
  enabled: boolean;
  releaseId: string | null;
  catalogId: string | null;
  effectiveAt: string;
  reason: string;
}

interface Change {
  requestId: string;
  enabled: boolean;
  expectedDecisionId: string | null;
  reason: string;
}

export function BillingDeliveryPanel({ apiUrl, isOwner, canMutate }: {
  apiUrl: string; isOwner: boolean; canMutate: boolean;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<Change | null>(null);
  const inFlight = useRef(false);

  async function readDecision(signal?: AbortSignal) {
    const response = await fetch(apiUrl, { credentials: "include", signal: signal ?? AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("read failed");
    const value = await response.json() as unknown;
    if (value === null) return null;
    if (typeof value !== "object" || !("id" in value) || typeof value.id !== "string"
      || !("enabled" in value) || typeof value.enabled !== "boolean"
      || !("effectiveAt" in value) || typeof value.effectiveAt !== "string"
      || !("reason" in value) || typeof value.reason !== "string"
      || !("releaseId" in value) || (value.releaseId !== null && typeof value.releaseId !== "string")
      || !("catalogId" in value) || (value.catalogId !== null && typeof value.catalogId !== "string")) {
      throw new Error("Invalid decision response");
    }
    return value as Decision;
  }

  useEffect(() => {
    const controller = new AbortController();
    void readDecision(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setDecision(value); setLoaded(true); }
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Cannot read the owner decision. Billing status is unknown.");
    });
    return () => controller.abort();
  }, [apiUrl]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setLoaded(false);
    try { setDecision(await readDecision()); setLoaded(true); setMessage(""); }
    catch { setMessage("Cannot read the owner decision. Billing status is unknown."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function change(enabled: boolean) {
    if (inFlight.current || !isOwner || !canMutate || (!pending && (!loaded || !confirmed || !reason.trim()))) return;
    const request = pending ?? { requestId: crypto.randomUUID(), enabled, expectedDecisionId: decision?.id ?? null, reason: reason.trim() };
    inFlight.current = true;
    setBusy(true);
    setPending(request);
    setMessage("");
    try {
      const response = await fetch(apiUrl, { method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15_000) });
      if (response.status === 409) {
        setPending(null);
        setConfirmed(false);
        setLoaded(false);
        try { setDecision(await readDecision()); setLoaded(true); }
        catch { /* Keep actions disabled until a successful read. */ }
        setMessage("The decision changed. Review the latest decision, then confirm a new change.");
        return;
      }
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        setPending(null);
        setConfirmed(false);
        setMessage(response.status === 400
          ? "Change refused. Check the reason and production billing configuration."
          : "Change refused. Verify owner access and fresh MFA, then reload this page.");
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      setPending(null);
      setConfirmed(false);
      setReason("");
      setLoaded(false);
      try {
        setDecision(await readDecision()); setLoaded(true);
        setMessage("Change saved. The latest owner decision is shown below.");
      } catch { setMessage("Change saved, but the latest decision cannot be read. Refresh before another change."); }
    } catch {
      setMessage("The result is not confirmed. Retry the same change to avoid a duplicate approval.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <Card className="data-panel billing-delivery-panel">
    <h2>Billing delivery</h2>
    <p>Owner approval applies to new calls only. It does not charge historical usage.</p>
    <p>Delivery also requires the server setting and a matching release and catalog. This panel shows the saved owner decision, not the current delivery status.</p>
    {message ? <p role="status">{message}</p> : null}
    {loaded ? <>
      <p>{decision === null ? "No owner decision saved." : decision.enabled ? "Owner approval enabled." : "Owner approval stopped."}</p>
      {decision ? <dl>
        <dt>Effective time</dt><dd>{decision.effectiveAt}</dd>
        <dt>Release</dt><dd>{decision.releaseId ?? "Not scoped"}</dd>
        <dt>Catalog</dt><dd>{decision.catalogId ?? "Not scoped"}</dd>
        <dt>Saved reason</dt><dd>{decision.reason}</dd>
      </dl> : null}
    </> : <p>Owner decision is not loaded.</p>}
    <Button type="button" disabled={busy || pending !== null} onClick={() => void refresh()}>Refresh decision</Button>
    {!isOwner ? <p>Only the platform owner can change billing delivery.</p>
      : !canMutate ? <p>Verify MFA or a passkey before you change billing delivery.</p> : <>
        <Field>
          <FieldLabel htmlFor="billing-delivery-reason">Reason</FieldLabel>
          <Textarea id="billing-delivery-reason" maxLength={500} value={reason} disabled={busy || pending !== null}
            onChange={(event) => setReason(event.target.value)} />
        </Field>
        <label><input type="checkbox" checked={confirmed} disabled={busy || pending !== null}
          onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this billing change.</label>
        <p>Stop billing prevents new delivery. It cannot recall charges already sent.</p>
        <div className="admin-form-actions">
          {pending ? <Button type="button" disabled={busy} onClick={() => void change(pending.enabled)}>Retry the same change</Button> : <>
            <Button type="button" disabled={busy || !loaded || !confirmed || !reason.trim()} onClick={() => void change(true)}>Enable billing</Button>
            <Button type="button" disabled={busy || !loaded || !confirmed || !reason.trim()} onClick={() => void change(false)}>Stop billing</Button>
          </>}
        </div>
      </>}
  </Card>;
}
