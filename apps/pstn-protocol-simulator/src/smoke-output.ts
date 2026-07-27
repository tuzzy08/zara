export function formatSmokeFailure(error: unknown) {
  void error;
  return JSON.stringify({
    outcome: "failed",
    errorCode: "pstn_protocol_smoke_failed",
  });
}
