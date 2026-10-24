# Projects route (`#/projects`, `#/projects/:id`)

Source studied: `projects-JFvZiAtG.js`, `projects-CT-pujy7.css`, shared helpers in `index-Bn4EHT_o.js`, `charts-Co1ox3Rq.js` (line chart).
Behavioral description only — re-implement from scratch.

## 1. Entry point / lifecycle

The module exports a single `page` object consumed by the router (the router lazy-loads the chunk, caches the page object per route name, and calls `mount` once):

- `title(params)` → `"Projects"` when no param; otherwise the project's name, or `"Project not found"`. Router sets `document.title = "<title> · Pane"` and a compact toolbar title.
- `mount(viewEl)` — called once with the `[data-view="projects"]` container. Stores the root, installs ONE delegated click listener on the root, subscribes to store topics (`projects`, `tasks`, `events`, `activity`, `members`), and wires the shared "card expand" handler (clicking any `[data-expand]` button inside a `.card` puts that card into a FLIP "focus" overlay mode with a scrim).
- `enter({ params, first, same })` — called every navigation into the route. `same` is true when the route was already active and only the hash param changed (list ↔ detail ↔ other detail). No `leave`, no cleanup function returned (subscriptions live forever; handlers are no-ops while the view is `hidden`).

Internal state: current mode (`list` | `detail` | `missing`), current project id, list filter (`all` default, persists in module memory across visits, not storage), segmented control handle, burn-up chart handle, "show done tasks" toggle (module memory), and a navigation token to drop stale transitions.

### Mode switching / transitions
- Mode is derived from `params[0]`: none → `list`; known id → `detail`; unknown → `missing`. If `same` and nothing changed, do nothing.
- Direction: when switching within the route, `-1` going to list, `+1` going to detail; 0 on a fresh enter.
- Outgoing (only when `same` and motion allowed): header lead/actions fade to 0 and slide `x: -dir*18` (0.18s, power2.in); visible `.glass`/`.stat` elements slide `x: -dir*26` (0.2s) while a "clip-out" helper shrinks them (inset clip-path to 10%, scale .97, y -6, 0.2s power2.in). Then re-render, `scrollTo(0)`, focus the `h1` (preventScroll).
- Render keeps the existing `h1.head__title` DOM node (swaps its text in) so the router's title split-text animation doesn't restart.
- Incoming timeline: header intro (split-letter title rise, sub/actions fade-up, stats "clip-reveal" + count-up) at t=0; cards "clip-reveal" (y 18 if directional else 28, stagger .05) at t=0.1. If directional, cards also slide from `x: dir*44` → 0 (0.75s expo.out, stagger .05) and the header lead from `x: dir*24` (0.7s expo.out).
- Then a "secondary" pass at +0.4s: list mode animates every visible card's progress ring from 0 to value (delay 0.4 + i*0.06) and counts up numbers inside each card. Detail mode plays the burn-up chart draw (+0.1), and (if motion allowed) after 0.4s: timeline fill `scaleX 0→1` (1.1s power3.out), milestone dots pop in (scale .2→1, back.out(3), stagger .07, delay .25), the "Today" marker grows `scaleY 0→1` from bottom (0.6s, delay .55, back.out(2.4)), and list items (`.ms__item, .ov__people li, .pgroup, .pev, feed li`) fade-up (y 10, stagger .025).

Reduced-motion: every duration goes through a scaler that returns 0 when `prefers-reduced-motion: reduce`; many effects are skipped entirely.

## 2. Layout

### Shared page header (helper `pageHead`)
`<header class="head">` containing:
- `.head__lead` → optional back link (`a.ibtn.ibtn--glass.head__back.magnetic`, chevron-left icon) + `.head__text` (`h1.head__title[tabindex=-1]`, optional `p.head__sub`).
- `.head__actions` (optional HTML).
- `dl.head__stats` of `.stat[data-stat=key]` items: `dt.stat__label` + `dd.stat__value > b[data-count][data-fmt]` (formats: int, pct, pct1, hours, days).

### List view
- Header: title "Projects", sub "`{inFlight} in flight · {shipped} shipped`".
  Stats: Active (active+review count), Shipped (done count), On track (pct — share of live projects whose task-completion ≥ elapsed-time fraction), Due this month (non-done projects due in current calendar month).
  Actions: segmented control (aria-label "Show", class `pfilter`) with options All / Active / Planning / Shipped (`all|active|planning|done`; "active" matches status active OR review), then `button.btn.btn--accent[data-act=new]` with plus icon "New project".
