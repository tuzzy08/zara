export function AuthLoadingScreen() {
  return (
    <main className="auth-screen" aria-busy="true">
      <section className="auth-card">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Session</p>
        <h1>Checking your Zara session</h1>
        <p>Confirming secure access before opening the tenant workspace.</p>
      </section>
    </main>
  );
}
