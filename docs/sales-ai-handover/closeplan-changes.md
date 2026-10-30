# Close Plan changes a Sales AI port must copy

Newest first. The Task AI chat adds a line here whenever it changes what users see or how it behaves on `prototype/close-plan-demo.html`. The Sales AI port chat reads this file first, then `closeplan-design-spec.md`. Mark a line "ported" (with the Sales AI commit) once it is done.

| Date | Task AI PR | What to copy | Spec section | Ported in Sales AI |
|---|---|---|---|---|
| 2026-10-30 | #264 | Add-task row without blue frame; people fields as a plain box with ▾, "None selected", × on hover; timeline phase cards with completion bar, "x/y closed" and state colour | 2, 3.2, 3.4, 3.6 | Done by the Task AI chat, uncommitted in the closePlan folder; also phase header, searchable dropdowns |
| 2026-10-30 | #254 | A task pulled from Salesforce is credited to its creator; a checkpoint with no deadline stays without a due date | 4 | Backend sync: check |
| 2026-10-27 | #255 | Progress chart: milestone diamonds (green / purple / yellow within 7 days / red missed), names beside the diamonds on the large chart, dotted lines for signature and go-live, axis ends at the last milestone, legend and footnote behind an (i) | 3.7 | Not started |
| 2026-10-22 | #220, #221 | Progress tile: percentage, small chart, Current progress and Forecasted signature boxes, details toggle (iSEEit only) | 3.7 | Not started |
| 2026-10-21 | #207, #211 | Notification rules box and collapsed Task history; remove a status update | 3.5 | Present in Sales AI, verify |
| 2026-10-20 | #203, #204 | PDF attachments with viewer; activity log and "Last seen" | 3.5, 3.8 | Attachments missing; activity present, verify |
| 2026-10-20 | #201 | Definable roles and plan titles in the sidebar | 3.8 | Present, verify |
| 2026-10-25 | org chart commits | Read-only org chart preview from Salesforce, task counts, photos, LinkedIn | 5 | Not started |

Earlier history: `git -C /Applications/Closeplan log --format='%h %ad %s' --date=short -- prototype/close-plan-demo.html`.