- `div.pgrid` — CSS grid `repeat(auto-fill, minmax(min(100%, 330px), 1fr))`, gap `var(--gap)`, `align-items:start`.
- Sort: status order active, review, planning, done; then by due ascending.
- Each project: `article.pcard.glass.hue--{hue}[data-key=id][data-sig=…][data-lift]`, `hidden` when it fails the filter.
  - `.pcard__top`: project icon tile (`picon picon--lg hue--x` with SVG icon), `.pcard__id` (h3 `.pcard__name` containing `a.pcard__link` to `#/projects/:id` — its `::after` covers the whole card making it clickable; status pill `.pstatus--{status}`), and a pin/star icon button (`.ibtn.ibtn--sm.pstar[data-star][aria-pressed]`, title "Pinned"/"Pin to sidebar").
  - `p.pcard__sum` summary (2-line clamp, min-height 2.9em).
  - `.pcard__mid` (filled rounded 20px row): progress ring + `.pcard__next` block: "Next milestone" / title / "`Mon D · in N days`" (relative: today/tomorrow/yesterday/in N days/N days ago). Done project: "Shipped / Every milestone met / date". No milestones: "Next milestone / None planned yet / Due date".
  - `footer.pcard__foot`: avatar stack (max 4, size sm, `+N` overflow chip), "`done/total tasks`", and due date with calendar icon (`.is-late` when not done and past due).
- `.pgrid-empty` → empty-state ("Nothing here yet" / "No projects match this filter.", folder icon), hidden while any card visible.

### Progress ring (`.pring`)
64×64 SVG, radius 27 (circumference ≈ 169.6), rotated -90°, stroke 7px round caps; track `var(--well)`, arc `var(--hue)`. Value set via `stroke-dasharray: "<C*v> <C>"`; centered `%` label (700 15px display font, tabular). Animated via GSAP attr tween 1.2s power3.inOut from previous value.

### Detail view
- Header: title = project name, sub = summary, back → `#/projects`. A large project icon (`head__icon picon--lg`) is inserted before `.head__text` (hidden ≤760px).
  Stats: Progress (pct of project tasks done), Open tasks, Done, "Days left" / "Days over" (abs). If project is done, the last stat's label becomes "Status" and its value the text "Shipped" (no count-up).
  Actions: `button.btn.btn--glass.pstar.pstar--btn[data-star]` (star icon + "Pinned"/"Pin"), `button.btn.btn--glass[data-act=event]` ("New event", calendar-plus icon).
- `div.pd.hue--{hue}` — 2-column grid `minmax(0,5fr) minmax(0,7fr)`; two `.pd__col` flex columns.
  - Left column cards (helper `card` → `section.card.glass.{cls}` with `header.card__head` (title h2, optional `.card__sub`, `.card__tools`) and body):
    1. Overview (`#p-over.pd-over`): facts `dl` (Lead → link to `#/team/:id` with avatar + name; Status pill). Timeline `.tline`: track 10px pill with gradient fill scaled to elapsed fraction (1 if done), milestone dots positioned by `left:%` (hollow ring / filled when done, title tooltip), a "Today" marker (3px bar with pill label above; `.is-start` if <10% / `.is-end` if >90% to keep label inside). Ends row: "Started/Starts {date}" and "Due/Shipped {date}". Then "People" heading with count badge and a grid (`auto-fill minmax(190px,1fr)`) of person links (avatar md with presence dot; name; "Lead · " prefix + presence label).
    2. Milestones (`#p-ms.pd-ms`, sub "`X of N reached`" or "None yet"): ordered list `.ms` of `.ms__item` (classes `is-done`, `is-next` for the earliest undone). Each: round 32px check button `[data-ms]` (aria-pressed, label "Complete/Reopen milestone: …"), body (title + "date · Done|relative"), "Next" tag. A vertical connector line (2px) joins items; hue-tinted when done. Empty state: "No milestones yet".
    3. Coming up (`#p-up.pd-up`, tool link "Calendar" → `#/calendar`): up to 4 future events of the project (`button.pev[data-event]` with date tile month/day, title, "Today|weekday… · time · place", attendee avatars max 3) or "Nothing on the calendar."; then "Recent activity" feed (max 4: avatar, first name bold, text, relative time) or "Quiet so far."
  - Right column:
    4. Burn-up (`#p-burn.pd-burn`, sub "Tasks done against the total, over the project's life", has expand button): legend (Done in hue / Total dashed) + `.burn__chart` (height `clamp(200px,15vw,270px)`, 56vh when card is focused). Empty "Nothing to chart yet" if no tasks or span < 2 days.
    5. Tasks (`#p-tasks.pd-tasks`, sub "`N open · M done`", tool button "Add task" accent): `.ptasks` sections per status (To do / In progress / In review / Done): header with colored dot `.sdot--{status}`, name, count badge; Done group has a "Show/Hide" ghost button `[data-fold]` controlling `#pdone` list (hidden by default). Rows `button.prow[data-task]`: title (line-through when done), priority badge only for high/urgent and not done, due label (`.is-late` red), assignee xs avatar. Sort: done by doneAt desc, others by due asc. Empty group: "Nothing waiting." (todo) / "Nothing here."; no tasks at all: empty state "No tasks yet".
