# Insights route (`#/insights`)

Source studied: `insights-CIlUgahJ.js`, `insights-CXz-O7fw.css`, shared helpers in `index-Bn4EHT_o.js`, `charts-Co1ox3Rq.js` (line chart + donut).
Behavioral description only — re-implement from scratch.

## 1. Entry point / lifecycle

Exports `page = { title: "Insights", mount(viewEl), enter({ first, same }) }`. No `leave`, no cleanup.

- `mount(el)`: renders the whole page once (header + 5 cards), instantiates the throughput line chart, the custom focus bar chart and the project donut, binds the Range segmented control, wires the card-expand handler, attaches delegated `click` and `pointerover` listeners, subscribes to store topics `tasks`, `focus`, `members`.
- `enter({ first, same })`: ignored when `same`. If data changed while the view was hidden (a "dirty" flag), it first refreshes silently (no animation). Then plays the intro timeline (below).
- Store change while visible → full refresh WITH animation; while hidden → just mark dirty.
- Range (7/30/90 days, default 30) is module memory only (not persisted).

### Intro timeline
- t=0: shared header intro (split-character title rise 0.85s power4.out stagger .022; sub/actions fade-up; stat tiles clip-reveal; numbers count up from 0 over 1.3s, stagger .06).
- t=0.12: all `.card`s clip-reveal (y 30, stagger .06, scale .97→1, inset clip-path opening, 0.9s expo.out; children fade-up after 0.14s).
- t=0.45: line chart draws (clip-rect sweep 1.4s power2.inOut); focus bars grow `scaleY 0→1` from bottom (0.9s power3.out, stagger min(.035, .5/n), delay .05); donut arcs sweep in (1s power3.inOut, each +0.12s, starting .1); workload fills `scaleX 0→1` from left (1s power3.out, delay .1 + i*.04); on-time bar: green part from left (1.1s, delay .15), red part from right (0.8s, delay .7); legend rows / workload rows / slow-task rows / key items fade-up (y 8, stagger .025); in-card `[data-count]` numbers count up.

## 2. Layout

### Header
- Title "Insights"; sub "How the team worked over the last {N days}" (wrapped in `span[data-sub]`, updated on range change).
- Stats (each with optional delta chip `span.delta.delta--{up|down|plain}`, hidden when empty):
  - Completed (int) — delta "+X%" / "−X%" vs previous window; up if ≥.
  - On-time rate (pct) — delta "+N pts" / "−N pts" / "same".
  - Focus hours (int, suffix `h`) — delta ±%.
  - Avg cycle time (format `days` → "2.3d") — delta "−0.4d" (shorter is "up"/good, tone up) or "+0.4d" (tone down).
  - Deltas are blank when there's no earlier history (`hasPrev` false: the earliest doneAt in the store isn't at least half a window before the window start).
- Actions: segmented control "Range" (class `ins-range`, buttons 7D / 30D / 90D, min-width 52px each, centered), then `button.btn.btn--glass[data-act=csv]` with download icon "Export CSV".

### Grid `.insights`
12-column grid, gap `var(--gap)`, named areas:
- Default (>1360px):
  ```
  thru×8  proj×4
  focus×6 work×6
  time×6  work×6
  ```
- ≤1360px: thru×7 / proj×5 on row 1 (rest same).
- ≤1100px: row1 thru×12; row2 proj×6 time×6; row3 focus×12; row4 work×12. Donut card stacks donut above legend.
- ≤860px: single column, order thru, proj, focus, work, time. Donut card goes back to side-by-side (donut auto | legend).
- ≤760px: range control stretches to fill header actions.
- ≤520px: donut card stacked; workload rows become 2 columns with bar on its own second row; bar chart left padding shrinks to 34px; table cell padding 10px.
- Between 1101–1600px the donut card is stacked (donut centered above legend).
All `.insights .card` are flex columns (so bodies can `flex:1`). Each card is the shared `section.card.glass` with `card__head` (h2 title, `card__sub`, `card__tools`).

