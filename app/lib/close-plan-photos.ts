// Contact photos on a plan, taken from Salesforce: the newest
// "Profile_Picture.jpg" Attachment on the Contact. That is the file the
// iSEEit org chart shows, and the one Sales AI reads and writes
// (contact-enrichment.service.js / contact-sync.service.js in Sales AI).
// A copy is kept per plan and person (table close_plan_photos) so customer
// links can show it without Salesforce access; the person on the plan
// carries `photo` = the Attachment Id, which the page uses to show the
// picture and to load it again only when it changed. Initials stay the
// fallback. The pure helpers are tested in tests/close-plan-photos.test.ts.
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanPhotos } from "../../db/schema";
import { salesforceApi, salesforceDownload } from "./salesforce";

export const PHOTO_NAME = "Profile_Picture.jpg";
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const CONTACT_ID = /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const ATTACHMENT_ID = /^00P[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

type Person = { id: string; side?: string; sfdcContactId?: string; photo?: string };
export type AttachmentRow = { Id: string; ParentId: string; LastModifiedDate?: string };

// The plan's customer contacts that are linked to a Salesforce Contact.
export const photoContacts = (people: Person[]) => people.filter(p => p.side === "buyer" && typeof p.sfdcContactId === "string" && CONTACT_ID.test(p.sfdcContactId));

export function photoQuery(contactIds: string[]): string | null {
  const ids = [...new Set(contactIds.filter(id => CONTACT_ID.test(id)))].slice(0, 200);
  if (!ids.length) return null;
  return `SELECT Id, ParentId, LastModifiedDate FROM Attachment WHERE Name = '${PHOTO_NAME}' AND ParentId IN (${ids.map(id => `'${id}'`).join(",")}) ORDER BY LastModifiedDate DESC`;
}

// Contact Id → its newest photo Attachment Id. Sales AI uploads duplicates, so a contact can have many.
export function newestPhotos(rows: AttachmentRow[]): Map<string, string> {
  const sorted = [...rows].sort((a, b) => (b.LastModifiedDate || "").localeCompare(a.LastModifiedDate || ""));
  const newest = new Map<string, string>();
  for (const r of sorted) if (ATTACHMENT_ID.test(r.Id) && !newest.has(r.ParentId)) newest.set(r.ParentId, r.Id);
  return newest;
}

// Which people need a new photo downloaded, and which lost theirs in Salesforce.
export function photoWork(people: Person[], newest: Map<string, string>) {
  const fetch: Array<{ personId: string; attachmentId: string }> = [], clear: string[] = [];
  for (const p of photoContacts(people)) {
    const want = newest.get(p.sfdcContactId!);
    if (want && want !== p.photo) fetch.push({ personId: p.id, attachmentId: want });
    else if (!want && p.photo) clear.push(p.id);
  }
  return { fetch, clear };
}

// The real image type from the first bytes. Salesforce labels these files "image/jpg" whatever they are,
// and anything that isn't a picture is never stored or served.
export function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

// Brings the plan's contact photos in line with Salesforce. Updates `photo` on the people in `data` (the caller
// saves the plan) and returns whether any changed. Failures are logged and leave the existing photos alone.
export async function refreshPlanPhotos(planId: string, data: { people: Person[] }): Promise<boolean> {
  const soql = photoQuery(photoContacts(data.people).map(p => p.sfdcContactId!));
  if (!soql) return false;
  let rows: AttachmentRow[];
  try { rows = (await salesforceApi<{ records: AttachmentRow[] }>(`/query?q=${encodeURIComponent(soql)}`)).records; }
  catch (error) { console.error("Close Plan photos: Salesforce query failed:", error instanceof Error ? error.message : error); return false; }
  const work = photoWork(data.people, newestPhotos(rows));
  let changed = false;
  for (const job of work.fetch.slice(0, 20)) {
    try {
      const { bytes } = await salesforceDownload(`/sobjects/Attachment/${job.attachmentId}/Body`);
      const type = imageType(bytes);
      if (!type || bytes.length > MAX_PHOTO_BYTES) continue;
      const row = { planId, personId: job.personId, sourceId: job.attachmentId, contentType: type, dataBase64: bytes.toString("base64"), updatedAt: new Date() };
      await getDb().insert(closePlanPhotos).values(row).onConflictDoUpdate({ target: [closePlanPhotos.planId, closePlanPhotos.personId], set: row });
      const person = data.people.find(p => p.id === job.personId);
      if (person) { person.photo = job.attachmentId; changed = true; }
    } catch (error) { console.error("Close Plan photos: download failed:", error instanceof Error ? error.message : error); }
  }
  if (work.clear.length) {
    await getDb().delete(closePlanPhotos).where(and(eq(closePlanPhotos.planId, planId), inArray(closePlanPhotos.personId, work.clear)));
    for (const p of data.people) if (work.clear.includes(p.id)) { delete p.photo; changed = true; }
  }
  return changed;
}

// The stored photo for one person on a plan, or null.
export async function planPhoto(planId: string, personId: string) {
  const [row] = await getDb().select().from(closePlanPhotos).where(and(eq(closePlanPhotos.planId, planId), eq(closePlanPhotos.personId, personId))).limit(1);
  return row || null;
}

export function photoResponse(row: { contentType: string; dataBase64: string } | null) {
  if (!row) return new Response(null, { status: 404 });
  // The URL carries the Attachment Id (?v=), so a new photo gets a new URL and the old one can be cached.
  return new Response(new Uint8Array(Buffer.from(row.dataBase64, "base64")), { headers: { "content-type": row.contentType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
