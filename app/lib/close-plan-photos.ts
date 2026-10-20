// Photos of the people on a plan. Three sources, in this order:
//   1. a photo uploaded in Closeplan (by the person, or by the plan owner / an admin);
//   2. Salesforce: the newest "Profile_Picture.jpg" Attachment on the person's Contact.
//      That is the file the iSEEit org chart shows, and the one Sales AI reads and writes
//      (contact-enrichment.service.js / contact-sync.service.js in Sales AI). Customers are
//      matched by their linked Contact, the iSEEit team by a Contact with their email;
//   3. Sales AI: the contact's LinkedIn photo, through the export API's signed link
//      (linkedin_profile_image_signed_url on a single-contact lookup by email).
// An upload is never replaced by a sync, and is also written to Salesforce (the existing
// Profile_Picture.jpg is updated, so no duplicates). A copy of each photo is kept per plan
// and person (table close_plan_photos), so customer links show it without Salesforce or
// Sales AI access. The person on the plan carries `photo` (a version string the page puts
// in the image URL) and `photoSource`. Initials stay the fallback.
// The pure helpers are tested in tests/close-plan-photos.test.ts.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanDocuments, closePlanPhotos } from "../../db/schema";
import { memberEmails } from "./close-plan-store";
import { salesforceApi, salesforceDownload } from "./salesforce";

export const PHOTO_NAME = "Profile_Picture.jpg";
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const CONTACT_ID = /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const ATTACHMENT_ID = /^00P[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const SAFE_EMAIL = /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/;
const SALES_AI_CACHE_MS = 6 * 60 * 60 * 1000;
const SALES_AI_PER_SYNC = 10;

export type PhotoSource = "upload" | "salesforce" | "salesai";
export type Person = { id: string; side?: string; email?: string; sfdcContactId?: string; photo?: string; photoSource?: PhotoSource };
export type AttachmentRow = { Id: string; ParentId: string; LastModifiedDate?: string };
type Photo = { attachmentId: string; at: string };

export const emailOf = (p: { email?: string }) => (p.email || "").trim().toLowerCase();
const validEmail = (e: string) => SAFE_EMAIL.test(e);

// --- pure helpers ------------------------------------------------------------
export function contactsByEmailQuery(emails: string[]): string | null {
  const list = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(validEmail))].slice(0, 100);
  return list.length ? `SELECT Id, Email FROM Contact WHERE Email IN (${list.map(e => `'${e}'`).join(",")})` : null;
}

export function photoQuery(contactIds: string[]): string | null {
  const ids = [...new Set(contactIds.filter(id => CONTACT_ID.test(id)))].slice(0, 200);
  if (!ids.length) return null;
  return `SELECT Id, ParentId, LastModifiedDate FROM Attachment WHERE Name = '${PHOTO_NAME}' AND ParentId IN (${ids.map(id => `'${id}'`).join(",")}) ORDER BY LastModifiedDate DESC`;
}

// Contact Id → its newest photo. Sales AI uploads duplicates, so a contact can have many.
export function newestPhotos(rows: AttachmentRow[]): Map<string, Photo> {
  const newest = new Map<string, Photo>();
  for (const r of rows) {
    if (!ATTACHMENT_ID.test(r.Id)) continue;
    const at = r.LastModifiedDate || "", cur = newest.get(r.ParentId);
    if (!cur || at > cur.at) newest.set(r.ParentId, { attachmentId: r.Id, at });
  }
  return newest;
}

// The Salesforce Contacts that stand for a person: a customer's linked Contact, then any Contact with their email.
export function contactIdsFor(person: Person, byEmail: Map<string, string[]>): string[] {
  const ids = person.sfdcContactId && CONTACT_ID.test(person.sfdcContactId) ? [person.sfdcContactId] : [];
  for (const id of byEmail.get(emailOf(person)) || []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

// The newest photo across a person's Contacts.
export function bestPhoto(ids: string[], newest: Map<string, Photo>): string | null {
  let best: Photo | null = null;
  for (const id of ids) { const p = newest.get(id); if (p && (!best || p.at > best.at)) best = p; }
  return best ? best.attachmentId : null;
}

export type Decision = { kind: "keep" } | { kind: "salesforce"; attachmentId: string } | { kind: "salesai" };
// What a sync does for one person, given the Salesforce photo found for them (if any).
export function decide(person: Person, salesforcePhoto: string | null): Decision {
  if (person.photoSource === "upload") return { kind: "keep" };
  if (salesforcePhoto) return person.photo === salesforcePhoto ? { kind: "keep" } : { kind: "salesforce", attachmentId: salesforcePhoto };
  return { kind: "salesai" };
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

// --- storage -------------------------------------------------------------------
async function storePhoto(planId: string, personId: string, source: PhotoSource, sourceId: string, bytes: Buffer, contentType: string) {
  const row = { planId, personId, source, sourceId, contentType, dataBase64: bytes.toString("base64"), updatedAt: new Date() };
  await getDb().insert(closePlanPhotos).values(row).onConflictDoUpdate({ target: [closePlanPhotos.planId, closePlanPhotos.personId], set: row });
}
export async function removeStoredPhoto(planId: string, personIds: string[]) {
  if (personIds.length) await getDb().delete(closePlanPhotos).where(and(eq(closePlanPhotos.planId, planId), inArray(closePlanPhotos.personId, personIds)));
}

// Changes one person on a stored plan and saves it as a new version, retrying if someone saved in between.
export async function updatePlanPerson(planId: string, personId: string, change: (p: Person) => void) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, planId), isNull(closePlanDocuments.deletedAt))).limit(1);
    if (!row) return null;
    const data = structuredClone(row.data) as { people?: Person[] };
    const person = (data.people || []).find(p => p.id === personId);
    if (!person) return null;
    change(person);
    const [saved] = await getDb().update(closePlanDocuments).set({ data, memberEmails: memberEmails(data), version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(closePlanDocuments.id, planId), eq(closePlanDocuments.version, row.version))).returning();
    if (saved) return saved;
  }
  return null;
}

