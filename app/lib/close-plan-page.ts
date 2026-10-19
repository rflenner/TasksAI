import { readFile } from "node:fs/promises";
import path from "node:path";

// The Close Plan page (prototype/close-plan-demo.html) wrapped as a full document.
// Served at /close-plans for signed-in users and at /p/:token for customer contacts;
// the page itself decides which view it shows from its own path.
export type PageMeta = { title?: string; description?: string; origin?: string };
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// `meta` is what a link preview shows (iMessage, Slack, LinkedIn…) and what the browser tab says: a title, a short description
// and the iSEEit logo as the picture. Without it the page is "Mutual Closeplan".
export async function closePlanPageHtml(meta: PageMeta = {}) {
  const raw = await readFile(path.join(process.cwd(), "prototype", "close-plan-demo.html"), "utf8");
  const body = raw.replace(/<title>[\s\S]*?<\/title>/i, "");
  const title = esc(meta.title || "Mutual Closeplan");
  const description = esc(meta.description || "One shared plan from iSEEit and you: every step to signature and go-live, who owns what, and when it is due.");
  const image = meta.origin ? `${meta.origin.replace(/\/+$/, "")}/iseeit-logo-512.png` : "";
  const og = `<meta property="og:type" content="website"><meta property="og:site_name" content="iSEEit Mutual Closeplan"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">${image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="512"><meta property="og:image:height" content="512"><meta name="twitter:card" content="summary">` : ""}<meta name="description" content="${description}"><meta name="theme-color" content="#ffa614">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title}</title>${og}<link rel="icon" href="/favicon.svg"><style>body{margin:0}</style></head><body>${body}</body></html>`;
}
