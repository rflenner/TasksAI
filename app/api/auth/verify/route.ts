import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { loginTokens, users } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { sha256 } from "../../../lib/security";
import { createSession, setSessionCookie } from "../../../lib/session";
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const input=await request.json() as {email?:string;code?:string};
 const email=String(input.email||"").trim().toLowerCase(),code=String(input.code||"").trim().toUpperCase().replace(/\s+/g,"");
 if(!email||!code)return Response.json({error:"Enter the code from your email"},{status:400});
 const[user]=await getDb().select().from(users).where(and(eq(users.email,email),eq(users.status,"active"))).limit(1);
 if(!user)return Response.json({error:"That code is invalid or has expired"},{status:400});
 const result=await getDb().transaction(async tx=>{
  const[row]=await tx.select({tokenHash:loginTokens.tokenHash}).from(loginTokens).where(and(eq(loginTokens.tokenHash,sha256(code)),eq(loginTokens.userId,user.id),gt(loginTokens.expiresAt,new Date()),isNull(loginTokens.usedAt))).limit(1);
  if(!row)return null;
  const[used]=await tx.update(loginTokens).set({usedAt:new Date()}).where(and(eq(loginTokens.tokenHash,row.tokenHash),isNull(loginTokens.usedAt))).returning();
  return used?row:null;
 });
 if(!result)return Response.json({error:"That code is invalid or has expired"},{status:400});
 const session=await createSession(user.id);await setSessionCookie(session.value,session.expiresAt);
 return Response.json({user:{id:user.id,name:user.name,email:user.email}});
}
