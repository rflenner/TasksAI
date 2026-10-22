import { NextResponse, type NextRequest } from "next/server";
import { customerHostRedirect } from "./app/lib/close-plan-host";

// Keeps the customer address (CLOSEPLAN_URL) to Close Plan's customer pages; everything else goes to the main
// address (app/lib/close-plan-host.ts). The host comes from the proxy headers Render sets, like publicRequestOrigin.
export function proxy(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  const target = customerHostRedirect({ host, pathname: request.nextUrl.pathname, search: request.nextUrl.search, customerUrl: process.env.CLOSEPLAN_URL, appUrl: process.env.APP_URL });
  // 307 keeps the method and isn't cached for good, so the split can still change.
  return target ? NextResponse.redirect(target, 307) : NextResponse.next();
}
