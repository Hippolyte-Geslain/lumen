# Route: Home (`#/` / `home`)

Source: `home-DwmiJYSE.js` + `home-D5Mu7eVr.css`. Imports the **bars** chart from the charts chunk.
This is a behavioral spec for a clean-room re-implementation, not a code listing.

## 0. Shared conventions (apply to every route)

**Page contract (router side).** Each route chunk exports `page` with this shape:

- `title`: a string, or a function of the params.
- `mount(viewEl)`: called **once**, the first time the route is visited. The router caches the page object in a Map and never calls mount again or unmounts. Its job is to render HTML into `viewEl` (a `[data-view="<name>"]` section) and attach the delegated listeners and store subscriptions.
- `enter({ params, first, same })`: called on every navigation to the route. `first` is true on the view's first enter, tracked with `data-entered="1"` on the view. `same` is true when only the hash params changed inside the current route.
- `leave()`: optional, called on the outgoing page.

There is **no cleanup function**. Views are hidden by toggling the `hidden` attribute. When a store change arrives while a view is hidden, the page sets a "dirty" flag and re-renders on its next `enter`.

**Transition out of the previous route.** The `.head__lead` and `.head__actions` blocks fade up (opacity 0, y -8, 0.18s, power2.in). At the same time, visible `.glass` and `.stat` elements run a clip-path collapse: an inset that shrinks toward the centre, plus scale 0.97 and y -6 over 0.18s. When that finishes, the router swaps views, scrolls to the top, calls `enter`, and focuses `.head__title`.

**Store.** One global state object, persisted to `localStorage["pane:v1"]` and stored as `{version:1, seededOn:"Y-M-D", me, members, projects, tasks, events, focus, activity, notices, settings}`. It is reseeded every day: when `seededOn` is not today, a deterministic PRNG with seed 174 rebuilds it. Mutations call `emit(...topics)`, which saves the state and then notifies subscribers of each topic. The topics are `members, projects, tasks, events, focus, activity, notices, settings`, plus a `*` wildcard. `subscribe(topic, fn)` returns an unsubscribe function, but the pages never call it.

Other keys:
- `localStorage["pane:focus"]`: the running focus session, stored as `{minutes, taskId?, started, pausedFor, paused?}`.
- `localStorage["pane:look"]`: theme settings, stored as `{theme, wall, accent, glass, solid}`.
- `?record` in the URL disables persistence.

**Seed data summary.**
- **members** (12): `{id, name, role, team, photo, presence: focus|meeting|online|away, city, tz, email, capacity}`. `me = "lin"` (Lin Zhao, Product Lead).
- **projects** (6): tide/blue/mobile, facet/pink/grid, orbit/purple/rocket, sprout/green/leaf, ember/orange/flame, north/teal/chart. Fields are `{id, name, hue, icon, lead, members[], status: planning|active|review|done, start, due, summary, starred, milestones[{id,title,due,done}]}`.
- **tasks**:
  - Each project has about 10–12 named tasks: `{id:"<proj>-<i>", title, projectId, status: todo|doing|review|done, priority: low|medium|high|urgent, assignee, due, created, doneAt?, est (hours: 1,2,3,4,6,8), order, subtasks[{id,title,done}] (every 3rd task has 3 subtasks), comments[{id,who,at,text}] (every 4th task), notes}`.
  - 5 "me" tasks are due today (`order` 100+) and 2 "me" tasks were done today.
  - About 92 days of **historical** done tasks have `order: 1000`. They feed the charts only: the "active" task list is `tasks.filter(t => t.order < 1000)`.
- **events** (~26): `{id, title, start, end, kind: meeting|focus|review|deadline|social, projectId?, attendees[], place?}`. Offsets are counted in **working days** from today.
- **focus** sessions: `{id, at, minutes (25/50/90), who}` for every member on weekdays over 92 days.
- **activity** (10, capped at 60): `{id, at, who, kind, text, projectId?, href?}`.
- **notices** (4).