- Missing view: header "Project not found" (back link, sub "The link may be old, or the project was removed.") + `.pd-missing` (max-width 560px) card with empty state and "All projects" accent button.

### Breakpoints
- ≤1240px: `.pd` columns `1fr 1.25fr`.
- ≤980px: single column; `.pd__col {display:contents}` and card order Overview, Milestones, Burn-up, Tasks, Coming up.
- ≤760px: filter segmented control stretches (buttons flex:1); header lead stacks vertically; head icon hidden.
- ≤520px: task row drops priority column; card footer avatar stack shows max 3.
- `pointer: coarse`: 44px targets for star and milestone checks (connector offset adjusted), 44px min-height for fold/lead links; card link gets enlarged vertical hit area.

## 3. Interactions

All via one delegated click handler on the view root (first match wins):
- `[data-star]` (card star or header pin button): toggle `project.starred`, update aria-pressed; star SVG animates (pin: scale .4/rot -72° → 1/0, 0.7s back.out(2.6); unpin: scale .8→1, 0.4s back.out(3)); emit `projects` (sidebar "pinned" list re-renders, max 5 starred shown); toast "Pinned X to the sidebar" / "Unpinned X" with star icon and Undo (re-toggles).
- `[data-ms]`: toggle milestone `done`; log activity "reached/reopened the milestone “title”"; emit `projects`,`activity`; pop animation on the check when done; toast "Milestone reached: …" / "Reopened: …" (flag icon) with Undo. Focus is restored to the same check after re-render.
- `[data-task]`: open the shared task drawer for that id.
- `[data-event]`: open the shared event detail.
- `[data-fold]`: toggle done-list visibility; text Show/Hide; aria-expanded; revealed rows fade-up (y 8, stagger .025).
- `[data-act=new]` → shared "New project" modal (fields: Name* , What is it for? textarea, Lead select (members, default me), Colour select (default indigo), Target date (default today+30), Icon select folder/rocket/leaf/flame/mobile/grid/chart/sparkle (default sparkle)). On create: new project at top with status planning, members {lead, me}, starred true, no milestones, activity logged, toast, navigate to its detail.
- `[data-act=task]` → shared "New task" modal prefilled with this projectId. `[data-act=event]` → shared "New event" modal prefilled with projectId.
- Filter segmented control: click or ArrowLeft/Right (wraps) moves a sliding pill (`.seg__pill`, squash-and-stretch: position tween 0.62s back.out(1.35) + scale keyframes then elastic.out(1.1,.38)). On change: cards that will hide clip-out (0.2s); then GSAP Flip records visible cards, toggles `hidden`, Flip-animates remaining cards (0.65s power3.inOut); newly shown cards clip-reveal (y 18, stagger .05, delay .1) and their rings animate 0→value.
- Cards have `data-lift`: on fine pointers, hover lifts card `y:-4` (0.45s power3.out), back on leave.
- Burn-up card expand button → FLIP focus mode (see shared helpers), chart resizes.
- Chart: hover/pointer shows crosshair, dots, tooltip; focusable, ArrowLeft/Right steps through points; blur hides.

### Live updates (store subscriptions)
- List mode on `projects`/`tasks`: keyed reconcile of cards — each card has a signature (name, status, summary, due, members, task counts, next milestone); changed cards re-render inner HTML and animate the ring from old to new value; unchanged cards only refresh the star state; removed cards clip-out then removed; new cards inserted and revealed (if a new card is hidden by the filter, filter resets to All). Cards reordered to current sort. Header sub + stats update with a count tween and a "flash" bump (`is-flash` class + y -4/scale 1.06 → rest, back.out(2.4)).
- Detail mode: `projects`/`members` → re-render overview and pin button; `projects` → milestones (with FLIP position animation of keyed items) + sub; `tasks` → task groups (FLIP), sub, burn-up chart `update()` (morphs series over 0.9s) or creates it if it didn't exist, header stats; `events`/`activity` → coming-up panel.
- Missing mode: if the project appears, re-enter as detail.

