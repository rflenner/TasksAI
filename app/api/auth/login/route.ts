import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { loginTokens, users } from "../../../../db/schema";
import { renderLoginEmail, sendWithResend } from "../../../lib/email";
import { publicRequestUrl, requireSameOrigin } from "../../../lib/request";
import { randomLoginCode, sha256 } from "../../../lib/security";
export async function POST(request:Request){const invalid=requireSameOrigin(request);if(invalid)return invalid;const email=String((await request.json()).email||"").trim().toLowerCase();const[user]=await getDb().select().from(users).where(and(eq(users.email,email),eq(users.status,"active"))).limit(1);if(user){const code=randomLoginCode(),tokenHash=sha256(code);await getDb().insert(loginTokens).values({tokenHash,userId:user.id,expiresAt:new Date(Date.now()+15*60000)});const link=publicRequestUrl(request,"/login/confirm");link.searchParams.set("email",user.email);link.searchParams.set("code",code);const message=renderLoginEmail({name:user.name,code,link:link.toString()});await sendWithResend({...message,to:user.email,idempotencyKey:`login-${tokenHash.slice(0,24)}`})}return Response.json({message:"If that invited account is active, a sign-in link has been sent."})}