**Shared UI helpers** (reimplement once):
- **Card.** `<section class="card glass {cls}" id aria-labelledby>`, then `header.card__head` (h2 `.card__title`, optional `p.card__sub`, `div.card__tools`), then the body. With the `expand` option, the tools get an "Expand" icon button marked `[data-expand]`.
- **Card expand.** This is GSAP **Flip**.
  - Opening:
    1. A dashed `.card-ph` placeholder is inserted to keep the grid cell.
    2. The card gets `.is-focus` (`position:fixed; inset:9vh max(4vw,24px); z-index:60`) and `<html>` gets `.has-focus`.
    3. The `.scrim` fades to visible.
    4. A Flip from the old state runs (0.6s, power3.inOut), then the children fade back in with stagger 0.04.
    5. The card dispatches a `card:resize` CustomEvent so charts redraw.
  - Collapsing reverses this (0.5s).
- **Page header** `.head`:
  - `.head__lead`: optional back button, plus `h1.head__title` and `p.head__sub`.
  - `.head__actions`.
  - `dl.head__stats` of `.stat[data-stat=key]`. Each stat holds `dt.stat__label` and `dd.stat__value`, which contains `<b data-count data-fmt>` plus an optional `<small>` suffix.
  - Intro animation:
    - The title is split into per-character spans. They go from yPercent 115 and rotation 6 to 0 over 0.85s, power4.out, stagger 0.022.
    - The sub and action items fade up.
    - The stats clip-reveal.
    - The numbers count up from 0 over 1.3s, power3.out, staggered by 0.06.
- **Segmented control** `.seg`: `.seg__pill` plus a `button.seg__btn[data-value][aria-pressed]` for each option. The pill moves to the active button with a squash-and-stretch "liquid" tween: position 0.62s back.out(1.35); scale keyframes 0.16s power2.out, then elastic.out(1.1,0.38) over 0.85s. ArrowLeft and ArrowRight cycle the options, and a ResizeObserver re-places the pill. The API is `{select(value,{silent}), value, place()}`.
- **Popover** `.pop.glass.glass--thick`:
  - It is appended to `.pop-layer` and anchored to its trigger.
  - Placement: align start/center/end, flip above the trigger when there is no room, and clamp 12px from the viewport edges.
  - It opens with a clip reveal and closes on outside pointerdown, Escape, resize or scroll.
  - Menus (`role=menu`) are built from `{label, checked?, icon?, danger?, onSelect}` items, with `"-"` as a separator. ArrowUp and ArrowDown move focus between items.
- **Modal form** is a `<dialog id="modal">` containing `form.mform`:
  - A grabber, then a header with a close button, the title and a submit button.
  - `.mform__grid` of `label.field` (`field--wide` spans the full row).
  - Validation shakes the first empty required field (x -6 → 0, elastic.out).
  - It opens with `showModal` plus a clip reveal. On phones (≤760px) it slides up as a sheet.
- **Drawer** `<dialog id="drawer">` slides in from the right (x 70). On phones it rises from the bottom. Two drawers exist:
  - Task drawer: project chip, priority, title, status segment, meta, subtasks, comments, and the actions "Focus on this", "Mark done/Reopen" and delete with confirm.
  - Event drawer: kind badge, when/where/project/people, "Join" (when `place === "Video call"`) and "Remove".
- **Toast** `oc(text, {ico, undo?, tone?})` shows an optional Undo action.
- **Glass glint.** On fine pointers, a GSAP ticker writes `--gx` and `--gy` on the hovered `.glass:not(.glass--thick)`. The `.glass` background uses them for a 260px radial glint.
- **Reduced motion.** Every duration goes through `q(d)`, which returns 0 under `prefers-reduced-motion`.

## 1. Entry point

```
page = { title: "Home", mount(el){ M = el; render(); wire(); enableCardExpand(M) }, enter({first, same}){ if(!same) intro(first) } }
```

There is no `leave`. The module keeps three variables: `M` (the root element), `N` (the bars chart instance) and `P` (the people segment API). It also keeps the focus length `F`, which defaults to 25 and lives in memory only.

## 2. Layout

Render order:

