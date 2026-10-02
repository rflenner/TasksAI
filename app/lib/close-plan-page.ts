import { readFile } from "node:fs/promises";
import path from "node:path";

// The Close Plan page (prototype/close-plan-demo.html) wrapped as a full document.
// Served at /close-plans for signed-in users and at /p/:token for customer contacts;
// the page itself decides which view it shows from its own path.
export async function closePlanPageHtml() {
  const body = await readFile(path.join(process.cwd(), "prototype", "close-plan-demo.html"), "utf8");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="/favicon.svg"><style>body{margin:0}</style></head><body>${body}</body></html>`;
}
