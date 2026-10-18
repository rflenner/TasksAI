import { addOptOut, emailFromUnsubscribeToken, isOptedOut } from "../../lib/close-plan-notify-rules";

export const dynamic = "force-dynamic";

// The unsubscribe link in every Close Plan email. Opening it only shows the page; the button does the opting out, so link
// previews and mail scanners can't unsubscribe anyone by accident.
async function stop(formData: FormData) {
  "use server";
  const email = emailFromUnsubscribeToken(String(formData.get("token") || ""));
  if (email) await addOptOut(email, "self", null, null);
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const email = emailFromUnsubscribeToken(token);
  const done = email ? await isOptedOut(email) : false;
  return (
    <div className="max-w-md mx-auto p-8 mt-16 text-center">
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">CLOSE PLAN</div>
      {!email ? <h1 className="text-xl font-bold text-[#102f59] mt-2">This link isn&apos;t valid</h1> : done ? (
        <><h1 className="text-xl font-bold text-[#102f59] mt-2">You won&apos;t get Close Plan emails any more</h1><p className="text-[#697181] mt-3">{email} is excluded. You can still open your plan with your personal link.</p></>
      ) : (
        <><h1 className="text-xl font-bold text-[#102f59] mt-2">Stop Close Plan emails?</h1><p className="text-[#697181] mt-3">We won&apos;t email {email} about close plans any more. You can still open your plan with your personal link.</p>
          <form action={stop} className="mt-5"><input type="hidden" name="token" value={token} /><button type="submit" className="bg-[#173f76] text-white font-semibold rounded-lg px-5 py-2">Stop emails</button></form></>
      )}
    </div>
  );
}
