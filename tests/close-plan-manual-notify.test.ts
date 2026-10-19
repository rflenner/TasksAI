import assert from "node:assert/strict";
import test from "node:test";
import { renderTaskNote } from "../app/lib/close-plan-emails";
import { peopleOnTask } from "../app/lib/close-plan-manual-notify";

const data = {
  people: [{ id: "a", name: "Anna", side: "seller" }, { id: "b", name: "Ben", side: "buyer" }, { id: "c", name: "Cara", side: "seller" }, { id: "d", name: "Dan", side: "buyer" }],
  tasks: [{ id: "t1", title: "Sign off scope", owner: "b", coworkers: ["a", "b"], recipients: ["c", "a", "ghost"] }, { id: "t2", title: "Other", owner: "d" }],
};

test("the people on a task are its owner, coworkers and requesters, once each, in that order", () => {
  assert.deepEqual(peopleOnTask(data, "t1").map(x => [x.person.id, x.role]), [["b", "Owner"], ["a", "Coworker"], ["c", "Requested by"]]);
  assert.deepEqual(peopleOnTask(data, "t2").map(x => x.person.id), ["d"]);
  assert.deepEqual(peopleOnTask(data, "nope"), []);
});

test("the note email carries the sender's own words (escaped, line breaks kept), the task and a way into the plan", () => {
  const m = renderTaskNote({ firstName: "Ben", fromName: "Rizan <b>", planTitle: "Acme", message: "Can you update this?\nThanks <script>", task: { title: "Sign off scope", due: "2026-10-30", status: "In progress" }, url: "https://x.test/p/abc", unsubscribeUrl: "https://x.test/unsubscribe/t" });
  assert.match(m.subject, /sent you a note on “Sign off scope”/);
  assert.ok(m.html.includes("Can you update this?<br>Thanks &lt;script&gt;"));
  assert.ok(!m.html.includes("<script>") && !m.html.includes("Rizan <b>"));
  assert.ok(m.html.includes("https://x.test/p/abc") && m.html.includes("iseeit-logo.png"));
  assert.match(m.text, /Can you update this\?\nThanks <script>/);
});
