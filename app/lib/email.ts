export type DigestTask = {
  subject: string;
  description?: string;
  project?: string;
  meeting?: string;
  due?: string;
  role?: "Owner" | "Coworker" | "Recipient";
  status?: "Open" | "In progress" | "Completed";
  overdue?: boolean;
  url?: string;
};

type DigestInput = {
  firstName: string;
  appUrl: string;
  open: number;
  overdue: number;
  completed: number;
  pending: DigestTask[];
  accomplished: DigestTask[];
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character] || character));

function tag(label: string, value?: string) {
  if (!value) return "";
  const icon = label === "Project" ? "▰" : label === "Meeting" ? "↻" : "";
  return `<span style="display:inline-block;margin:0 8px 5px 0;padding:4px 9px;border:1px solid #d9e4f2;border-radius:999px;background:#f1f6fc;color:#49698e;font-size:11px;line-height:1.1">${icon ? `${icon}&nbsp;&nbsp;` : ""}${esc(value)}</span>`;
}

function taskCard(task: DigestTask) {
  const color = task.overdue ? "#c87300" : task.status === "Completed" ? "#25784b" : "#173f76";
  const date = task.overdue ? `Overdue · ${task.due || "Due date passed"}` : task.due ? `Due · ${task.due}` : "No due date";
  const status = task.status || "Open";
  const statusBackground = status === "Completed" ? "#e4f4eb" : status === "In progress" ? "#fff1d6" : "#f2f4f7";
  const statusColor = status === "Completed" ? "#25784b" : status === "In progress" ? "#9b5d00" : "#202735";
  return `<tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfe5ec;border-radius:12px;background:#ffffff">
      <tr>
        <td width="48" valign="top" style="padding:20px 0 18px 20px"><span style="display:inline-block;width:19px;height:19px;border:2px solid #9da8b5;border-radius:5px;color:${task.status === "Completed" ? "#fff" : "transparent"};background:${task.status === "Completed" ? "#173f76" : "#fff"};font-size:13px;line-height:19px;text-align:center">✓</span></td>
        <td valign="top" style="padding:18px 8px 17px 0">
          <div style="font-size:17px;line-height:1.4;font-weight:400;color:#173f76">${esc(task.subject)}</div>
          ${task.description ? `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:#6f7885">${esc(task.description)}</div>` : ""}
          <div style="margin-top:13px">${tag("Project", task.project)}${tag("Meeting", task.meeting)}<span style="display:inline-block;margin:0 12px 5px 0;color:${color};font-size:11px">▣&nbsp;&nbsp;${esc(date)}</span>${task.role ? `<span style="display:inline-block;margin:0 8px 5px 0;color:#7a8492;font-size:11px">For ${esc(task.role)}</span>` : ""}</div>
        </td>
        <td width="88" valign="top" align="right" style="padding:18px 17px 17px 0"><span style="display:inline-block;padding:5px 9px;border-radius:999px;background:${statusBackground};color:${statusColor};font-size:11px;font-weight:700">${esc(status)}</span></td>
        <td width="25" valign="top" align="right" style="padding:19px 16px 17px 0"><a href="${esc(task.url || "#")}" aria-label="View ${esc(task.subject)}" style="color:#202735;font-size:25px;line-height:1;text-decoration:none">›</a></td>
      </tr>
    </table>
  </td></tr>`;
}

export function renderTaskDigest(input: DigestInput) {
  const pending = input.pending.map(taskCard).join("");
  const accomplished = input.accomplished.map(taskCard).join("");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Your Task AI summary</title></head>
  <body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#202735">
    <div style="display:none;max-height:0;overflow:hidden">${input.open} open action items, ${input.overdue} overdue. Your Task AI summary is ready.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fa"><tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px">
        <tr><td style="padding:0 4px 22px"><span style="font-size:30px;font-weight:800;color:#173f76">Task</span> <span style="display:inline-block;padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:20px;font-weight:800;vertical-align:4px">AI</span></td></tr>
        <tr><td style="padding:34px 34px 30px;border-radius:16px 16px 0 0;background:#173f76">
          <div style="color:#bcd0e8;font-size:12px;font-weight:700;letter-spacing:1.5px">YOUR TASK SUMMARY</div>
          <h1 style="margin:10px 0 8px;color:#fff;font-size:29px;line-height:1.25">Hello ${esc(input.firstName)}, here’s what needs your attention.</h1>
          <p style="margin:0;color:#dce7f4;font-size:15px;line-height:1.5">A clear view of your pending and recently accomplished action items.</p>
        </td></tr>
        <tr><td style="padding:24px 34px;background:#fff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td width="33%" style="padding:14px;border:1px solid #e5eaf0;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">OPEN</div><div style="margin-top:4px;font-size:27px;color:#173f76;font-weight:800">${input.open}</div></td>
            <td width="3%"></td><td width="30%" style="padding:14px;border:1px solid #ffd797;border-top:3px solid #ffa614;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">OVERDUE</div><div style="margin-top:2px;font-size:27px;color:#c87300;font-weight:800">${input.overdue}</div></td>
            <td width="3%"></td><td width="31%" style="padding:14px;border:1px solid #e5eaf0;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">COMPLETED</div><div style="margin-top:4px;font-size:27px;color:#25784b;font-weight:800">${input.completed}</div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:4px 34px 30px;background:#fff">
          <h2 style="margin:14px 0 15px;color:#102f59;font-size:19px">Needs attention</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${pending || `<tr><td style="padding:18px;background:#f5f8fb;border-radius:10px;color:#687384">You have no pending action items.</td></tr>`}</table>
          ${accomplished ? `<h2 style="margin:26px 0 15px;color:#102f59;font-size:19px">Recently accomplished</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${accomplished}</table>` : ""}
          <div style="text-align:center;padding:20px 0 4px"><a href="${esc(input.appUrl)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#173f76;color:#fff;font-size:14px;font-weight:700;text-decoration:none">Open my Task AI workspace</a></div>
        </td></tr>
        <tr><td style="padding:22px 30px;border-top:1px solid #e5eaf0;border-radius:0 0 16px 16px;background:#fff;text-align:center;color:#8a94a2;font-size:11px;line-height:1.6">You received this update because you are an owner, coworker, or recipient in Task AI.<br>Notification preferences will be available in your profile.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  const text = `Hello ${input.firstName},\n\nYour Task AI summary: ${input.open} open, ${input.overdue} overdue, ${input.completed} completed.\n\n${input.pending.map(task => `- ${task.subject} (${task.due || "no due date"})`).join("\n")}\n\nOpen Task AI: ${input.appUrl}`;
  return { subject: `${input.overdue ? `${input.overdue} overdue · ` : ""}Your Task AI summary`, html, text };
}

export function renderInvitationEmail(input: { name?: string; inviteUrl: string; invitedBy?: string }) {
  const name = input.name && input.name !== "Invited user" ? input.name.split(" ")[0] : "there";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76">Task</span> <span style="padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800">AI</span></td></tr><tr><td style="padding:38px 34px"><div style="font-size:11px;letter-spacing:1.4px;font-weight:800;color:#173f76">YOU’RE INVITED</div><h1 style="margin:10px 0;color:#102f59;font-size:27px">Hello ${esc(name)}, join your team in Task AI.</h1><p style="color:#687384;font-size:15px;line-height:1.6">${esc(input.invitedBy || "Your team")} invited you to confirm your profile and see the action items shared with you.</p><a href="${esc(input.inviteUrl)}" style="display:inline-block;margin-top:15px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Confirm profile & view tasks</a><p style="margin-top:28px;color:#9299a3;font-size:11px">This secure invitation expires after seven days and can only be used once.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: "You’re invited to Task AI", html, text: `You have been invited to Task AI. Confirm your profile and view your tasks: ${input.inviteUrl}` };
}

export async function sendWithResend(message: { to: string; subject: string; html: string; text: string; idempotencyKey?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.TASK_AI_FROM_EMAIL;
  if (!apiKey || !from) return { sent: false, reason: "Resend is not configured; invitation link is ready for local testing." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "TaskAI/0.1",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text, tags: [{ name: "app", value: "task-ai" }] }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.message || "Resend could not send the email"));
  return { sent: true, id: result.id };
}
