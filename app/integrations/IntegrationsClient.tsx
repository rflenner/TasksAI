"use client";
import Link from "next/link";
import { useState } from "react";
import "../users/users.css";
import "./integrations.css";

type SyncResult = { itemsFound: number; qualifying: number; created: number; alreadySynced: number; contactsUpserted: number };

// First real version — manual trigger only, always scoped to today
// (both start and end date), per the explicit "let's see what we get
// first" request this was built against. No cron yet, no date-range
// picker yet — both are natural next steps once a first run's been
// reviewed, not before.
export default function IntegrationsClient() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");

  const sync = async () => {
    if (busy) return;
    setBusy(true); setError(""); setResult(null);
    const response = await fetch("/api/integrations/sales-ai/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || "Sync failed"); return; }
    setResult(data);
  };

  return (
    <main className="users-shell">
      <aside className="users-side">
        <Link className="users-logo" href="/">Task <b>AI</b></Link>
        <nav>
          <Link href="/">← Action items</Link>
          <Link href="/users">Users & access</Link>
          <Link href="/data-hygiene">Data Hygiene</Link>
          <Link className="active" href="/integrations">Integrations</Link>
          <Link href="/email-preview">Email notifications</Link>
        </nav>
      </aside>
      <section className="users-work">
        <header>
          <div>
            <span className="eyebrow">COMPANY SETTINGS</span>
            <h1>Integrations</h1>
            <p>Connect Task AI to the other tools your team uses.</p>
          </div>
        </header>
        <section>
          <div className="user-list">
            <article className="integration-row">
              <div className="identity">
                <b>Sales AI</b>
                <small>Pulls today&apos;s action items involving a registered Task AI user, creating tasks and enriching the People registry.</small>
              </div>
              <div className="row-actions">
                <button className="manage" disabled={busy} onClick={() => void sync()}>{busy ? "Syncing…" : "Sync today's items"}</button>
              </div>
            </article>
            {error && <div className="integration-result" style={{ color: "#a84235" }}>{error}</div>}
            {result && (
              <div className="integration-result">
                <b>{result.itemsFound}</b> action item{result.itemsFound === 1 ? "" : "s"} found today · <b>{result.qualifying}</b> involved a registered Task AI user · <b>{result.created}</b> task{result.created === 1 ? "" : "s"} created · {result.alreadySynced} already synced (skipped) · {result.contactsUpserted} contact{result.contactsUpserted === 1 ? "" : "s"} added to the People registry.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
