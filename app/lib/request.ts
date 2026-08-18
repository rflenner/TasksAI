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

export function requireSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  if (!origin || origin !== publicRequestOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  return null;
}
