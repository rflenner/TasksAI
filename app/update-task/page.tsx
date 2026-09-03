"use client";
import { useEffect, useState } from "react";
import "../accept/accept.css";
import "./update-task.css";

type TaskInfo = { subject: string; description: string; status: string; due: string | null; owner: string };
type LoadState = "loading" | "ready" | "expired" | "posted";

// Reached from a link in a digest email, no sign-in at all — the token in
// the URL is the credential, scoped to exactly one task by
// app/api/tasks/quick-update. Built for the person who reads Task AI's
// emails but never opens the app: this is the one thing they need to be
// able to do without it — leave an update, optionally change the status,
// done.
//
// Same reasoning as /login/confirm: the token isn't spent just by this
// page loading (GET is read-only and this token is reusable anyway, see
// db/schema.ts's taskUpdateTokens), so an email client's link-scanner
// prefetching this page harmlessly does nothing. The actual update still
// only happens on an explicit click here, on our own origin.
export default function UpdateTaskPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [recipientName, setRecipientName] = useState("");
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- deliberate one-time fetch-on-mount driven by the URL's token; there's no prop/state this could derive from instead. */
    const value = new URLSearchParams(location.search).get("token") || "";
    setToken(value);
    if (!value) { setState("expired"); return; }
    void (async () => {
      const response = await fetch(`/api/tasks/quick-update?token=${encodeURIComponent(value)}`);
      if (!response.ok) { setState("expired"); return; }
      const data = await response.json() as { recipientName: string; task: TaskInfo };
      setRecipientName(data.recipientName);
      setTask(data.task);
      setStatus(data.task.status);
      setState("ready");
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const submit = async () => {
    if (posting || !text.trim() && status === task?.status) return;
    setPosting(true); setError("");
    const response = await fetch("/api/tasks/quick-update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, text, status }) });
    const data = await response.json().catch(() => ({}));
    setPosting(false);
    if (!response.ok) { setError(data.error || "That didn't go through — try again."); return; }
    setState("posted");
  };

  return (
    <main className="onboard">
      <section className="onboard-card">
        <div className="onboard-logo">Task <b>AI</b></div>

        {state === "loading" && <p>Loading…</p>}

        {state === "expired" && (
          <>
            <p>UPDATE A TASK</p>
            <h1>This link has expired</h1>
            <p className="onboard-error">Links like this are only valid for 30 days. Ask whoever sent it to send a fresh one, or reach out to your Task AI admin directly.</p>
          </>
        )}

        {state === "posted" && (
          <>
            <div className="success-mark">✓</div>
            <h1 style={{ marginTop: 16 }}>Update posted</h1>
            <p>Thanks{recipientName ? `, ${recipientName.split(" ")[0]}` : ""} — that&apos;s been added to the task.</p>
          </>
        )}

        {state === "ready" && task && (
          <>
            <p>UPDATE A TASK</p>
            <h1>{task.subject}</h1>
            {task.description && <p>{task.description}</p>}
            <div className="invite-context">
              <span>Owner: <b>{task.owner}</b>{task.due && ` · Due ${task.due}`}</span>
            </div>
            {error && <p className="onboard-error">{error}</p>}
            <div className="onboard-form">
              <label className="onboard-field">
                Status
                <select value={status} onChange={e => setStatus(e.target.value)}>
                  <option>Open</option>
                  <option>In progress</option>
                  <option>Closed</option>
                </select>
              </label>
              <label className="onboard-field">
                Add an update
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Share progress, a blocker, or a decision…" />
                <small>Posted as {recipientName || "you"} — visible to everyone on this task.</small>
              </label>
              <button className="onboard-primary" disabled={posting || (!text.trim() && status === task.status)} onClick={() => void submit()}>
                {posting ? "Posting…" : "Post update"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
