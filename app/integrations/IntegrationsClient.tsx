"use client";
import Link from "next/link";
import "../users/users.css";

// Placeholder shell — the point of shipping it now is the nav slot and the
// site-admin gate, not the content. Sales AI is the first real integration
// planned; what it actually does gets built once that's scoped.
export default function IntegrationsClient() {
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
            <article className="user-row pending">
              <div className="identity">
                <b>Sales AI</b>
                <small>Not connected yet</small>
              </div>
              <div className="row-actions"><button className="manage" disabled>Coming soon</button></div>
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
