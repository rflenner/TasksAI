"use client";
import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import "../accept/accept.css";
export default function LoginClient({ initialError }: { initialError: string }){
 const[email,setEmail]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<"start"|"email"|"code">("start"),[state,setState]=useState<"ready"|"working">("ready"),[error,setError]=useState(initialError);
 // Whether this browser supports passkeys is a browser-capability check
 // (window.PublicKeyCredential) that the server has no way to know —
 // unlike initialError above, there's no server-side equivalent to read.
 // Rendering it straight in the body would mismatch between the server's
 // render (no window) and the client's first paint (real capability),
 // triggering a hydration error. Starting false and flipping it after
 // mount keeps the first paint identical on both sides; the button then
 // appears a moment later once React knows it's safe to show it.
 const[supportsPasskeys,setSupportsPasskeys]=useState(false);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time browser-capability read after mount, not a state sync; see the comment above.
 useEffect(()=>{setSupportsPasskeys(browserSupportsWebAuthn())},[]);
 const requestCode=async()=>{if(!email.includes("@")||state==="working")return;setState("working");setError("");const response=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});setState("ready");if(response.ok)setStep("code");else{const data=await response.json();setError(data.error||"Could not send the sign-in link")}};
 const verifyCode=async()=>{if(!code.trim()||state==="working")return;setState("working");setError("");const response=await fetch("/api/auth/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,code})});if(response.ok){window.location.href="/"}else{setState("ready");const data=await response.json();setError(data.error||"That code didn't work")}};
 const signInWithPasskey=async()=>{
  if(state==="working")return;setState("working");setError("");
  try{
   const optionsRes=await fetch("/api/auth/passkey/login-options",{method:"POST"});
   const optionsJSON=await optionsRes.json() as PublicKeyCredentialRequestOptionsJSON&{error?:string};
   if(!optionsRes.ok){setError(optionsJSON.error||"Passkey sign-in isn't available right now");setState("ready");return}
   const response=await startAuthentication({optionsJSON});
   const verifyRes=await fetch("/api/auth/passkey/login-verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(response)});
   if(verifyRes.ok){window.location.href="/";return}
   const data=await verifyRes.json().catch(()=>({})) as {error?:string};
   setError(data.error||"That passkey didn't work");setState("ready");
  }catch(err){
   setError(err instanceof DOMException&&err.name==="NotAllowedError"?"Cancelled.":"That passkey didn't work on this device.");
   setState("ready");
  }
 };
 return <main className="onboard"><section className="onboard-card"><div className="onboard-logo">Task <b>AI</b></div><p>SECURE SIGN-IN</p><h1>Welcome back</h1>
  {step==="start"
   ?<div className="onboard-form">
     {error&&<p className="onboard-error">{error}</p>}
     {supportsPasskeys&&<button className="onboard-primary" disabled={state==="working"} onClick={()=>void signInWithPasskey()}>{state==="working"?"Waiting for your device…":"🔒 Sign in with a passkey"}</button>}
     <div className="onboard-divider">or</div>
     <a className="onboard-secondary" href="/api/auth/google/start">Continue with Google</a>
     <button type="button" style={{background:"none",border:0,color:"#697181",cursor:"pointer",font:"inherit",padding:0,textAlign:"center"}} onClick={()=>{setStep("email");setError("")}}>Use email instead</button>
    </div>
   :step==="email"
   ?<><p>Enter the email address connected to your Task AI invitation.</p><div className="onboard-form"><label className="onboard-field"><span>Email address</span><input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void requestCode()}} placeholder="you@company.com"/></label>{error&&<p className="onboard-error">{error}</p>}<button className="onboard-primary" disabled={state==="working"||!email.includes("@")} onClick={requestCode}>{state==="working"?"Sending link…":"Email me a sign-in link"}</button><button style={{background:"none",border:0,color:"#697181",cursor:"pointer",font:"inherit",padding:0,textAlign:"left"}} type="button" onClick={()=>{setStep("start");setError("")}}>← Back</button></div></>
   :<><p>Check <b>{email}</b> and click the sign-in link — fastest on the device where you opened the email. On a different device, enter the 8-character code from that same email instead.</p><div className="onboard-form"><label className="onboard-field"><span>Sign-in code</span><input value={code} onChange={event=>setCode(event.target.value.toUpperCase())} onKeyDown={event=>{if(event.key==="Enter")void verifyCode()}} placeholder="ABCD2345" maxLength={8}/></label>{error&&<p className="onboard-error">{error}</p>}<button className="onboard-primary" disabled={state==="working"||!code.trim()} onClick={verifyCode}>{state==="working"?"Signing in…":"Sign in with code"}</button><button style={{background:"none",border:0,color:"#697181",cursor:"pointer",font:"inherit",padding:0,textAlign:"left"}} type="button" onClick={()=>{setStep("email");setCode("");setError("")}}>← Use a different email</button></div></>}
 </section></main>;
}