1. The **page header** (`.head`).
   - Title: `"{Good morning|afternoon|evening}, {first name}"`. The cut-offs are hour < 5 → evening, < 12 → morning, < 18 → afternoon, otherwise evening.
   - Sub: `"{Weekday, Month D} · {n} meeting(s) and {m} task(s) left today"`.
   - Three stats:
     - `done`: "Done today", value and `/ goal`.
     - `focus`: "Focus today", hours format (`90 → "1.5h"`, `45 → "45m"`).
     - `late`: "Overdue".
   - Actions:
     - `btn--glass [data-act=task]` "New task" with a plus icon.
     - If there is another event today, `btn--accent [data-event=id]` "Next: {time}" with a video icon.
2. `div.home`: a **12-column CSS grid** with gap `var(--gap)`, laid out with named areas.

Default areas (above 1360px):
```
rings×4  next×4  focus×4
tasks×5  week×7
proj×7   people×5
```
- **≤1360px:** `rings6|tasks6` / `focus6|tasks6` (tasks spans 2 rows) / `next6|week6` / `proj7|people5`.
- **≤1100px:** same as above, but proj and people each take a full row.
- **≤860px:** one column with the order rings, next, focus, tasks, week, proj, people. `.hproject` drops to 3 columns, the bar moves to row 2, and the avatar stack is hidden.

The cards are all `section.card.glass`, and the ones listed below get `display:flex; flex-direction:column` (`.w-rings, .w-focus, .w-week, .w-next`, `.w-tasks`). Each card below gives its classes, title, sub and tools, then its body.

### w-rings — "Today" / "Close your rings"

- Three concentric SVG rings, Apple-Activity style, in a `viewBox 0 0 136 136`.
  - Radii are 56 (tasks), 41 (focus) and 26 (meet).
  - Stroke width is 13, with round caps.
  - The SVG is rotated -90deg so the arcs start at 12 o'clock.
  - Width is `clamp(120px, 9vw, 150px)`.
- Each ring is a track circle (opacity .2) plus an arc circle. The arc's progress is drawn with `stroke-dasharray: "{C*p} {C}"`, where `C = 2πr` and p is clamped to [0.012, 1].
- Colours come from the CSS vars `--ring-tasks`, `--ring-focus` and `--ring-meet` (`.rings--*` sets both `stroke` and `--rc`).
- A legend `dl.rings__legend` sits beside the rings. Each `.rings__row` has a 3px left border in `--rc`, a dt (13px, text-2) and a dd (display font 700 22px, tabular numbers) containing `<b>` and `<small>`. The rows are:
  - Tasks: `doneToday / goal`.
  - Focus: `hours / 2h`.
  - Meetings: `met / meetings`.
- Metrics:
  - `doneToday`: tasks with doneAt today and assignee me.
  - `goal`: `max(dueToday(me).length, doneToday, 1)`.
  - `focusMin`: the sum of my focus minutes today; the goal is 120.
  - `meetings`: today's events I attend, excluding the `focus` and `deadline` kinds.
  - `met`: how many of those have already ended.
- Animation: each arc tweens its `stroke-dasharray` attribute over 1.4s, power3.inOut, with the delay staggered 0.12 per ring.

### w-next — "Up next"

- Tools: a ghost button that links to `#/calendar`.
- Body: `.next-wrap`, which contains:
  - **Hero button** `button.next.hue--{projectHue|indigo}[data-event]`:
    - The event is the next one I attend today that hasn't ended yet. If there is none, it is tomorrow's first event.
    - Background: a 140deg gradient of `--hue` at 22%→8%, with an inset 1px ring at 26%. Radius 20px, padding 16px.
    - `.next__when` shows one of three states:
      - A red pulsing dot (`#e5303c` with a 4px 20% halo) and the text "Now", while the event is in progress.
      - `in <b data-countdown=start>X h Y min</b>`.
      - "Tomorrow".
    - `.next__title` is display font 650 at 19px.
    - `.next__meta` shows the time range and the place.
    - `.next__foot` holds a 4-avatar stack and, for video calls, an accent "Join" button.
  - `ul.next__rest`: up to 3 more events. Each row has a 4×20 hue bar, the title (ellipsised) and the time.
- Empty state: a calendar icon, "Nothing else today", "Your calendar is clear."
- The countdown refreshes every 60s through a recursive `gsap.delayedCall(60)`.

### w-focus — "Focus" / "The island keeps the time"

