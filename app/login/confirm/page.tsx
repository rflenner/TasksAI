"use client";
import { useEffect, useState } from "react";
import "../../accept/accept.css";
// Deliberately not auto-submitted on load: verification only fires on an
// explicit click here, on our own origin. That's what keeps a link-scanning
// email client (Outlook Safe Links, corporate proxies) from silently
// prefetching this page and burning the one-time code before the person
// ever sees it, and avoids the auto-redirecting-API-URL shape that
// previously triggered Chrome's phishing heuristic on this domain.
export default function ConfirmPage(){
 const[email,setEmail]=useState(""),[code,setCode]=useState(""),[state,setState]=useState<"ready"|"working"|"error">("ready"),[error,setError]=useState("");
 useEffect(()=>{void(async()=>{const params=new URLSearchParams(location.search);setEmail(params.get("email")||"");setCode(params.get("code")||"")})()},[]);
 const signIn=async()=>{if(!email||!code||state==="working")return;setState("working");setError("");const response=await fetch("/api/auth/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,code})});if(response.ok){window.location.href="/";return}setState("error");const data=await response.json().catch(()=>null);setError(data?.error||"That link didn't work — it may have expired or already been used.")};
 return <main className="onboard"><section className="onboard-card"><div className="onboard-logo">Task <b>AI</b></div><p>SECURE SIGN-IN</p>
  {email&&code
   ?<><h1>Sign in as {email}</h1><p>Click below to finish signing in on this device.</p>{error&&<p className="onboard-error">{error}</p>}<button className="onboard-primary" disabled={state==="working"} onClick={signIn}>{state==="working"?"Signing in…":"Sign in to Task AI"}</button><p style={{marginTop:16}}><a href="/login">Request a new link instead</a></p></>
   :<><h1>Link unavailable</h1><p className="onboard-error">This sign-in link is missing information. Request a new one from the sign-in page.</p><p style={{marginTop:16}}><a href="/login">Go to sign-in</a></p></>}
 </section></main>;
}
