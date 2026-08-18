import { renderTaskDigest } from "../../lib/email";
import { currentActor } from "../../lib/session";

export async function GET(request: Request) {
  const actor=await currentActor();if(actor?.role!=="site_admin")return Response.json({error:"Site Admin access required"},{status:403});
  const appUrl = new URL(request.url).origin;
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