### Card 1 — Throughput (`#i-thru.ins-thru`, expandable)
- Sub: "Tasks finished each day" (or "each week" for 90D).
- Tools: toggle `button.btn.btn--glass.btn--sm.thru__toggle[aria-pressed][aria-controls=thru-table]` showing list icon + "Table" (when pressed: chart icon + "Chart"; pressed style accent-soft bg / accent-ink text). Plus the shared expand (arrow) icon button.
- `.ins-top` row (space-between, wraps): summary `p.ins-sum` = big number (700 30px display, tabular) + "finished" + delta chip "{+X%} vs previous {N days}" or muted "No earlier history to compare"; legend `ul.ins-key` = solid accent line "Last N days", dashed line "Previous N days" (li hidden when no history).
- `.thru__views` (flex:1, relative): `.thru__chart` (min-height `clamp(220px,17vw,300px)`, 56vh when card focused) and an absolutely-positioned overlay `.thru__table#thru-table` (hidden by default; filled bg, radius 16px, scrollable, overscroll contained). When table shown, the chart gets `visibility:hidden` (class `is-table` on views).
- Table `.itable`: columns Day|Week, Finished, Previous, Change; rows newest first; change chip `delta--up/down` "+n/−n" or muted "–"; sticky header (glass-solid bg) and sticky footer "Total" row (bold) showing totals and the % delta. Without history, Previous/Change cells are muted "–".
- Line chart series: "Last N days" (tone accent, area fill) and, if history, "Previous N days" (tone muted, dashed). Y format integer.

### Card 2 — By project (`#i-proj.ins-proj`)
Sub "Where the finished work went". `.proj` grid `auto | 1fr` (gap 18px): donut (width `clamp(140px,10vw,172px)`) + legend table `.plegend` (sr-only caption/thead): rows `tr.plegend__row.hue--{hue}[data-i]` with 9px rounded colour square, project name (ellipsis), count, share % (muted). Sorted by count desc. Empty: "Nothing finished in this window."
- Donut (shared): 140 viewBox, r=52, track circle + one arc per part (`tone-stroke--{hue}`), 3px gaps between arcs when >1 part, center label = total count + "finished".
- Hovering a legend row dims other arcs to opacity .22 (0.25s) and adds `is-dim` (opacity .45) to other legend rows; hovering elsewhere in the view restores.

### Card 3 — Focus (`#i-focus.ins-focus`)
Sub "Team focus hours each day/week". Summary: big number hours + "hours" + muted "about X.Xh a day|week". Then a custom bar chart (`.hb`, not the shared bars helper):
- Height `clamp(190px,15vw,240px)`, 40px left padding for y labels. Background grid: 3 dashed lines (max, half, 0) with right-aligned labels.
- One column per bucket: track with bar (`.hb__bar`, purple 58% mix, radius 8 8 3 3, min-height 3px), hover tooltip value above bar, x label. Last column `is-hi` (solid purple); hover also solid.
- Labels thinned: only every k-th column (counted from the right end) gets `is-tick` (visible label), k chosen so ≈ one label per 54px; recomputed on resize. Hover reveals any label.
- Hour formatting: ≥10 or 0 → integer "12h"; else one decimal "3.5h". Max = nice-number of (max×1.05).
- Update: bars morph from interpolated previous heights (scaleY tween 0.75s power3.inOut, capped ×8); if bucket count changed, labels fade in.

### Card 4 — Workload (`#i-work.ins-work`)
Sub "Open task hours against weekly capacity". Tools: badge — danger "{n} over" or neutral "All within capacity". Legend: "Open work" (accent bar), "Capacity" (thin vertical tick), "Over capacity" (danger bar).
- `ul.wl` rows `li.wl__row.is-{ok|near|over}[data-key][data-fill]`, grid `minmax(150px,1.1fr) minmax(90px,2fr) 74px`, separators between rows:
  - `a.wl__who` → `#/team/:id` with sm avatar, name, role (name turns accent on hover).
  - `.wl__bar[role=meter]` 10px pill track; fill width = load / scaleMax; capacity tick (2.5px bar, extends 4px above/below) at cap / scaleMax. scaleMax = max(load, cap over all) × 1.04.
  - `.wl__num`: "{load}h" bold + "/ {cap}h" small. Over → number red.
- Load = sum of `est` hours over member's open (non-done, non-history) tasks. Ratio >1 over (danger), ≥.85 near (orange), else ok (accent). Sorted by ratio desc, then load desc.
- On refresh: FLIP rows to new order (y delta, 0.55s power3.inOut) and morph fill width (scaleX from old/new, 0.7s).

