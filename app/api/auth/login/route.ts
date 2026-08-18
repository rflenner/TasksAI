import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { createSession, setSessionCookie } from "../../../lib/session";
export async function POST(request:Request){const invalid=requireSameOrigin(request);if(invalid)return invalid;const email=String((await request.json()).email||"").trim().toLowerCase();const[user]=await getDb().select().from(users).where(and(eq(users.email,email),eq(users.status,"active"))).limit(1);if(!user)return Response.json({error:"No active account found for that email address"},{status:404});const session=await createSession(user.id);await setSessionCookie(session.value,session.expiresAt);return Response.json({user:{id:user.id,name:user.name,email:user.email}})}
