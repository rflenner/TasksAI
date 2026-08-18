import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { loginTokens, users } from "../../../../db/schema";
import { safeReturnTo, sha256 } from "../../../lib/security";
import { createSession, setSessionCookie } from "../../../lib/session";
import { publicRequestUrl } from "../../../lib/request";
export async function GET(request:Request){const url=new URL(request.url),token=url.searchParams.get("token");if(!token)return Response.redirect(publicRequestUrl(request,"/login?error=invalid"));const result=await getDb().transaction(async tx=>{const[row]=await tx.select({tokenHash:loginTokens.tokenHash,userId:loginTokens.userId}).from(loginTokens).innerJoin(users,eq(users.id,loginTokens.userId)).where(and(eq(loginTokens.tokenHash,sha256(token)),gt(loginTokens.expiresAt,new Date()),isNull(loginTokens.usedAt),eq(users.status,"active"))).limit(1);if(!row)return null;const[used]=await tx.update(loginTokens).set({usedAt:new Date()}).where(and(eq(loginTokens.tokenHash,row.tokenHash),isNull(loginTokens.usedAt))).returning();return used?row:null});if(!result)return Response.redirect(publicRequestUrl(request,"/login?error=invalid"));const session=await createSession(result.userId);await setSessionCookie(session.value,session.expiresAt);return Response.redirect(publicRequestUrl(request,safeReturnTo(url.searchParams.get("returnTo"))))}
