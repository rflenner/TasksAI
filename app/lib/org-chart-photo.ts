import { MAX_PHOTO_BYTES, imageType, isAttachmentId, photoResponse } from "./close-plan-photos";
import { salesforceApi, salesforceDownload } from "./salesforce";

// A contact's Profile_Picture… image for an org chart card, read straight from Salesforce (nothing is stored). The
// connection can read every Attachment, so only a file named Profile_Picture… that hangs off a Contact is served.
export async function contactPhotoResponse(attachmentId: string): Promise<Response> {
  if (!isAttachmentId(attachmentId)) return new Response(null, { status: 404 });
  try {
    const soql = `SELECT Id FROM Attachment WHERE Id = '${attachmentId}' AND Name LIKE 'Profile_Picture%' AND ParentId IN (SELECT Id FROM Contact)`;
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