### Card 5 — On time (`#i-time.ins-time`)
Sub "Tasks finished in the last N days".
- `.ot__big`: huge percent (700 `clamp(46px,3.4vw,60px)` display, letter-spacing -.04em) + "%" unit (26px muted, tucked -8px) + label "finished on or before the due day".
- `.ot__bar` 14px tall: green pill from left width `calc(rate% − 2px)`, red pill from right `calc((1−rate)% − 2px)` (2px gap center), min-width 6px each. On update the widths morph via scaleX from old width.
- Keys: green dot "{ok} on time", red dot "{late} late".
- "Slowest open tasks" heading (650 13px muted) then up to 3 rows `button.slow__row[data-task]`: assignee avatar sm, title (ellipsis), project chip (`pchip hue--x` with dot) + assignee first name, age block "{N}d" + "late" (red) or "open". Selection: overdue open tasks sorted by due (oldest first), then other open tasks by created (oldest first); N = days overdue (from start of due day) or days since created, min 1. Empty: check icon "No open work / Every task is finished."

## 3. Interactions

- Range segmented control (click / ArrowLeft/Right with wrap; sliding squash-and-stretch pill): sets range and refreshes everything with animation — header sub, stats (count tween 0.9s power3.out + "flash" bump on each `.stat__value`), deltas (text + tone class), card subs/legend labels/table column header, throughput summary, chart `update(series, labels)` (values resampled from old to new length then morphed over 0.9s power3.inOut), table body/foot, focus summary + bars, donut (re-render + replay sweep), legend rows (fade-up y 6 stagger .03), on-time block, slow list, workload.
- Table toggle: current view fades out (opacity 0, y −6, 0.16s power2.in), then swap, other view fades in (y 8 → 0, 0.4s power3.out); when showing table, first 12 body rows fade-up (y 6, stagger .02). Button label/icon swap Table ↔ Chart.
- Export CSV: builds rows for each bucket — header `[Day|Week of, Finished, Previous period, Focus hours, On time, Late]`, each row `[YYYY-MM-DD bucket start, finished, previous, focus hours (1 decimal), on-time count, late count]`; CSV-escapes fields containing quotes/commas/newlines; downloads `pane-insights-{7|30|90}d.csv` via Blob + temporary anchor; toast "Exported the last N days" (download icon).
- Slow task row click → opens shared task drawer.
- Workload name link → team member detail route.
- Expand on Throughput → shared FLIP focus overlay (scrim, card scales to focus mode, dispatches `card:resize` so chart redraws).
- Line chart: hover crosshair + dots + tooltip (bucket label, each series value); keyboard arrows when focused.

## 4. Data / computations

No route-specific persistence. Uses store (`pane:v1`) — tasks (incl. ~92 days of synthetic done "history" tasks with `order: 1000`, which ARE counted here), focus sessions, members.

Window builder for range R:
- R=7 or 30: R daily buckets; R=90: 13 weekly buckets (7-day size). Window ends at start of tomorrow; start = end − buckets×size. Labels: 7D → weekday short ("Mon"), else "Oct 3".
- Previous window = same length immediately before.
- `done` = tasks with `doneAt` in window (any assignee); `prev` likewise.
- On time = doneAt's day ≤ due's day. rate = onTime/done.
- Focus hours = sum of focus session minutes in window / 60 (rounded); per-bucket hours unrounded.
- Cycle time = mean (doneAt − created) in days.
- Percent change = round((cur − prev)/prev × 100), 0 if prev is 0.
- Per-project counts from `done` grouped by projectId (only existing projects).
- Focus session shape: `{ id, at, minutes (25|50|90…), who, taskId? }`; seed has 0–3 per member per weekday for 92 days.
- Member `capacity` hours/week (28–36).

## 5. Notable CSS

- `.ins-sum b` 700 30px display. `.key-line` 20px × 2.6px accent line; dashed variant 2px `--text-3`.
- `.itable` right-aligned numeric cells, first column left; sticky thead/tfoot on `--glass-solid`.
- `.plegend th` takes full width with `max-width:0` trick for ellipsis; colour square absolutely positioned.
- `.hb__bar` purple-based (`color-mix(var(--purple) 58%)`), solid purple on hover/last.
- `.wl__fill` accent-ink / orange (near) / danger (over); `.wl__cap` uses `--text` color.
- `.badge--danger` danger 16% bg + danger text.
- `.ot__on` green, `.ot__late` danger.
- `[data-view="insights"] .delta:empty` hidden; hidden legend li hidden.
- Coarse pointer: toggle 44px tall, workload name link min-height 44px.
