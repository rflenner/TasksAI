// Influence lines on an org chart: "from" influences "to" (one direction, shown as a dotted arrow from the influencer to the
// influenced person). Pure: no database, no Salesforce. Stored in Task AI only for now (org_charts.influences).
export type InfluenceTone = "negative" | "neutral" | "positive"; // the kind of influence: red, blue, green when shown in colour
export type OrgInfluence = { id: string; from: string; to: string; strength: 1 | 2 | 3; tone?: InfluenceTone; note: string }; // strength 3 = strong; no tone = follows the influencer's mindset
export type InfluenceEdit =
  | { op: "add"; from: string; to: string; strength?: number; tone?: string; note?: string }
  | { op: "update"; id: string; strength?: number; tone?: string; note?: string }
  | { op: "reverse"; id: string }
  | { op: "remove"; id: string };
export type InfluenceResult = { influences: OrgInfluence[]; id?: string } | { error: string };
export const MAX_INFLUENCES = 500;

const level = (v: unknown): 1 | 2 | 3 => v === 1 || v === 2 || v === 3 ? v : 3;
export const toneOf = (v: unknown): InfluenceTone => v === "negative" || v === "positive" ? v : "neutral";
const hasTone = (v: unknown) => v === "negative" || v === "neutral" || v === "positive";
// The kind of a line: set by hand, else from the mindset of the influencer: Enemy is negative, Champion and Coach are positive.
export const lineTone = (l: { tone?: InfluenceTone }, influencerMindset: string): InfluenceTone => l.tone || (influencerMindset === "Enemy" ? "negative" : influencerMindset === "Champion" || influencerMindset === "Coach" ? "positive" : "neutral");
const note = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 300) : "";

// Keeps only the lines whose two people are still in the chart.
export const keepInfluences = (list: OrgInfluence[], keys: Iterable<string>) => { const have = new Set(keys); return list.filter(l => have.has(l.from) && have.has(l.to)); };

export function applyInfluenceEdit(list: OrgInfluence[], people: Map<string, string>, edit: InfluenceEdit): InfluenceResult {
  const find = (id: unknown) => list.find(l => l.id === id);
  switch (edit.op) {
    case "add": {
      if (!people.has(edit.from) || !people.has(edit.to)) return { error: "That person is not in the chart" };
      if (edit.from === edit.to) return { error: "Nobody can influence themselves" };
      if (list.some(l => l.from === edit.from && l.to === edit.to)) return { error: `${people.get(edit.from)} already influences ${people.get(edit.to)}` };
      if (list.some(l => l.from === edit.to && l.to === edit.from)) return { error: `${people.get(edit.to)} already influences ${people.get(edit.from)}. A line has one direction: reverse that line instead.` };
      if (list.length >= MAX_INFLUENCES) return { error: "This chart has too many influence lines" };
      let id = ""; do id = "in" + Math.random().toString(36).slice(2, 10); while (find(id));
      return { influences: [...list, { id, from: edit.from, to: edit.to, strength: level(edit.strength), ...(hasTone(edit.tone) ? { tone: toneOf(edit.tone) } : {}), note: note(edit.note) }], id };
    }
    case "update": {
      const line = find(edit.id); if (!line) return { error: "That line no longer exists" };
      return { influences: list.map(l => { if (l !== line) return l; const { tone: was, ...rest } = l; const tone = edit.tone === undefined ? was : hasTone(edit.tone) ? toneOf(edit.tone) : undefined; // "auto" or anything else: follow the mindset again
        return { ...rest, ...(tone ? { tone } : {}), strength: edit.strength === undefined ? l.strength : level(edit.strength), note: edit.note === undefined ? l.note : note(edit.note) }; }), id: line.id };
    }
    case "reverse": {
      const line = find(edit.id); if (!line) return { error: "That line no longer exists" };
      if (list.some(l => l.from === line.to && l.to === line.from)) return { error: "The other way round already exists" };
      return { influences: list.map(l => l === line ? { ...l, from: l.to, to: l.from } : l), id: line.id };
    }
    case "remove": {
      if (!find(edit.id)) return { error: "That line no longer exists" };
      return { influences: list.filter(l => l.id !== edit.id) };
    }
    default: return { error: "Unknown change" };
  }
}
