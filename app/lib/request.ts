export function publicRequestOrigin(request: Request) {
  const firstHeaderValue = (name: string) => request.headers.get(name)?.split(",", 1)[0]?.trim();
  const internalUrl = new URL(request.url);
  const host = firstHeaderValue("x-forwarded-host") || firstHeaderValue("host");
  const protocol = firstHeaderValue("x-forwarded-proto") || internalUrl.protocol.slice(0, -1);

  if (!host || !/^(https?|wss?)$/.test(protocol)) return internalUrl.origin;
  try { return new URL(`${protocol}://${host}`).origin; } catch { return internalUrl.origin; }
}

export function publicRequestUrl(request: Request, path: string) {
  return new URL(path, publicRequestOrigin(request));
}

// The origin used for links inside outgoing emails specifically — prefers
// the static APP_URL env var over whatever host the triggering request came
// in on, so every email consistently links to one canonical address instead
// of following the admin's browser around (tasks.flenner.at one day,
// tasks-ai.onrender.com the next, a future domain after that). Falls back to
// the request's own origin if APP_URL isn't set, rather than failing the
// whole request — a missing env var shouldn't block sending. Deliberately
// separate from requireSameOrigin's use of publicRequestOrigin below, which
// must stay tied to the real request for CSRF protection to mean anything.
export function appLinkOrigin(request: Request) {
  return process.env.APP_URL || publicRequestOrigin(request);
}
export function appLinkUrl(request: Request, path: string) {
  return new URL(path, appLinkOrigin(request));
}

export function requireSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  if (!origin || origin !== publicRequestOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  return null;
}
