// PDF files attached to tasks on a Close Plan, uploaded by the iSEEit team (signed in) and by customers (personal link).
// Stored in Postgres (table close_plan_attachments), outside the plan JSON so a save of the plan never races with an upload.
//
// Safety: only real PDFs (the file must start with "%PDF-"; the name and the browser's claimed type are not trusted), at most
// 10 MB, always served as a download with a fixed type and nosniff so a browser never runs them. A customer sees only files
// marked shared on tasks that are shared with them, and may only add files to tasks they can post updates on; everyone may
// remove their own files, plan owners and admins any file. The pure rules are tested in tests/close-plan-attachments.test.ts.
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanAttachments } from "../../db/schema";
import { accessOf, canUpdateTask, customerPerson, isShared } from "./close-plan-share";

type Obj = Record<string, unknown>;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 20;

export type AttachmentMeta = { id: string; taskId: string; name: string; size: number; shared: boolean; by: string; byName: string; bySide: string; at: string; canRemove: boolean };
export type Uploader = { key: string; name: string; side: "seller" | "buyer" };

const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];

// A real PDF starts with "%PDF-".
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

// A safe display and download name: no path, no control characters or quotes, ends in .pdf, at most 120 characters.
export function cleanFileName(raw: unknown): string {
  let name = String(raw ?? "").split(/[\\/]/).pop() || "";
  name = name.replace(/[\u0000-\u001f\u007f"<>:*?|]/g, "").replace(/\s+/g, " ").trim();
  const base = name.replace(/\.pdf$/i, "").replace(/^\.+/, "").trim();
  return `${(base || "Document").slice(0, 116)}.pdf`;
}

// What an iSEEit user may do with a task's files in this plan; `data` is the stored plan.
export function taskById(data: Obj, taskId: string): Obj | null { return arr(data.tasks).find(t => t.id === taskId) || null; }

// A customer may add a file to a task only if it is shared with them and they may post updates on it.
export function customerMayAttach(data: Obj, personId: string, taskId: string): boolean {
  const person = customerPerson(data, personId), task = taskById(data, taskId);
  return Boolean(person && task && isShared(task, arr(data.tasks)) && canUpdateTask(task, personId, accessOf(person)));
}
// What a customer is shown: shared files on tasks that are shared with them.
export function customerSees(data: Obj, att: { taskId: string; shared: boolean }): boolean {
  const task = taskById(data, att.taskId);
  return Boolean(task && att.shared && isShared(task, arr(data.tasks)));
}

// ---- database ----
const metaCols = { id: closePlanAttachments.id, taskId: closePlanAttachments.taskId, name: closePlanAttachments.name, size: closePlanAttachments.size, shared: closePlanAttachments.shared, uploadedBy: closePlanAttachments.uploadedBy, uploadedByName: closePlanAttachments.uploadedByName, uploadedBySide: closePlanAttachments.uploadedBySide, createdAt: closePlanAttachments.createdAt };
type MetaRow = { id: string; taskId: string; name: string; size: number; shared: boolean; uploadedBy: string; uploadedByName: string; uploadedBySide: string; createdAt: Date };
const toMeta = (r: MetaRow, canRemove: boolean): AttachmentMeta => ({ id: r.id, taskId: r.taskId, name: r.name, size: r.size, shared: r.shared, by: r.uploadedBy, byName: r.uploadedByName, bySide: r.uploadedBySide, at: r.createdAt.toISOString().slice(0, 10), canRemove });

// All files of a plan for this viewer. `filter` drops what the viewer may not see; `admin` lets them remove any file.
export async function listAttachments(planId: string, viewer: { key: string; admin: boolean }, filter?: (r: MetaRow) => boolean): Promise<AttachmentMeta[]> {
  const rows = await getDb().select(metaCols).from(closePlanAttachments).where(eq(closePlanAttachments.planId, planId)).orderBy(asc(closePlanAttachments.createdAt));
  return rows.filter(r => !filter || filter(r)).map(r => toMeta(r, viewer.admin || r.uploadedBy === viewer.key));
}

export async function addAttachment(planId: string, taskId: string, file: { name: string; bytes: Buffer }, shared: boolean, by: Uploader): Promise<{ ok: true; meta: AttachmentMeta } | { ok: false; error: string; status: number }> {
  if (!isPdf(file.bytes)) return { ok: false, error: "Only PDF files can be attached.", status: 400 };
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: "The file is larger than 10 MB.", status: 413 };
  const existing = await getDb().select({ id: closePlanAttachments.id }).from(closePlanAttachments).where(and(eq(closePlanAttachments.planId, planId), eq(closePlanAttachments.taskId, taskId)));
  if (existing.length >= MAX_ATTACHMENTS_PER_TASK) return { ok: false, error: `A task can have at most ${MAX_ATTACHMENTS_PER_TASK} files.`, status: 400 };
  const [row] = await getDb().insert(closePlanAttachments).values({
    id: randomUUID(), planId, taskId, name: cleanFileName(file.name), size: file.bytes.length, shared, uploadedBy: by.key, uploadedByName: by.name.slice(0, 120), uploadedBySide: by.side, data: file.bytes,
  }).returning(metaCols);
  return { ok: true, meta: toMeta(row, true) };
}

export async function loadAttachment(planId: string, id: string) {
  const [row] = await getDb().select().from(closePlanAttachments).where(and(eq(closePlanAttachments.planId, planId), eq(closePlanAttachments.id, id))).limit(1);
  return row || null;
}
export async function removeAttachment(planId: string, id: string) {
  await getDb().delete(closePlanAttachments).where(and(eq(closePlanAttachments.planId, planId), eq(closePlanAttachments.id, id)));
}

// The file as a download. Fixed type, no sniffing, never shown inline.
export function pdfResponse(row: { name: string; data: Buffer }): Response {
  const ascii = row.name.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Uint8Array(row.data), { headers: {
    "content-type": "application/pdf", "content-length": String(row.data.length), "x-content-type-options": "nosniff", "cache-control": "private, no-store",
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.name)}`, "content-security-policy": "default-src 'none'; sandbox",
  } });
}

// Reads the uploaded form (field "file", optional "taskId" and "shared"), refusing anything oversized before it is read into memory.
export async function readUploadForm(request: Request): Promise<{ file: { name: string; bytes: Buffer }; taskId: string; shared: boolean } | { error: string; status: number }> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_ATTACHMENT_BYTES + 100_000) return { error: "The file is larger than 10 MB.", status: 413 };
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return { error: "Choose a PDF file.", status: 400 };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "The file is larger than 10 MB.", status: 413 };
  return { file: { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, taskId: String(form.get("taskId") || ""), shared: form.get("shared") !== "false" };
}