// --- Sales AI ----------------------------------------------------------------------
const salesAiSeen = new Map<string, { at: number; key: string | null; url: string | null }>();
async function salesAiPhoto(email: string): Promise<{ key: string; url: string } | null> {
  const apiKey = process.env.SALES_AI_API_KEY, base = process.env.SALES_AI_BASE_URL;
  if (!apiKey || !base || !validEmail(email)) return null;
  const cached = salesAiSeen.get(email);
  if (cached && Date.now() - cached.at < SALES_AI_CACHE_MS) return cached.key && cached.url ? { key: cached.key, url: cached.url } : null;
  const url = `${base.replace(/\/+$/, "")}/contacts?email=${encodeURIComponent(email)}&limit=1`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) { salesAiSeen.set(email, { at: Date.now(), key: null, url: null }); return null; }
  if (!response.ok) throw new Error(`Sales AI contact lookup failed (${response.status})`);
  const contact = ((await response.json()) as { data?: Array<{ linkedin_profile_image_url?: string | null; linkedin_profile_image_signed_url?: string | null }> }).data?.[0];
  const key = contact?.linkedin_profile_image_url || null, signed = contact?.linkedin_profile_image_signed_url || null;
  // Until Sales AI's export returns the signed link, a stored photo can't be fetched: treat as none.
  salesAiSeen.set(email, { at: Date.now(), key: signed ? key : null, url: signed });
  return key && signed ? { key, url: signed } : null;
}
async function download(url: string): Promise<Buffer> {
  if (!url.startsWith("https://")) throw new Error("Refusing a non-https photo link");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Photo download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

// --- Salesforce lookups ------------------------------------------------------------
const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;
async function contactsByEmail(people: Person[]): Promise<Map<string, string[]>> {
  const soql = contactsByEmailQuery(people.map(emailOf));
  const byEmail = new Map<string, string[]>();
  if (!soql) return byEmail;
  for (const c of await query<{ Id: string; Email: string | null }>(soql)) {
    const e = (c.Email || "").toLowerCase();
    byEmail.set(e, [...(byEmail.get(e) || []), c.Id]);
  }
  return byEmail;
}

// Brings the plan's photos in line with Salesforce and Sales AI. Updates `photo` / `photoSource` on the people
// in `data` (the caller saves the plan) and returns whether any changed. Failures leave existing photos alone.
export async function refreshPlanPhotos(planId: string, data: { people: Person[] }): Promise<boolean> {
  const people = data.people.filter(p => p.photoSource !== "upload" && (p.sfdcContactId || validEmail(emailOf(p))));
  if (!people.length) return false;
  let byEmail = new Map<string, string[]>(), newest = new Map<string, Photo>(), salesforceOk = true;
  try {
    byEmail = await contactsByEmail(people);
    const soql = photoQuery(people.flatMap(p => contactIdsFor(p, byEmail)));
    if (soql) newest = newestPhotos(await query<AttachmentRow>(soql));
  } catch (error) { salesforceOk = false; console.error("Close Plan photos: Salesforce lookup failed:", error instanceof Error ? error.message : error); }

  let changed = false, salesAiCalls = 0;
  const set = (p: Person, photo: string | undefined, source: PhotoSource | undefined) => {
    if (p.photo === photo && p.photoSource === source) return;
    if (photo) { p.photo = photo; p.photoSource = source; } else { delete p.photo; delete p.photoSource; }
    changed = true;
  };
  for (const p of people) {
    const decision = decide(p, bestPhoto(contactIdsFor(p, byEmail), newest));
    try {
      if (decision.kind === "salesforce") {
        const { bytes } = await salesforceDownload(`/sobjects/Attachment/${decision.attachmentId}/Body`);
        const type = imageType(bytes);
        if (!type || bytes.length > MAX_PHOTO_BYTES) continue;
        await storePhoto(planId, p.id, "salesforce", decision.attachmentId, bytes, type);
        set(p, decision.attachmentId, "salesforce");
      } else if (decision.kind === "salesai") {
        // Sales AI only fills gaps; don't drop a Salesforce photo just because Salesforce couldn't be reached.
        if (!salesforceOk && p.photoSource === "salesforce") continue;
        if (salesAiCalls >= SALES_AI_PER_SYNC || !validEmail(emailOf(p))) continue;
        salesAiCalls++;
        const found = await salesAiPhoto(emailOf(p));
        const version = found ? `salesai:${found.key}` : undefined;
        if (!found) { if (p.photo) { await removeStoredPhoto(planId, [p.id]); set(p, undefined, undefined); } continue; }
        if (p.photo === version) continue;
        const bytes = await download(found.url);
        const type = imageType(bytes);
        if (!type || bytes.length > MAX_PHOTO_BYTES) continue;
        await storePhoto(planId, p.id, "salesai", found.key, bytes, type);
        set(p, version, "salesai");
      }
    } catch (error) { console.error("Close Plan photos: update failed:", error instanceof Error ? error.message : error); }
  }
  return changed;
}

// --- uploads ---------------------------------------------------------------------------
// Checks and stores an uploaded photo, marks it on the plan, and writes it to Salesforce. Returns the saved plan.
export async function uploadPhoto(planId: string, person: Person, bytes: Buffer) {
  const type = imageType(bytes);
  if (!type) return { error: "That file is not a picture (JPEG, PNG, GIF or WebP)." } as const;
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "The picture is too large (max 2 MB)." } as const;
  const version = `upload-${Date.now()}`;
  await storePhoto(planId, person.id, "upload", version, bytes, type);
  const saved = await updatePlanPerson(planId, person.id, p => { p.photo = version; p.photoSource = "upload"; });
  if (!saved) return { error: "The plan is busy. Please try again." } as const;
  let salesforce: "updated" | "created" | "skipped" | "failed" = "skipped";
  try { salesforce = await writePhotoToSalesforce(person, bytes, type); }
  catch (error) { salesforce = "failed"; console.error("Close Plan photos: Salesforce write failed:", error instanceof Error ? error.message : error); }
  return { saved, salesforce } as const;
}