- Tools: a segment `seg--sm focus__len` with 15m, 25m and 50m. It sets `F` and re-renders the timer. It is hidden (`visibility`) while `.w-focus.is-running`.
- The card uses `container-type: inline-size`. At container width ≤300px the dial stacks above the controls.
- **Dial:**
  - SVG 150×150, r=62, stroke 11, rotated -90deg. Size is `clamp(104px, 7.5vw, 124px)`.
  - Track colour is `--well`.
  - The arc is orange (`#f28c00`, or `#ffb340` in dark mode) and uses `stroke-dashoffset = C*(1-progress)` with a CSS transition of 0.9s linear.
  - In the centre: `b.focus__time` showing "25:00" (display font 650, `clamp(24px, 1.6vw, 28px)`) and `small.focus__state`, which reads Ready, Focusing or Paused.
  - While running, the time is coloured `#b35f00` (dark mode `#ffb340`). While paused, it is text-2.
- **Idle panel:**
  - A "Focus on" `<select data-focus-task>` with the default option "No task — just focus" plus my open tasks (due today plus overdue). It uses custom CSS-gradient chevrons, radius 12, min-height 40.
  - An accent full-width "Start focus" button with a play icon.
- **Run panel:**
  - "Focusing on", followed by the task title or "{n}-minute block" (2-line clamp).
  - Two glass sm buttons: Pause/Resume (the icon swaps) and End.
- **Footer** `.focus__today` (fill background, radius 16):
  - "Focused today", followed by `"{hours} · {n} session(s)"`.
  - A 6px meter whose `<i>` (orange gradient) tweens scaleX over 0.9s, power3.out.
- Starting a session calls the global focus store's start with `(F, taskId)` and pops the dial (scale .92 → 1, 0.8s, `elastic.out(1,0.5)`). The countdown itself lives in a global "island", the app chrome, which sends tick events. The home page subscribes through the focus listener and re-renders the time, state and dashoffset.

### w-tasks — "My tasks" / "Due today and late"

- Tools: a link to `#/tasks`.
- `ul.mytasks`, at most 7 entries: overdue(me) plus dueToday(me), deduplicated, sorted with not-done first and then by due date.
- Each `li.mytask[data-key]` contains:
  - A checkbox `.check[data-done]`.
  - A button `.mytask__body[data-task]` with the title (ellipsised, 560 weight) and a meta line: project chip (22px tall), then the due label, coloured red with `.is-late` when overdue.
  - A priority badge, for high and urgent tasks only.
- Done tasks get a line-through title in text-3.
- Rows are separated by a 1px `--sep` top border.
- Empty state: a check icon, "All clear", "Nothing due today. Nice."

### w-week — "This week" / "Tasks the team finished" (expandable)

- `p.week__sum` reads `<b data-count>N</b> finished so far` followed by a delta pill, `delta--up` or `delta--down`, with the text "+X% vs last week". The delta compares this week up to now against the same span last week.
- `div.week__chart` is a **bars** chart (see charts.md):
  - Labels Mon–Sun, values = done count per day for the whole team.
  - `tone: accent`, format `"{n} done"`.
  - Today's column is highlighted (`is-hi`).
- Height is `clamp(150px, 13vw, 210px)` and flexes to fill the card. In focus (expanded) mode the height is 52vh.

### w-projects — "Projects"

- Tools: a "See all" link.
- `ul.hprojects`: the first 5 projects that are not done. Each row is `a.hproject` linking to `#/projects/{id}`.
  - It is a 5-column grid: `auto | minmax(0,1.3fr) | minmax(70px,1fr) | 42px | auto`.
  - The columns hold:
    1. The project icon tile (`picon--md hue--x`).
    2. The name (bold, ellipsised), with a small line under it: "{status label} · due {Mon D}".
    3. An 8px progress bar.
    4. The percentage.
    5. An avatar stack of 3.
  - Progress is the share of the project's tasks that are done. The `<i>` uses `scaleX(p)`, origin left, with background `var(--hue)`.
  - Rows have radius 16 and a hover fill. Rows after the first get a separator and radius 0.

### w-people — "Right now"

