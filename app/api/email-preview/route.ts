import { renderAddedToPlan, renderAssigned, renderInvitation } from "../../lib/close-plan-emails";
import { renderTaskDigest } from "../../lib/email";
import { currentActor } from "../../lib/session";
import { publicRequestOrigin } from "../../lib/request";

export async function GET(request: Request) {
  const actor=await currentActor();if(actor?.role!=="site_admin")return Response.json({error:"Site Admin access required"},{status:403});
  const appUrl = publicRequestOrigin(request);
  // The Close Plan emails, with made-up people and tasks (?kind=close-plan-invitation | close-plan-reminder | close-plan-added).
  const kind = new URL(request.url).searchParams.get("kind") || "";
  const html = (h: string) => new Response(h, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const sample = { firstName: "Gary", fromName: "Rizan Flenner", planTitle: "Cluepoints close plan", url: `${appUrl}/p/example`, unsubscribeUrl: `${appUrl}/unsubscribe/example`, can: ["See the whole shared plan and post updates on your tasks", "Close and edit the tasks you own or work on", "Add new tasks and subtasks"],
    tasks: [{ title: "Create a demo environment for Cluepoints", due: "2026-10-20", description: "Set up a demo environment so the Cluepoints team can try the close plan.", status: "In progress" }, { title: "Confirm the success criteria", due: "2026-10-12", overdue: true }] };
  if (kind === "close-plan-invitation") return html(renderInvitation(sample).html);
  if (kind === "close-plan-reminder") return html(renderInvitation({ ...sample, reminder: true }).html);
  if (kind === "close-plan-assigned") return html(renderAssigned({ firstName: "Drew", byName: "Rizan Flenner", planTitle: "Cluepoints close plan", url: `${appUrl}/close-plans`, unsubscribeUrl: `${appUrl}/unsubscribe/example`, tasks: [{ title: "Create a demo environment for Cluepoints", role: "Owner", due: "2026-10-20", description: "Set up a demo environment so the Cluepoints team can try the close plan.", status: "In progress" }, { title: "Confirm the success criteria", role: "Coworker", due: "2026-10-12", overdue: true }] }).html);
  if (kind === "close-plan-added") return html(renderAddedToPlan({ firstName: "Drew", byName: "Rizan Flenner", planTitle: "Cluepoints close plan", role: "Solutions engineer", url: `${appUrl}/close-plans`, unsubscribeUrl: `${appUrl}/unsubscribe/example` }).html);
  const email = renderTaskDigest({
    firstName: "Rizan", appUrl, open: 5, overdue: 1, completed: 3,
    pending: [
      { subject: "Review and approve marketing content", description: "Check the campaign copy and confirm the final changes before launch.", project: "Marketing Sales AI launch", meeting: "Marketing Coordination", due: "Today", role: "Coworker", status: "In progress", overdue: true, url: appUrl },
      { subject: "Confirm customer pilot success criteria", description: "Align the measurable outcomes with the customer pilot team.", project: "Customer Pilot", meeting: "Weekly Pilot Call", due: "21 Aug", role: "Owner", status: "Open", url: appUrl },
    ],
    accomplished: [{ subject: "Share revised project timeline", project: "Customer Pilot", meeting: "Weekly Pilot Call", due: "Completed 17 Aug", role: "Owner", status: "Completed", url: appUrl }],
  });
  return new Response(email.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
