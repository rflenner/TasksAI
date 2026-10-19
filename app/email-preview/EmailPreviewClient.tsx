import "./email-preview.css";

const KINDS: Array<[string, string, string]> = [
  ["", "Weekly task summary", "A responsive summary for task owners and coworkers, styled to match Task AI."],
  ["close-plan-invitation", "Close Plan: invitation", "The email a customer contact gets from “Send invitation”: their personal link, what they can do and their open tasks."],
  ["close-plan-reminder", "Close Plan: reminder", "The reminder when the personal link was not opened (days and number of reminders are set under Admin → Notifications)."],
  ["close-plan-added", "Close Plan: added to a plan", "What an iSEEit colleague gets when they are added to a close plan."],
];

export default function EmailPreviewPage({ kind }: { kind: string }) {
  const current = KINDS.find(k => k[0] === kind) || KINDS[0];
  return <main className="email-studio">
    <aside className="email-side"><a className="email-logo" href="/">Task <b>AI</b></a><nav><a href="/">← Action items</a><a href="/users">Users & access</a><a className="active" href="/email-preview">Email notifications</a></nav><div className="email-config"><span>LOCAL PREVIEW</span><b>Resend-ready</b><small>Add the API key and verified sender only when you are ready to send.</small></div></aside>
    <section className="email-work"><header><div><label>NOTIFICATIONS</label><h1>Email design</h1><p>{current[2]}</p></div><span className="preview-pill">Preview mode</span></header>
      <div className="email-toolbar"><div><b>{current[1]}</b><span>Desktop email preview · made-up people and tasks</span></div><div className="legend"><span><i className="navy"/>Open</span><span><i className="orange"/>Overdue</span><span><i className="green"/>Completed</span></div></div>
      <nav className="email-kinds" style={{display:"flex",gap:8,flexWrap:"wrap",margin:"0 0 14px"}}>{KINDS.map(k => <a key={k[0]} href={k[0] ? `/email-preview?kind=${k[0]}` : "/email-preview"} style={{padding:"6px 12px",borderRadius:999,border:"1px solid #c9d3e0",fontSize:13,fontWeight:k[0]===current[0]?700:500,background:k[0]===current[0]?"#173f76":"#fff",color:k[0]===current[0]?"#fff":"#173f76",textDecoration:"none"}}>{k[1]}</a>)}</nav>
      <div className="email-frame"><iframe title="Task AI email preview" src={current[0] ? `/api/email-preview?kind=${current[0]}` : "/api/email-preview"}/></div>
      <div className="delivery-note"><b>Safe local setup</b><span>The template is active locally. Actual delivery remains off until <code>RESEND_API_KEY</code> and <code>TASK_AI_FROM_EMAIL</code> are configured.</span></div>
    </section>
  </main>;
}
