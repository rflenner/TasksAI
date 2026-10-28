import assert from "node:assert/strict";
import test from "node:test";
import { applyOrgEdit } from "../app/lib/org-chart-edit";
import { domainOf, parseProfile, sameCompany, splitName, standing, suggestFor } from "../app/lib/org-chart-linkedin";

// Fictional data only — this repository is public.
const profile = (jobs: Array<[string, string, boolean]>) => parseProfile({ full_name: "Ana Lopez", public_identifier: "analopez", experiences: jobs.map(([company, title, current]) => ({ company, title, starts_at: { year: 2020, month: 1 }, ends_at: current ? null : { year: 2023, month: 5 } })) })!;
const node = (over = {}) => ({ key: "003000000000001AAA", name: "Ana Lopez", title: "Head of Ops", linkedin: "", left: false, ...over });

test("company names match across legal suffixes and case", () => {
  assert.ok(sameCompany("Acme Pharma Inc.", "ACME PHARMA"));
  assert.ok(sameCompany("Acme", "Acme Pharma GmbH"));
  assert.ok(!sameCompany("Acme Pharma", "Zenith Pharma"));
  assert.ok(!sameCompany("", "Acme"));
});

test("standing: current, left, unknown", () => {
  assert.equal(standing(profile([["Acme Pharma", "COO", true]]), "Acme Pharma Inc").status, "current");
  const left = standing(profile([["Zenith", "VP", true], ["Acme Pharma", "COO", false]]), "Acme Pharma");
  assert.equal(left.status, "left"); assert.equal(left.company, "Zenith");
  assert.equal(standing(profile([]), "Acme Pharma").status, "unknown");
});

test("suggestions: left, back, title", () => {
  const away = profile([["Zenith", "VP", true], ["Acme Pharma", "COO", false]]);
  assert.deepEqual(suggestFor(node(), away, "Acme Pharma").map(s => s.kind), ["left"]);
  assert.deepEqual(suggestFor(node({ left: true }), away, "Acme Pharma").map(s => s.kind), []);
  const here = profile([["Acme Pharma", "Chief Operating Officer", true]]);
  assert.deepEqual(suggestFor(node({ left: true }), here, "Acme Pharma").map(s => s.kind), ["back", "title"]);
  assert.deepEqual(suggestFor(node({ title: "chief operating officer" }), here, "Acme Pharma").map(s => s.kind), []);
  assert.deepEqual(suggestFor(node(), profile([]), "Acme Pharma"), []);
});

test("names and domains", () => {
  assert.deepEqual(splitName("Ana Maria Lopez (Acme)"), { first: "Ana Maria", last: "Lopez" });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
  assert.equal(domainOf("https://www.acme.example/about"), "acme.example");
  assert.equal(domainOf("acme.example"), "acme.example");
  assert.equal(domainOf(null), "");
});

test("edits: left flag, profile link and adding a found person", () => {
  const base = { nodes: [], roots: [], issues: [] } as never;
  const added = applyOrgEdit(base, { op: "add", name: "Ana Lopez", title: "COO", parentKey: null, linkedin: "linkedin.com/in/analopez" });
  assert.ok(!("error" in added));
  const chart = (added as { chart: { nodes: Array<{ key: string; linkedin: string; left: boolean }> } }).chart;
  assert.equal(chart.nodes[0].linkedin, "https://linkedin.com/in/analopez");
  const next = applyOrgEdit(chart as never, { op: "update", key: chart.nodes[0].key, left: true, linkedin: "https://example.com/x" });
  assert.equal((next as { chart: typeof chart }).chart.nodes[0].left, true);
  assert.equal((next as { chart: typeof chart }).chart.nodes[0].linkedin, "");
});

test("a person added from LinkedIn keeps only a picture hosted by Enrich Layer or LinkedIn", () => {
  const base = { nodes: [], roots: [], issues: [] } as never;
  const add = (photoUrl: string) => (applyOrgEdit(base, { op: "add", name: "Ana Lopez", parentKey: null, photoUrl }) as { chart: { nodes: Array<{ photoUrl?: string }> } }).chart.nodes[0].photoUrl;
  assert.equal(add("https://assets.enrichlayer.com/pp/profilepic/abc"), "https://assets.enrichlayer.com/pp/profilepic/abc");
  assert.equal(add("https://media.licdn.com/dms/image/x"), "https://media.licdn.com/dms/image/x");
  assert.equal(add("https://evil.example/x.png"), "");
  assert.equal(add("http://assets.enrichlayer.com/x"), "");
});
