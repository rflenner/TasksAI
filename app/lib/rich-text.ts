// Rich text for task descriptions and status updates. The page stores a cleaned-up HTML copy next to the plain text
// ("descHtml" beside "desc", "html" beside an update's "text"), so everything that reads the plain text (Salesforce,
// emails, voice, the digest) keeps working unchanged. Whatever arrives from a browser is reduced to the few tags the
// editor offers, so a stored copy can never carry script, styles or other markup into another person's page.

const ALLOWED = new Set(["p", "br", "strong", "em", "ul", "ol", "li", "a"]);
const ALIASES: Record<string, string> = { b: "strong", i: "em" };
const SKIP_CONTENT = new Set(["script", "style", "template", "head", "title"]);
const VOID = new Set(["br"]);

const escapeText = (s: string) => s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeHref(attrs: string): string | null {
  const m = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const raw = (m?.[1] ?? m?.[2] ?? "").replace(/&amp;/gi, "&").trim();
  if (!/^(https?:\/\/|mailto:)/i.test(raw) || /[\s<>"'`]/.test(raw)) return null;
  return raw.replace(/&/g, "&amp;");
}

export function sanitizeRichHtml(input: unknown, max = 20_000): string {
  if (typeof input !== "string" || !input) return "";
  const src = input.slice(0, max * 2);
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+|<)/g;
  const stack: string[] = [];
  let out = "", skip: string | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) { if (!skip) out += escapeText(m[4]); continue; }
    if (m[2] === undefined) continue; // a comment
    const closing = m[1] === "/";
    const raw = m[2].toLowerCase();
    if (skip) { if (closing && raw === skip) skip = null; continue; }
    if (SKIP_CONTENT.has(raw)) { if (!closing) skip = raw; continue; }
    const tag = ALIASES[raw] ?? raw;
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0 || VOID.has(tag)) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    if (VOID.has(tag)) { out += "<br>"; continue; }
    if (tag === "a") {
      const href = safeHref(m[3]);
      if (!href) continue;
      out += `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
    } else out += `<${tag}>`;
    stack.push(tag);
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out.length > max ? "" : out.trim();
}