- Tools: a segment `seg--sm` with Team and Activity.
- **Team view**, `ul.people`:
  - Every member except me, sorted by presence (focus, meeting, online, away), capped at 6.
  - Each `a.person` links to `#/team/{id}` and shows an avatar with a presence dot (md), the name, and `"{presence label} · {detail}"`.
  - The detail depends on presence:
    - focus: "until HH:MM", where the time is now+40min rounded up to the next 15 min.
    - meeting: the current event's title.
    - away: the city.
    - otherwise: the role.
- **Activity view**, `ol.feed`: the 6 latest activity items. Each shows an avatar (sm), **first name** + text, and a small line with the relative time and the project name.
- Switching views:
  1. Fade the wrap out (opacity 0, y 6, 0.15s, power2.in).
  2. Swap the content.
  3. Fade back in from y -6 (0.3s, power3.out).
  4. Stagger the `li` elements in (y 8, stagger 0.035).

## 3. Interactions

The page uses a single delegated `click` listener and a single `change` listener on the root.

- **Click handling:**
  - `[data-task]` opens the task drawer.
  - `[data-event]` opens the event drawer. This applies to the next hero, the rest rows and the header button.
  - `[data-act=task]` opens the New task modal with a default due date of today at 17:00.
  - `.focus__go` starts focus with `F` and the selected task.
  - `[data-f=pause]` toggles pause/resume; `[data-f=stop]` ends the session.
- **Checkbox change** (`[data-done]`):
  - It toggles `.is-done` on the row immediately, pops the checkbox (scale .6 → 1, 0.6s, back.out(3)) and calls `toggleDone(task, checked)`.
  - `toggleDone` sets the status to done (with `doneAt` and an activity entry) or back to todo, emits `tasks` and `activity`, and shows the toast "Done: {title}" with an Undo that sets the task back to doing.
- **Store subscriptions:**
  - `tasks`: if the view is hidden, mark it dirty. Otherwise run a FLIP re-render of My tasks and update the metrics.
    - The FLIP re-render works like this: record each `[data-key]` rect, re-render, then animate the y delta to 0 (0.5s, power3.inOut). New rows fade up 10px over 0.4s.
    - The metrics update re-tweens the rings, counts the stats to their new values (0.9s) and flashes the "done" stat. The flash adds the `.is-flash` CSS colour keyframe and a y -4 / scale 1.06 back.out(2.4) bump. It also runs a bars `update()`.
  - `focus`: update the "Focused today" line, then refresh the metrics, or mark the view dirty if it is hidden.
  - `events`: re-render the Up next card.
  - `activity`: re-render the feed if the activity tab is active.
  - `projects`: replace `.hprojects`.
  - Focus listener (start, pause, resume, tick): re-sync the timer UI.
- **Cards** get a lift on hover: elements marked `[data-lift]` move y -3 on fine pointers.

## 4. Enter animation (timeline)

The timeline only runs when `same` is false. If the view is dirty and this is not the first enter, it re-renders first.

| t (s) | action |
|---|---|
| 0 | page-header intro (on non-first enters only the header numbers re-count, at 0.2s, without starting from 0) |
| 0.12 | card clip-reveal: each `.card` goes from y 30, scale .97 and a clip-path inset at 72% of its size to the full rounded rect, over 0.9s with expo.out and stagger 0.06; the card's children fade up 8px with stagger 0.035, offset 0.14s |
| 0.35 | rings tween with an extra 0.1s delay |
| 0.45 | bars `play()`; project bars grow scaleX 0→1 over 1.1s, staggered 0.08; list items (`.mytask`, `.next__rest li`, `.person`, `.hproject`) fade up 10px with stagger 0.03; the week sum counts up |

## 5. Notable CSS

- Ring colours: `--ring-tasks`, `--ring-focus`, `--ring-meet` (global tokens).
- The focus orange is hard-coded: `#f28c00` / `#ffb340`, and the meter uses a gradient of the two.
- Radii: next hero 20, focus footer 16, hproject and person 16, rest rows 12, select 12.
- Tabular numbers on all numeric readouts. `.is-late` uses `color: var(--danger)` at weight 600.
- Global tokens used throughout: `--text`, `--text-2`, `--text-3`, `--fill`, `--fill-hover`, `--well`, `--sep`, `--hue` (set by `.hue--{name}`), `--font-display`, `--gap`, `--r-xl`.
