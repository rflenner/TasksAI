import "./email-preview.css";

export default function EmailPreviewPage() {
  return <main className="email-studio">
    <aside className="email-side"><a className="email-logo" href="/">Task <b>AI</b></a><nav><a href="/">← Action items</a><a href="/users">Users & access</a><a className="active" href="/email-preview">Email notifications</a></nav><div className="email-config"><span>LOCAL PREVIEW</span><b>Resend-ready</b><small>Add the API key and verified sender only when you are ready to send.</small></div></aside>
    <section className="email-work"><header><div><label>NOTIFICATIONS</label><h1>Email design</h1><p>A responsive summary for task owners and coworkers, styled to match Task AI.</p></div><span className="preview-pill">Preview mode</span></header>
      <div className="email-toolbar"><div><b>Weekly task summary</b><span>Desktop email preview</span></div><div className="legend"><span><i className="navy"/>Open</span><span><i className="orange"/>Overdue</span><span><i className="green"/>Completed</span></div></div>
      <div className="email-frame"><iframe title="Task AI email preview" src="/api/email-preview"/></div>
      <div className="delivery-note"><b>Safe local setup</b><span>The template is active locally. Actual delivery remains off until <code>RESEND_API_KEY</code> and <code>TASK_AI_FROM_EMAIL</code> are configured.</span></div>
    </section>
  </main>;
}
