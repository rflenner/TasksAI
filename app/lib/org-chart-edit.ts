import type { OrgChart, OrgNode } from "./close-plan-orgchart";

// Edits to an org chart copy in Task AI (Phase 3). Pure: no database, no Salesforce. Nothing here is sent to Salesforce.
// Every edit returns a new chart, or an error text; a move that would make someone their own boss (directly or through the
// chain above them) is refused, which Salesforce itself does not check.
export const ORG_TYPES = ["Champion", "Coach", "Enemy", "Influencer", "Neutral"] as const;
export const MAX_PEOPLE = 2000;

export type OrgEdit =
  | { op: "move"; key: string; parentKey: string | null; index?: number }
  | { op: "shift"; key: string; by: -1 | 1 }
  | { op: "update"; key: string; type?: string; dealRole?: string; powerBase?: boolean; description?: string; title?: string }
  | { op: "add"; name: string; title?: string; parentKey: string | null }
  | { op: "remove"; key: string };
export type EditResult = { chart: OrgChart; key?: string } | { error: string };

const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

// Renumber every group of siblings 0, 1, 2… in their current order and recompute the top level.
export function normalizeOrgChart(chart: OrgChart): OrgChart {
  const groups = new Map<string | null, OrgNode[]>();
  for (const n of chart.nodes) groups.set(n.parentKey, [...(groups.get(n.parentKey) || []), n]);
  const nodes: OrgNode[] = [];
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order).forEach((n, i) => nodes.push({ ...n, order: i }));
  nodes.sort((a, b) => a.order - b.order);
  const roots = nodes.filter(n => !n.parentKey).map(n => n.key);
  return { ...chart, nodes, roots };
}

function isUnder(chart: OrgChart, key: string, ancestor: string) {
  const parent = new Map(chart.nodes.map(n => [n.key, n.parentKey]));
  for (let at = parent.get(key) ?? null, hops = 0; at && hops <= chart.nodes.length; at = parent.get(at) ?? null, hops++) if (at === ancestor) return true;
  return false;
}

const siblings = (chart: OrgChart, parentKey: string | null) => chart.nodes.filter(n => n.parentKey === parentKey).sort((a, b) => a.order - b.order);

function place(chart: OrgChart, key: string, parentKey: string | null, index?: number): OrgChart {
  const rest = siblings(chart, parentKey).filter(n => n.key !== key).map(n => n.key);
  rest.splice(index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length)), 0, key);
  const order = new Map(rest.map((k, i) => [k, i]));
  return normalizeOrgChart({ ...chart, nodes: chart.nodes.map(n => n.key === key ? { ...n, parentKey, order: order.get(key)! } : n.parentKey === parentKey && order.has(n.key) ? { ...n, order: order.get(n.key)! } : n) });
}

export function applyOrgEdit(chart: OrgChart, edit: OrgEdit): EditResult {
  const find = (key: unknown) => typeof key === "string" ? chart.nodes.find(n => n.key === key) : undefined;
  switch (edit.op) {
    case "move": {
      const node = find(edit.key);
      if (!node) return { error: "That person is not in the chart" };
      const parentKey = edit.parentKey || null;
      if (parentKey) {
        if (!find(parentKey)) return { error: "That manager is not in the chart" };
        if (parentKey === node.key) return { error: "Nobody can report to themselves" };
        if (isUnder(chart, parentKey, node.key)) return { error: `${find(parentKey)!.name} reports to ${node.name}, so ${node.name} cannot report to them. That would make a loop.` };
      }
      return { chart: place(chart, node.key, parentKey, typeof edit.index === "number" ? edit.index : undefined), key: node.key };
    }
    case "shift": {
      const node = find(edit.key);
      if (!node) return { error: "That person is not in the chart" };
      const at = siblings(chart, node.parentKey).findIndex(n => n.key === node.key), to = at + (edit.by < 0 ? -1 : 1);
      if (to < 0 || to >= siblings(chart, node.parentKey).length) return { chart, key: node.key };
      return { chart: place(chart, node.key, node.parentKey, to), key: node.key };
    }
    case "update": {
      const node = find(edit.key);
      if (!node) return { error: "That person is not in the chart" };
      if (edit.type !== undefined && !(ORG_TYPES as readonly string[]).includes(edit.type)) return { error: "Unknown type" };
      const next: OrgNode = { ...node };
      if (edit.type !== undefined) next.type = edit.type;
      if (edit.dealRole !== undefined) next.dealRole = text(edit.dealRole, 80);
      if (edit.powerBase !== undefined) next.powerBase = Boolean(edit.powerBase);
      if (edit.description !== undefined) next.description = typeof edit.description === "string" ? edit.description.slice(0, 2000) : "";
      if (edit.title !== undefined) next.title = text(edit.title, 120);
      return { chart: { ...chart, nodes: chart.nodes.map(n => n.key === node.key ? next : n) }, key: node.key };
    }
    case "add": {
      const name = text(edit.name, 80);
      if (!name) return { error: "Give the person a name" };
      if (chart.nodes.length >= MAX_PEOPLE) return { error: "This chart is full" };
      const parentKey = edit.parentKey || null;
      if (parentKey && !find(parentKey)) return { error: "That manager is not in the chart" };
      let key = "";
      do key = "tmp" + Math.random().toString(36).slice(2, 12); while (find(key));
      const node: OrgNode = { key, roleId: "", name, title: text(edit.title, 120), email: "", phone: "", description: "", provisional: true, type: "Neutral", dealRole: "", powerBase: false, parentKey, order: siblings(chart, parentKey).length, linkedin: "", left: false, openTasks: 0, photo: "" };
      return { chart: normalizeOrgChart({ ...chart, nodes: [...chart.nodes, node] }), key };
    }
    case "remove": {
      const node = find(edit.key);
      if (!node) return { error: "That person is not in the chart" };
      // The people who reported to them move up to their manager, at the place the person had.
      const at = siblings(chart, node.parentKey).findIndex(n => n.key === node.key);
      const team = siblings(chart, node.key).map(n => n.key);
      let next: OrgChart = { ...chart, nodes: chart.nodes.filter(n => n.key !== node.key) };
      team.forEach((k, i) => { next = place(next, k, node.parentKey, at + i); });
      return { chart: normalizeOrgChart(next) };
    }
    default: return { error: "Unknown edit" };
  }
}