// Removes an uploaded photo; the next sync fills in the Salesforce or Sales AI photo again, if there is one.
export async function removeUploadedPhoto(planId: string, personId: string) {
  await removeStoredPhoto(planId, [personId]);
  return updatePlanPerson(planId, personId, p => { delete p.photo; delete p.photoSource; });
}

// The uploaded photo becomes the person's Profile_Picture.jpg in Salesforce: the newest one is updated in place
// (so the org chart shows it and no duplicate is added), or one is created on their Contact.
async function writePhotoToSalesforce(person: Person, bytes: Buffer, type: string): Promise<"updated" | "created" | "skipped"> {
  if (type !== "image/jpeg") return "skipped"; // the org chart file is a .jpg; the page always uploads JPEG
  const ids = contactIdsFor(person, await contactsByEmail([person]));
  if (!ids.length) return "skipped";
  const soql = photoQuery(ids);
  const photo = soql ? bestPhoto(ids, newestPhotos(await query<AttachmentRow>(soql))) : null;
  const body = bytes.toString("base64");
  if (photo) { await salesforceApi(`/sobjects/Attachment/${photo}`, { method: "PATCH", body: { Body: body } }); return "updated"; }
  await salesforceApi("/sobjects/Attachment", { method: "POST", body: { ParentId: ids[0], Name: PHOTO_NAME, ContentType: "image/jpg", Body: body } });
  return "created";
}

// --- serving ---------------------------------------------------------------------------
export async function planPhoto(planId: string, personId: string) {
  const [row] = await getDb().select().from(closePlanPhotos).where(and(eq(closePlanPhotos.planId, planId), eq(closePlanPhotos.personId, personId))).limit(1);
  return row || null;
}

export function photoResponse(row: { contentType: string; dataBase64: string } | null) {
  if (!row) return new Response(null, { status: 404 });
  // The URL carries the photo version (?v=), so a new photo gets a new URL and the old one can be cached.
  return new Response(new Uint8Array(Buffer.from(row.dataBase64, "base64")), { headers: { "content-type": row.contentType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}

export async function readUpload(request: Request): Promise<Buffer | null> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_PHOTO_BYTES) return null;
  const bytes = Buffer.from(await request.arrayBuffer());
  return bytes.length && bytes.length <= MAX_PHOTO_BYTES ? bytes : null;
}
