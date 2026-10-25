import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../../db/schema";
import { MAX_PHOTO_BYTES, PHOTO_NAME, imageType, isAttachmentId, photoResponse } from "../../../../../../../lib/close-plan-photos";
import { canAccessPlan, canDeletePlan } from "../../../../../../../lib/close-plan-store";
import { salesforceApi, salesforceDownload } from "../../../../../../../lib/salesforce";
import { currentActor } from "../../../../../../../lib/session";

export const dynamic = "force-dynamic";

// A contact's Profile_Picture.jpg for the org chart view, read straight from Salesforce (nothing is stored here).
// The Salesforce connection can read every Attachment, so only a file named Profile_Picture.jpg on a Contact is served.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const { id, attachmentId } = await params;
  if (!isAttachmentId(attachmentId)) return new Response(null, { status: 404 });
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row) || !canDeletePlan(actor, row.data as Parameters<typeof canDeletePlan>[1])) return new Response(null, { status: 404 });
  try {
    const soql = `SELECT Id FROM Attachment WHERE Id = '${attachmentId}' AND Name = '${PHOTO_NAME}' AND ParentId IN (SELECT Id FROM Contact)`;
    const { records } = await salesforceApi<{ records: Array<{ Id: string }> }>(`/query?q=${encodeURIComponent(soql)}`);
    if (!records.length) return new Response(null, { status: 404 });
    const { bytes } = await salesforceDownload(`/sobjects/Attachment/${attachmentId}/Body`);
    const type = imageType(bytes);
    if (!type || bytes.length > MAX_PHOTO_BYTES) return new Response(null, { status: 404 });
    return photoResponse({ contentType: type, dataBase64: bytes.toString("base64") });
  } catch {
    return new Response(null, { status: 502 });
  }
}
