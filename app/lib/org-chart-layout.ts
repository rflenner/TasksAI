import type { OrgNode } from "./close-plan-orgchart";

// How a manager's team is drawn: side by side in a row under them, or as a "ladder" (a vertical list hanging off a line under
// the manager) which takes far less width. Rules, applied per manager so one chart mixes both:
//  1. 3 or more people who all have no team of their own hang as a ladder.
//  2. Anything else stays a row (1 or 2 people, or a team where someone leads a team).
//  3. From level 4 down (the team members are on level 4 or deeper) the team hangs as a ladder even when someone leads a team;
//     their teams hang one step further in.
//  4. A row of more than 6 people where some lead a team keeps the managers in the row and hangs the people without a team
//     together as a ladder under a "people without a team" label.
//  5. A manager can be set to Row or Ladder by hand (`layout` on the person), which beats rules 1 to 4.
export const LADDER_MIN = 3;
export const DEEP_FROM_LEVEL = 4;
export const WIDE_OVER = 6;
export type TeamLayout = "row" | "ladder";
export type TeamPlan = { layout: TeamLayout; row: OrgNode[]; ladder: OrgNode[] };

// `level` is the manager's own level in the chart: top level = 1.
// `force` is the choice for the whole chart ("all rows" / "all hanging"); a person set to Row or Ladder by hand still wins.
export function planTeam(node: OrgNode, level: number, kidsOf: (key: string) => OrgNode[], force?: TeamLayout): TeamPlan {
  const team = kidsOf(node.key);
  if (!node.layout || node.layout === "auto") { if (force === "ladder") return { layout: "ladder", row: [], ladder: team }; if (force === "row") return { layout: "row", row: team, ladder: [] }; }
  if (node.layout === "ladder") return { layout: "ladder", row: [], ladder: team };
  if (node.layout === "row") return { layout: "row", row: team, ladder: [] };
  const leaders = team.filter(k => kidsOf(k.key).length), leaves = team.filter(k => !kidsOf(k.key).length);
  if (!team.length) return { layout: "row", row: [], ladder: [] };
  if (level + 1 >= DEEP_FROM_LEVEL || (team.length >= LADDER_MIN && !leaders.length)) return { layout: "ladder", row: [], ladder: team };
  if (team.length > WIDE_OVER && leaders.length && leaves.length >= LADDER_MIN) return { layout: "row", row: leaders, ladder: leaves };
  return { layout: "row", row: team, ladder: [] };
}