## 4. Data

Store object (`pane:v1` in localStorage; regenerated from deterministic seed — PRNG seed 174 — when missing, wrong version, or `seededOn` ≠ today's date; `?record` in URL disables persistence):
- `project`: `{ id, name, hue, icon, lead, members[], status: planning|active|review|done, start, due (ms), summary, starred, milestones: [{id, title, due, done}] }`. Hues: blue, pink, purple, green, orange, teal, indigo.
- Seed: 6 projects — Tide mobile app (blue, active, 6 members, 4 milestones, 14 tasks), Facet design system (pink, active), Orbit 2.0 launch (purple, active, due +12d), Sprout onboarding (green, review, due +5d), Q4 brand campaign (orange, planning, starts +4d), Northstar analytics (teal, done). Tide & Orbit starred. Milestones with negative day offset are done.
- `task`: `{ id, title, projectId, status: todo|doing|review|done, priority: low|medium|high|urgent, assignee, due, created, doneAt?, est (hours), order, subtasks[], comments[], notes }`. Tasks with `order >= 1000` are synthetic "history" (≈92 days of done tasks for charts) and are EXCLUDED from project task lists/progress.
- `event`: `{ id, title, start, end, kind: meeting|focus|review|deadline|social, projectId?, attendees[], place? }`.
- `activity`: `{ id, at, who, text, kind, projectId?, href? }` (newest first, capped at 60).
- Members (12): `{ id, name, role, team, photo, presence: online|focus|meeting|away, city, tz, email, capacity }`. Presence labels: In focus / In a meeting / Online / Away. Avatars use photo `<img>` or initials with a hue chosen by sum of char codes mod 7.
- Status labels: planning "Planning", active "In progress", review "In review", done "Shipped".
- Derived: progress = done/total of project tasks; elapsed = clamp((now-start)/(due-start)); "on track" = progress ≥ elapsed.
- Burn-up series: 13 evenly spaced samples from min(project start, earliest task created) to now (or to max(due, last doneAt) for done projects); "Done" = tasks with doneAt ≤ t (tone = project hue), "Total" = tasks created ≤ t (tone muted, dashed). Y formatter "N task(s)".

## 5. Notable CSS

- `.pcard`: radius `var(--r-xl)`, background = radial hue glow (120% 70% at top-left, hue 20% → transparent 62%) layered over `var(--glass)`; padding `clamp(16px, .6vw+13px, 22px)`; grid gap 16px. Focus ring on card when inner link is `:focus-visible` (2.5px accent-ink, offset 3px).
- `.pcard__name` 650 18px display font, ellipsis. Star button positioned above the stretched link (z-index 2).
- `.pstatus`: 24px pill, `--st` color var per status (active green, review orange, planning indigo, done teal), bg `--st` 16%, dot 7px with 3px halo ring; done shows a check icon.
- `.pstar[aria-pressed=true] .ico` fill + color `var(--yellow)`.
- `.av--ini` initials avatar: white text on 150° gradient from hue-lightened to hue.
- `.tline__ms` 14px circle, inset 3px hue ring on `--glass-solid`; done = filled hue with outer 3px solid ring. `.tline__now em` pill inverted colors (bg text, color bg).
- `.ms__check` 32px circle, inset 2px hue ring (55%); done = filled hue; next = extra 5px outer halo.
- `.pgroup__list` filled panel radius 18px, rows separated by 1px top shadow; `.prow` grid `1fr auto auto auto`, radius 14px, min-height 42px.
- `.pev__date` 46×50 tile, hue 16% bg, radius 14px.
- `.burn__legend i` 14×4 swatches; `.burn__dash` dashed 2px top border.
- Chart (shared): SVG with padding l44 r12 t12 b26; 3 grid lines (0, ½, max) with right-aligned Y labels; nice-number max (×1.08 headroom, rounded to 1/2/2.5/5/10 × 10^n); smoothed Catmull-like cubic path (tension .18, control points clamped to avoid overshoot); first series gets a gradient area fill; draw-in via clip rect width tween 1.4s power2.inOut; x labels thinned to ~one per 56px.
