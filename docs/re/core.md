# Pane — core shell (reverse-engineering notes)

Source: `index-Bn4EHT_o.js` (10.5k lines, prettified), `index-TQp-C7g7.css` (3.3k lines), `index.html`.
These notes describe behaviour so it can be rebuilt as original code. Names in `backticks` are DOM classes/ids/keys
that are part of the observable contract. Minified identifiers are referenced only where it helps find things.

---

## 1. Bundled libraries

| Lines | What |
|---|---|
| 1–22 | Vite `__vite__mapDeps` table (route chunk + CSS file list) |
| 23–~60 | Vite modulepreload polyfill |
| ~60–4700 | **GSAP core 3.15.0** + **CSSPlugin** (registered at ~4698, exported as the `gsap` instance) |
| ~4700–6255 | **Flip plugin 3.15.0** (with its matrix utils; timeline `data: "isFlip"`), registered at 6254 |
| 6256–end | App code |

Not bundled: Draggable, InertiaPlugin, ScrollTrigger, SplitText, CustomEase. Text splitting and all drag
behaviour are hand-rolled. GSAP eases used: `power2/3/4`, `expo.out`, `back.out(n)`, `elastic.out(a,p)`.
`gsap.quickTo`, `gsap.ticker`, `keyframes`, `clearProps`, `overwrite:"auto"` are relied on.
Build: Vite, base path `/pane/`. CSS minified by lightningcss (see `--lightningcss-light` vars).

Route chunks: `home`, `tasks`, `calendar`, `projects`, `insights`, `team`, `settings` (each JS+CSS), plus a shared
`charts` chunk used by home/projects/insights.

---

## 2. `index.html` shell

`<html lang="en" data-theme="dark" data-wall="ash" data-accent="blue" data-glass="tinted">`. Inter from Google Fonts
(variable opsz/wght) as a fallback after the system SF stack. `meta theme-color` is updated by JS.

### Inline pre-paint script (head, before module)
1. Adds `js` class to `<html>`.
2. Detects `?record` in the query → adds `is-record` (deterministic capture mode, ignores saved prefs).
3. Unless recording: reads `localStorage["pane:look"]` (JSON) and applies `theme` (resolving `"system"` via
   `prefers-color-scheme`), `wall`, `accent`, `glass` to `html[data-*]`, and `solid → html.is-solid`. Wrapped in try/catch.
4. Unless recording: after 4000 ms adds `failsafe` class.
CSS hides `.side, .toolbar, .main, .tabbar` (visibility) while `html.js:not(.is-ready):not(.failsafe)` → no flash;
the app adds `is-ready` at boot; failsafe reveals the shell if the module never runs.

### Body structure
```
a.skip[href=#main]                       skip link (fixed, off-screen until focus)
div.wall[aria-hidden]                    wallpaper; JS injects an SVG into it
div.app
  aside.side.glass.glass--chrome         sidebar
    a.brand  (brand__mark svg + brand__name "Pane")
    nav.nav > div.nav__track
      span.nav__lens                     sliding active pill
      a.nav__item[data-route=home|tasks|calendar|projects|insights|team|settings] (svg.ico + span label)
        tasks item also has b.nav__count#count-tasks
    div.side__group > p.side__label#pinned-label "Pinned" + ul.pinned (JS-filled)
    button.side__me#btn-me (avatar img, name/role, chevron)   → account menu
  header.toolbar
    div.toolbar__title.glass.glass--chrome > span#compact-title   (compact page title, appears on scroll)
    div.toolbar__tools.glass.glass--chrome
      button.search-pill#btn-search (icon, "Search", kbd ⌘K)
      button.tbtn#btn-new      (+, aria-haspopup=menu)
      button.tbtn#btn-theme    (contains .ico--sun and .ico--moon; CSS shows one per theme)
      button.tbtn#btn-bell     (+ span.badge-dot#bell-badge[hidden])
      button.tbtn.tbtn--me#btn-me-top (avatar; only visible on phone)
  main#main.main
    section.view[data-view=<route>][hidden] × 7
  nav.tabbar                             phone-only floating tab bar
    div.tabbar__bar.glass.glass--chrome > div.tabbar__track
      span.tabbar__lens
      a.tab[data-route=home|tasks|calendar|projects] , button.tab#tab-more[data-route-more] ("More")
    button.tabbar__search.glass.glass--chrome#btn-search-m (separate circle)
div.scrim                                used by card focus mode
div.pop-layer                            container for popovers/menus
div.island[data-mode=hidden] > div.island__body > button.island__compact, div.island__note[role=status aria-live], div.island__full[role=group]
dialog.finder#finder > div.finder__bar.glass.glass--thick (icon, input#finder-q role=combobox, kbd esc) + ul.finder__list.glass.glass--thick#finder-list[role=listbox]
dialog.modal.glass.glass--thick#modal
dialog.drawer.glass.glass--thick#drawer
```

---

## 3. Router

- Routes: `home, tasks, calendar, projects, insights, team, settings`. Titles map 1:1 (capitalised). Icon map:
  home→home, tasks→tasks, calendar→calendar, projects→folder, insights→chart, team→users, settings→gear.
- Hash format `#/<name>/<param>/<param>…`. Parse: strip leading `#/`, split on `/`, drop empties, URI-decode.
  Unknown name → `home` with no params. On boot, if no hash, `history.replaceState` to `#/home`.
  Deep links used across the app: `#/tasks/<taskId>`, `#/projects/<projectId>`, `#/team/<memberId>`.
- Lazy import map: name → dynamic `import()` of the chunk (with CSS preload). Loaded page modules are cached in a Map.
- **Page module contract** (each chunk exports `page`):
  `{ title: string | (params)=>string, mount(sectionEl), enter({params, first, same}), leave?() }`.
  `mount` runs once on first load; `enter` on every visit; `first` = section never entered before;
  `same` = hash changed but route name didn't (param change).
- **Navigate algorithm** (on `hashchange`, and once at boot with `initial=true`):
  1. Bump a navigation token (race guard). Close any popover, collapse any focused card, re-render pinned list.
  2. Same route as current → call `enter({same:true})`, update title, stop.
  3. Load module (on failure: toast "`<Title>` couldn't load. Check your connection and try again." warn tone).
     Abort if token is stale. `mount` into `[data-view=name]`.
  4. Call previous page's `leave()`, set active nav (`aria-current="page"` on every `[data-route]` match;
     `#tab-more` gets `data-current` + `aria-current` for insights/team/settings), move lenses (animated unless initial).
  5. Update title: `document.title = "<title> · Pane"`, `#compact-title` text = title.
  6. **Exit animation** (if a previous view exists and motion allowed): `.head__lead, .head__actions` of old view
     → opacity 0, y −8, 0.18 s power2.in; every `.glass, .stat` of the old view currently in the viewport →
     "clip-collapse" exit (see `collapseOut` below, 0.18 s). When done, clear props and swap.
  7. **Swap**: hide all `.view` except target, `scrollTo(0)`, `page.enter(...)`, mark `data-entered=1`,
     attach the scroll observer, and (non-initial) focus the page `h1.head__title` with `preventScroll`.
  The enter animation is owned by each page (using shared helpers below).
- **Scrolled state**: an IntersectionObserver (rootMargin −12px top) on the current page's `.head__title`
  toggles `html.is-scrolled` when the title has scrolled above ~40px. CSS then reveals `.toolbar__title`
  with a spring clip-path (from `inset(18px 46% round 999px)` + translateY(−6px) to `inset(-40px round 999px)`, 0.55 s `--spring`).
- **Counts/pinned**: sidebar `#count-tasks` = number of my open tasks (blank when 0). `ul.pinned` = up to 5 starred
  projects as `a[href=#/projects/id].hue--X > i (colour square) + span name`, `aria-current` on the open project.
  `.side__me` name/role re-rendered on `members`/`settings` change.

### Active-nav lens ("liquid pill")
One generic routine `moveLens(lens, track, target, animate, axis, radius=999)` used by sidebar (axis `y`),
tab bar (axis `x`; insights/team/settings highlight `#tab-more`), and every segmented control (axis `x`).
- Lens is absolutely positioned at top-left of its track; position via transform x/y; size via width/height
  set to the target's `offsetWidth/Height`; border-radius = `min(w,h)/2` when radius ≥ 999.
- Stores the last box `[x,y,w,h]` on the element. If no target/zero width → hide (opacity 0).
- Jump without animation when: `animate=false`, reduced motion, no previous box, or lens currently invisible.
- Animated move:
  - Position: tween from "new box centred on the old centre" to the new box, 0.62 s `back.out(1.35)`.
  - Scale: starts at old/new size ratio (so it visually begins at old size), then keyframes:
    stretch k = `min(0.5, 0.16 + 0.14 × travelDistance / newSize)` (travel measured on the axis);
    along-axis scale ×(1+k), cross-axis ×(1−0.45k), 0.16 s power2.out → then back to 1/1 over 0.85 s `elastic.out(1.1, 0.38)`.
  Result: a jelly blob that stretches in travel direction then wobbles into place.
- Re-placed (no animation) on ResizeObserver of the tracks and after `document.fonts.ready`.
- Lens look (CSS): `background: var(--lens)` (vertical white gradient), `box-shadow: var(--lens-glow)` (inset top highlight,
  inset bottom glow, 0.5px inner ring, soft drop shadow). Active `.nav__item` icon uses `--accent-ink`.

---

## 4. Liquid-glass system (lines ~9259–9610)

### Gate
Enabled only when ALL: `"userAgentData" in navigator` (Chromium heuristic — Chromium is the only engine that
accepts `url(#filter)` in `backdrop-filter`), `CSS.supports("backdrop-filter","blur(1px)")`, and NOT
`prefers-reduced-transparency: reduce`. Otherwise CSS-only glass (blur/saturate/brightness) is used.
JS does not check `is-solid` (see open questions).

### Presets
| preset | frost (blur σ) | band (px) | mag | sat | aberrate | strength |
|---|---|---|---|---|---|---|
| chrome | 3.2 | 30 | 0.035 | 1.6 | yes | 1.0 |
| card   | 5.5 | 26 | 0.012 | 1.7 | no  | 0.9 |
| thick  | 14  | 20 | 0.010 | 1.5 | no  | 0.7 |
| small  | 4.5 | 18 | 0.030 | 1.7 | no  | 0.9 |

Preset choice per element: `.glass--chrome` → chrome; `.glass--thick` → thick; `.stat` or height < 90 → small; else card.

### Displacement scale
`scale = round(clamp(min(w,h) × 0.55, 26, chrome ? 64 : 52))` — used for feDisplacementMap and for encoding.

### Displacement-map canvas (SDF of a rounded rect)
Inputs: element w, h, corner radius r (= computed `border-top-left-radius`, clamped to w/2, h/2), preset, scale.
- Pad P = 28 px on every side; map covers (w+2P)×(h+2P). Downsample factor
  `s = min(1, sqrt(300000 / area))` so the canvas never exceeds ~300k px (min 8 px per side).
- For each canvas pixel, back-project to element space `x = (px+0.5)/s − P`, same for y. Blue = 128, alpha = 255.
- Signed distance to the rounded rect centred at (w/2, h/2) with half-extents reduced by r:
  `qx = |x−cx| − (w/2 − r)`, `qy = |y−cy| − (h/2 − r)`.
  - both > 0 (corner zone): `d = hypot(qx,qy) − r`, outward normal = `(qx, qy)/len` with the signs of (x−cx, y−cy).
  - otherwise use the larger of qx/qy: `d = q − r`, normal = unit axis vector with that sign.
- Outside (d ≥ 0): neutral (R=G=128).
- Inside:
  - Lens/magnify term (whole surface): `off = −(p − c) / max(1, min(w,h)/2) × (mag × min(w,h))` per axis
    (samples pulled toward the centre → slight magnification).
  - Edge refraction band: depth `t = −d`; if `t < band` (band = min(preset.band, w/2, h/2)):
    `e = (1 − t/band)^2.2 × min(t/1.2, 1) × strength × scale × 0.5`; `off += normal × e`
    (strong bend near the rim, ramps in over the first ~1.2px to avoid a hard seam).
  - Encode: `R = clamp(128 + offX/scale × 254)`, `G = clamp(128 + offY/scale × 254)`.
- `putImageData`, then `toBlob(png)` → object URL (fallback `toDataURL`). Async (Promise).

### SVG filter chain
A single hidden `<svg width=0 height=0><defs>` is prepended to `<body>` lazily. Per (preset,w,h,r) a `<filter id="lgN">`:
- `filterUnits=userSpaceOnUse`, `color-interpolation-filters=sRGB`, region x=y=−28, width w+56, height h+56.
- `feImage result=map` (same region, `preserveAspectRatio=none`, href set when the PNG is ready).
- Non-aberrating: one `feDisplacementMap in=SourceGraphic in2=map scale=S xChannel=R yChannel=G → bent`.
- Aberrating (chrome): three displacement maps at scales S×0.94, S×1.0, S×1.08; each passed through a colour matrix
  that keeps only R, only G, only B respectively (alpha kept); combined with two `feBlend mode=screen` → `bent`.
  (Chromatic fringe at the rim.)
- `feGaussianBlur stdDeviation=frost` → `feColorMatrix type=saturate values=sat`.

### Caching / application
- Cache key `"<preset>:<w>x<h>r<r>"` → `{id, ready:Promise}`; never evicted; identical-size elements share a filter.
- Apply: once `ready` resolves, if the element still wants that id and is connected, set inline
  `backdrop-filter: url(#lgN)` (overrides the CSS blur stack; the SVG chain provides its own blur/saturate).
- Registration: every `.glass` and `.stat` (initial scan + MutationObserver on body subtree for added nodes).
  Opt-out with `data-lg="off"`. Each registered element is observed by one shared ResizeObserver.
- Batching: RO callbacks only enqueue into a Set; a `gsap.ticker` callback processes at most **3 elements per frame**.
  Skips elements < 12 px; unobserves disconnected ones.
- **Perf watchdog** (not in record mode): samples frame deltas on the ticker (ignores hidden tab and gaps > 250 ms);
  after 240 samples takes the 75th percentile; if > 26 ms → "lite" mode: `html.lg-lite`, re-queue all; in lite mode only
  `chrome` surfaces keep the SVG filter, others have the inline style removed (fall back to CSS blur). One-shot.

### Pointer effects on glass
- **Glint** (fine pointer + hover only): `pointermove` (passive) finds closest `.glass:not(.glass--thick)`, stores
  pointer coords relative to it; the ticker writes `--gx/--gy` (px) once per frame. Switching element/leaving document
  removes the vars. CSS paints a 260px radial gradient at (`--gx`,`--gy`) using `--glint` → transparent 70%
  (defaults −400px = off-screen).
- **Press feedback** on `pointerdown` (primary button, motion allowed, not inputs/contenteditable/`.tk-card`):
  - Interactive targets (`.btn, .ibtn, .tbtn, .seg__btn, .nav__item, .tab, .tabbar__search, .search-pill, .island__btn,
    .sw, .wp, .side__me, .pinned a`, not disabled): **squash** (scaleX 1.07 / scaleY 0.9 in 0.11 s power2.out, then elastic
    back `elastic.out(1.15,0.32)` 0.7 s) + small ripple.
  - Else any `.glass:not(.glass--thick)` outside `.side/.toolbar/.tabbar`: large ripple only.
  - **Ripple**: append `span.ripple-wrap` (abs, inset 0, overflow hidden, inherits radius; host made `position:relative`
    if static) containing a 20px `span.ripple` with a ring-shaped radial gradient (transparent 38% → `--ripple` 62% →
    transparent 72%). Placed at pointer, scaled from 0.2 to `min(farthestCornerDist×2.2/20, 30 | 60)`, opacity 0.9→0
    (buttons, 0.75 s) or 0.55→0 (surfaces, 1.1 s), power2.out; removed on complete.

### CSS fallbacks
- No backdrop-filter support → `.glass, .stat { background: var(--glass-solid) }`.
- `prefers-reduced-transparency` and `html.is-solid` blocks exist but their minified contents look like a lightningcss
  rule-merge artefact (they repeat the base glass background + `.stat` box props). Intended behaviour per Settings copy:
  "Solid surfaces, no frost" → implement as opaque `--glass-solid` background, no backdrop-filter, and skip the JS filter.

---

## 5. Global UI

### Command palette / finder (`dialog#finder`)
- Open: `⌘K`/`Ctrl+K` (toggle, works even inside inputs), `/`, `#btn-search`, `#btn-search-m` (icon bounce first).
  On open: close popovers, clear query, select index 0, render, `showModal()`, reveal bar + list (clip reveal y −14,
  from 0.5, stagger 0.06), stagger options in (y 8, 0.025), focus input.
- Close: Esc (`cancel` prevented → animated), backdrop click, selection. Close = clip-collapse bar+list 0.16 s then `close()`.
- Result building (case-insensitive substring):
  - Pages: all 7 filtered by title (max 4 when empty query, 7 otherwise) → navigate.
  - Empty query only — Actions: "New task" (opens task modal), "Start a focus session"/"Focus is running" (meta "N minutes").
  - With query: Tasks (non-history, title match, max 5; meta "Project · Status"; lead = project icon) → `#/tasks/id`;
    Projects (name/summary, max 4) → `#/projects/id`; People (name/role/team, max 4, lead avatar, meta "role · city")
    → `#/team/id`; Calendar (title, sorted by |start − now|, max 3) → opens event drawer.
- Render: group header `li.finder__group` when group changes; options `li.finder__opt[role=option][id=fo-i][aria-selected]`
  with lead, label (match wrapped in `<mark>`), meta, chevron `.go` (visible when selected). Empty state:
  "Nothing matches "q"" / "Try a task, a project or a name." Input keeps `aria-activedescendant`.
- Keys: ↑/↓ wrap + scrollIntoView nearest; Enter runs. Hover (pointermove) moves selection without re-render.
  Selected option is filled with `--accent` and white text.

### "+" create menu (`#btn-new`, key `N`)
Menu: New task, New event, New project, separator, "Focus for N min" / "Focus is running". If current route is
`#/projects/<id>`, task/event are pre-filled with that project.

### Theme toggle (`#btn-theme`)
Icon bounce, then toggles resolved theme dark↔light (stores explicit value). aria-label "Switch to light/dark theme"
kept in sync via look-store subscription.

### Notifications (`#btn-bell`)
Popover (`pop--wide`, label "Notifications"): header "Notifications" + ghost "Mark all read" (disabled if none unread);
rows `a.pop__row[.is-unread][href]` with avatar (or bell lead), bold text, relative time. Unread rows get an accent dot
(::before) and extra left padding. Click row → mark read, close (link navigates). Mark-all → update in place.
Badge `#bell-badge` hidden when unread = 0; bell aria-label "Notifications, N unread".

### Account menu (`#btn-me` align start, `#btn-me-top` align end)
Settings · Keyboard shortcuts · — · Light / Dark / Match system (menuitemradio with check) · — · "Reset demo data"
(danger; confirm modal "Reset demo data?" → reseed, toast, `location.reload()`).
`#tab-more` menu: Insights, Team, Settings.

### Keyboard shortcuts (ignored in inputs, with modifiers, or when any dialog is open)
`⌘K`/`/` search · `N` create menu · `T` new task · `F` start focus (if none) · `G` then `H/T/C/P/I/M/S` within 1.2 s
→ home/tasks/calendar/projects/insights/team(M)/settings · `?` shortcuts drawer · `Esc` collapses a focused card.
Shortcuts drawer renders a `dl.keys` list with `kbd` chips.

### Island (dynamic-island toast + focus timer)
- One fixed black box (`.island`, 440×168 max, centred top 10px, z 95) whose visible shape is a **clip-path inset**
  animated through a proxy `{w, h, dx}`: `inset(0 (W−w)/2−dx  H−h  (W−w)/2+dx  round min(h/2,44))`.
  Mode sizes: compact 204×38, note 384×62, full 440×168; hidden collapses to 120×34.
- Mode change:
  - → hidden: proxy to 120×34 (0.35 s power3.in) and body fades out y −12 (0.3 s, delay 0.1).
  - from hidden: snap proxy to 120×34, fade body in from y −14 (0.3 s), then grow to target.
  - grow: 0.8 s (full) / 0.7 s; ease `elastic.out(1, 0.72)`, except compact-from-non-hidden uses `back.out(1.6)`.
  - Sub-panels (`compact/note/full`): active one fades/scales 0.9→1 (0.42 s, delay 0.12–0.16, origin top centre,
    top-left when docked, top-right when right-anchored); others fade to 0/scale 0.94 in 0.14 s; inactive get `inert`.
  - Toggles `.is-open`; sets `data-mode`.
- Responsive placement (recomputed on resize/mode change):
  - Phone (≤ 760): compact mode "docks" to the left of the toolbar tools: width = clamp(toolsLeft − islandLeft − 10, 96, 204),
    shifted left by dx; `.is-docked`, `html.island-docked` (hides `.toolbar__title`), `.is-narrow` (< 150 px hides the "Focus" label).
  - Wide (≥ 1360): `.is-right` (anchored right at top 86px); `--isl-w` = compact width + 16 when a session runs (reserved
    in `.head__lead` padding); in compact mode the island tweens to x = −(toolsWidth + 12), y = −61 (sits in the toolbar row
    left of the tools), else back to 0,0.
- **Toast API** `notify(msg, {undo?, ico="check", tone="ok"|"info"|"warn", hold?})`: renders icon circle
  (ok green #30d158, info indigo #6e6af0, warn orange #ff9f0a), message (2-line clamp), optional "Undo" button; enters note
  mode; auto-dismiss after `hold ?? (undo ? 5 : 2.6)` s → back to compact if a focus session runs, else hidden.
  Undo click: cancel timer, dismiss, run callback. This is the only toast system.
- **Focus timer UI**: compact = small progress ring (r 9, stroke-dasharray = circumference, dashoffset = C×(1−progress)),
  "Focus" label, mm:ss in orange `#ffb340`. Full = large ring, "Focus session" + task title (or "N-minute block"), big time
  (40px), buttons "+5 min", round pause/play, round stop (red). Paused → times dim to 60% white. Click compact → full;
  pointerdown outside or Esc → compact. Button presses get a scale 0.86→1 `back.out(3)` pop.
  Events: start → compact + note "Focus started — notifications are held" (hold 1.1 s); stop → "Focus session ended";
  done → "Focus complete — take a short break"; +5 → "Added 5 minutes".
- Init (`dc`, at boot +1.4 s): ResizeObserver on island, everything hidden/inert, restores compact if a session is persisted.

### Popover system
`openPopover(anchor, content, {cls, align: start|center|end, label, onClose})`:
- Toggle: same anchor again closes. Only one popover at a time.
- Creates `div.pop.glass.glass--thick` in `.pop-layer`, `role=dialog` if labelled; anchor `aria-expanded=true`.
- Placement: x by align (start = anchor.left, center, end = anchor.right − width), clamped to 12px viewport margins;
  below anchor (+10px) unless it would overflow and there's room above; transform-origin at anchor centre / edge.
- Reveal: clip reveal from 0.55 with y ±8 (direction depending on above/below).
- Closes on outside pointerdown (capture), Esc (refocus anchor), window resize, any scroll outside the popover.
  Close = clip-collapse 0.16 s, remove, `aria-expanded=false`, `onClose`.
`openMenu(anchor, items, {align})`: items `{label, icon?, checked?, danger?, onSelect}` or `"-"` separator;
`role=menu`, `menuitem`/`menuitemradio`, focus first, ↑/↓ cycle, stagger in (y 6, 0.02); selecting closes then runs.

### Modals / sheets
- Phone detection: `max-width: 760px`. On phone, `.modal` and `.drawer` become bottom sheets (full width, top radius 30,
  `span.grabber` visible).
- Open helper: `showModal()`, then x-slide (expo.out 0.6) + clip reveal (from 0.5, y offset). Close helper: guards
  double-close via `data-closing`, tweens x/y away + clip-collapse 0.24 s, then `close()` and clear props.
  Dialog `cancel` (Esc) and backdrop click route to the dialog's own close function.
- **Form modal** `formModal({title, sub?, submit, danger?, fields[], onSubmit})` in `#modal`:
  `form.mform` → header grid (close ibtn | centred title/sub | submit button accent/danger), `div.mform__grid` 2 cols
  (1 on phone) of `label.field[.field--wide]` with `field__label`, control (text/date/time/number/select/textarea), `field__hint`;
  `p.mform__err[role=alert]`. Submit: first empty `[required]` → "<Label> is required.", focus + horizontal shake
  (x −6 → 0 elastic). `onSubmit(values)` may return an error string. Fields stagger in. Autofocus first field on fine pointers.
  Enter offset: y 30 (desktop) / 120 (phone); exit y 16 / 80.
- **Confirm** `confirm(title, sub, label="Confirm", danger=true) → Promise<boolean>` built on the form modal with no fields.
- **Drawer** `openDrawer(html, {label, onMount, onClose})` in `#drawer`: right-side panel (inset 14px, 480 wide) on desktop
  (enter x 70, exit x 48), bottom sheet on phone (enter y 120, exit y 80). Content gets a close button; children stagger in.
- Ready-made creators: **New task** (title*, project [non-done], assignee, priority, due date [+2 days], status, estimate 1–40 h;
  new tasks get a negative fractional `order` so they sort first; toast with Undo), **New event** (title*, date, start time
  [next half hour ≥ now+1h], length 15–120, type, project, place; attendee = me), **New project** (name*, summary, lead,
  colour hue, target date [+30 d], icon; status planning, starred; navigates to it).
- **Task drawer** (`pane:task` CustomEvent with task id, or direct call): project chip + priority, title, status segmented
  control, meta grid (assignee, due with late styling, estimate, project link), subtasks (checkbox list, count badge, add form),
  comments (list + post form), footer: "Focus on this" (closes drawer, starts focus bound to task), Mark done/Reopen, delete
  (confirm → remove → toast with Undo restoring at original index).
- **Event drawer** (`pane:event`): kind pill, title, when/where (video or pin icon)/project/people, "Join call"/"Join now"
  (if video call; toast "Joining …"), Remove (toast with Undo).

### Card focus ("expand") mode
`[data-expand]` buttons inside cards: card is lifted into a fixed overlay (`.card.is-focus`, inset 9vh × max(4vw,24px),
thick glass) using **Flip**: insert a dashed placeholder `.card-ph` with the card's grid placement/height, `Flip.getState`,
add class, `Flip.from(state, {scale:true, 0.6 s power3.inOut})`, scrim fades in, children fade in staggered; dispatches
`card:resize` CustomEvents so charts can re-layout. Collapse (scrim click, Esc, navigation, second click): fade children out,
Flip back (0.5 s), remove placeholder. `html.has-focus` while open.

### Drag / reorder helpers
No Draggable. Core only provides a manual FLIP helper `flipList(container, mutate)`: record rects of `[data-key]` children,
run mutation, animate moved items from old offset (0.55 s power3.inOut), new items fade/scale in. Drag logic lives in
route chunks (e.g. tasks `.tk-card`).

### Shared exports to route chunks (descriptive names)
DOM/util: `qs!` (throws if missing), `qs`, `qsa`, `escapeHtml`, `icon(name, cls)` (inline 24-grid stroke SVG from an icon
dictionary of ~70 glyphs), `uid(prefix)`, `downloadFile(name, text, mime)`, `toCsv(rows)`, `rafBatch(fn)` (dedup per tick).
Motion: `gsap`, `Flip`, `prefersReducedMotion()`, `dur(x)` (0 when reduced), `splitTitle/revealTitle` (char split into
`.word > .ch`, chars rise from yPercent 115/rot 6, 0.85 s power4.out, stagger 0.022), `revealCards(els, {y,stagger,delay,from,kids})`
(clip-path inset from centre fraction `from` → fully open with −60px overshoot inset, y 26→0, scale .97→1, 0.9 s expo.out;
children fade up after 0.14 s), `collapseOut(els, done, {duration})`, `fadeUp(els, {x,y,stagger,delay})`,
`dealIn(els)` (y 40, alternating ±3° rotation, scale .94, `back.out(1.4)`), `popIn(el)` (scale from 0.6, `back.out(3)`),
`flash(el)` (`.is-flash` colour keyframe + bounce), `countTo(el, value, fmt)` (tweened number per element, WeakMap memory),
`bounceIcon(btn)` (svg scale .72→1), `magnetic(root)` (`.magnetic` elements follow pointer ×0.24/×0.3 via quickTo),
`hoverLift(root, y=-4)` (`[data-lift]`, enabled after boot), `animateCounts(root)`, `setCount(el, v)`, `headIntro(root, delay)`.
Renderers: `pageHead({title, sub, back, actions, stats[]})` → `header.head` (with `dl.head__stats` of `.stat` items:
label, `b[data-count][data-fmt]` value, suffix, delta tone up/down/plain), `card({id, cls, area, title, sub, tools, expand, body})`
→ `section.card.glass`, `iconBtn(icon, label, attrs, cls)`, `avatar(id, size xs|sm|md|lg|xl, {presence, extra})` (photo or
initials on a hue picked by char-code sum mod 7), `avatarStack(ids, size, max=4)` (+N), `presenceLabel`, `projectIcon(id, size)`,
`projectChip(id)`, `priorityPill(p)` (urgent gets flag icon), `emptyState(title, text, icon, extra)`, `highlight(text, q)`,
`segmented(label, [[value, html]], current, cls)` + `bindSegmented(el, onChange)` → `{place, select(value,{silent}), value}`
(arrow-key nav, RO re-place), `switchInput(name, checked, label)`, `moveLens`.
Overlays: `openPopover`, `closePopover`, `openMenu`, `formModal`, `confirm`, `openDrawer`, `closeDrawer`, `bindCardExpand`,
`focusedCard()`, `notify`, `newTask`, `newEvent`, `newProject`, `openTask`, `openEvent`, `setTaskStatus`, `toggleDone`.
Format: `fmtInt`, `fmtHours` (≥60 min → "1.5h"), `fmtDate` ("Mar 4"), `fmtTime`, `fmtTimeRange`, `relTime` ("just now", "5 min ago",
"in 3 h", "2 d ago", else date), `dayLabel` (Today/Tomorrow/Yesterday/"Mon, Mar 4"), `dueLabel` ("3 days late", weekday within a week), `initials`.
Look: `getLook`, `setLook(patch)`, `onLook(fn)`, wallpaper list, accent list, `wallpaperSvg(idPrefix, cls)` (for previews).
Store & focus: see §6.

---

## 6. Store / state

### Seeded data
Deterministic PRNG (mulberry32-style, seed **174**); "today" = local midnight; helper `at(dayOffset, hour)`.
- **members** (12): `{id, name, role, team (Product|Design|Engineering|Marketing), photo slug, presence (focus|meeting|online|away),
  city, tz, email, capacity (h/week)}`. Me = `lin` (Lin Zhao, Product Lead). Photos `/pane/photos/174-pane/<slug>[-sm].jpg`
  (`-sm` for sizes < 60px).
- **projects** (6): `{id, name, hue, icon, lead, members[], status (planning|active|review|done), start, due, summary,
  starred (tide, orbit), milestones[{id, title, due, done = offset<0}]}`; source rows give start/due day offsets.
- **tasks**: per project title list; status by position fraction (done < 0.5 < review < 0.62 < doing < 0.8 < todo; planning
  projects: first doing, rest todo; done projects all done; review projects never todo). Fields
  `{id "<proj>-<i>", title, projectId, status (todo|doing|review|done), priority (low|medium|high|urgent, weighted),
  assignee, due, created, doneAt?, est (h), order, subtasks[{id,title,done}] (every 3rd), comments[{id,who,at,text}] (every 4th, offset 1),
  notes}`. Plus 5 "my" tasks due today and 2 done today. Plus ~92 days of **history** tasks (`order: 1000`, done, generic titles)
  for charts — `order ≥ 1000` = excluded from boards/search/counts.
- **events**: rows `[title, workdayOffset, hour, minutes, kind (meeting|focus|review|deadline|social), projectId?, attendees, place?]`;
  day offsets count weekdays only. → `{id, title, start, end, kind, projectId?, attendees, place?}`.
- **focus** log: 92 weekdays × members random sessions `{id, at, minutes (25/50/90), who, taskId?}`; future sessions today removed.
- **activity** feed `{id, at, who, text, kind (task|comment|project|focus|event), projectId?, href?}` (capped at 60, newest first).
- **notices** `{id, at, who, text, href, read}` (3 unread).
- **settings** `{name, email, role, focusMinutes 25, breakMinutes 5, weekStart 1, notify{mentions, due, meetings, digest, focusEnd}}`.
- Root: `{version:1, seededOn:"Y-M-D", me, members, projects, tasks, events, focus, activity, notices, settings}`.

### Persistence (localStorage)
| key | content |
|---|---|
| `pane:v1` | whole state JSON. Loaded only if `version===1` **and `seededOn` equals today** — otherwise reseeded (demo resets daily so relative dates stay fresh). |
| `pane:look` | `{theme: dark|light|system, wall, accent, glass: tinted|clear, solid: bool}` (defaults dark/ash/blue/tinted/false) |
| `pane:focus` | active focus session `{minutes, taskId?, started, pausedFor, paused?}` or removed |
All writes wrapped in try/catch and skipped in `?record` mode (record mode also always reseeds and uses the GSAP clock).

### Pub/sub
Topics = state keys (`members, projects, tasks, events, focus, activity, notices, settings`) + wildcard `*`.
`subscribe(topic, fn) → unsubscribe`. `commit(...topics)` = persist the entire state, then call each distinct subscriber of
those topics plus `*` once. Mutations are done in place on the shared state object, then committed.
`resetDemo()` reseeds and commits all topics. `logActivity(kind, text, projectId?)` prepends to the feed.
Selectors: member/project/task by id, `me()`, `firstName`, `photoUrl`, `boardTasks()` (order < 1000), `projectTasks`,
`openTasks(assignee?)`, `projectProgress` (done fraction), `dueToday(who)`, `overdue(who?)`, `eventsOn(day)`,
`doneBetween(a,b,who?)`, `focusMinutesBetween(a,b,who?)`, `unreadCount`, `openHours(who)` (sum of est).
Task status change: sets/clears `doneAt`, logs "completed …" / "moved … to <Status>", commits tasks+activity.

### Focus timer store
Separate tiny emitter (`start|pause|resume|tick|stop|done`). Elapsed = `(paused ?? now) − started − pausedFor`;
remaining = minutes×60000 − elapsed; progress = elapsed / total. Ticker emits `tick` once per whole second change;
at 0 logs a focus entry (full minutes) + activity and emits `done`. Stop logs elapsed whole minutes if ≥ 1. `+5` adds minutes.

### Look store
In-memory merge of saved look; `setLook(patch)` persists and applies (`html[data-theme|wall|accent|glass]`, `.is-solid`,
`meta theme-color` = `#0a0a0c` dark / `#e4e4ea` light), notifies listeners. Re-applies on system scheme change when theme = system.

---

## 7. CSS architecture

### Tokens (`:root`)
Fonts: system SF stack then Inter. Sizes 12/13/15/17/22, title `clamp(34px, 2.2vw+14px, 58px)`. Radii 30/24/18/12.
`--gap clamp(12..20)`, `--gutter clamp(14..32)`, `--side-w 252px`, `--frame 1840px` (max app width, centred via
`--frame-left/right`), `--main-left = frame-left + side-w + gutter`. Easings: `--ease cubic-bezier(.22,.8,.24,1)`,
`--spring cubic-bezier(.34,1.45,.55,1)`. Palette hues blue/purple/pink/orange/green/teal/indigo/yellow (+ brighter dark
variants), ring colours (tasks/focus/meet), `--danger`. `.hue--X { --hue: var(--X) }` helper classes.

Per theme (`[data-theme]`): `--bg, --text, --text-2/3` (alpha inks), `--glass` = `rgb(white|#1a1a24 / var(--glass-a, .32|.42))`,
`--glass-chrome` (alpha `--chrome-a` .26|.36), `--glass-thick` (~76%/86% opaque), `--glass-solid`, `--blur` 12|14,
`--blur-thick` 28|30, `--sat` 190%|175%, `--bright` 1.06|.95, rim colours `--rim-hi/mid/lo`, `--sheen`, `--glint`, `--ripple`,
`--depth` (stack of 5 inset shadows: top 1px highlight, bottom 1px, soft inner top-left glow, inner bottom-right glow, inner
bottom shade), `--shadow`/`--shadow-lift` (tight + long soft drop), fills `--fill/--fill-2/--fill-hover`, `--sep`,
`--lens/--lens-glow/--lens-ring`, `--av-ring`, `--well`, `--scrim`, gel button tokens `--gel-hi/lo/rim/under/edge`.
`[data-glass="clear"]` lowers `--glass-a/--chrome-a` (.14/.12 light, .20/.18 dark); `tinted` = defaults.
`[data-accent]` (blue, purple, pink, orange, green, graphite) sets `--accent` (fill) and `--accent-ink` (text/icons; light
ink in dark theme); graphite also sets `--switch-on` green. `--accent-soft` = 14% color-mix.

### Wallpapers (`data-wall`)
`.wall` is fixed, z −1, `contain: strict`, base `linear-gradient(135deg, --wbg1, --wbg2)` (also on body, fixed). JS injects
one SVG (viewBox 1600×1000, `xMidYMid slice`). Gradient stops reference CSS vars via `style="stop-color:var(--…)"` so
switching walls/themes needs no re-render. Layers:
1. Full rect, gradient bg (`--wbg1→2`).
2. Top-left swoosh shape (gradient a), top-right blob (gradient d), lower wave band (gradient b), bottom wave (gradient c) —
   each linear gradient uses its own direction.
3. A translucent white ribbon following the main wave + white stroke lines along shape edges (opacity `--wline`, default 1).
4. 12 "bubbles": circles filled with a radial rim-highlight gradient, white stroke, plus a rotated white ellipse specular
   highlight (group opacity `--wbub`, default 1).
Walls: `ash`, `sand`, `sage` are flat (all ten vars equal, `--wline:0; --wbub:0`); `aurora`, `smoke`, `tide`, `bloom`, `ember`,
`grove`, `dusk` are patterned with 10 colours each per theme (dark aurora/smoke dim lines/bubbles to .6/.55–.6).
Selectors cover both `[data-theme=dark][data-wall=x]` and nested (for settings previews).

### `.glass` base
- `background`: three layers — pointer glint radial (260px at `--gx/--gy`), 172° sheen linear (`--sheen` → transparent 34%),
  then `--glass` tint.
- `backdrop-filter: blur(--blur) saturate(--sat) brightness(--bright)` (replaced inline by the SVG filter on Chromium).
- `box-shadow: var(--depth), var(--shadow)`; radius `--r-lg`; `position: relative`.
- `::before` rim: absolute inset 0, inherited radius, `padding:1.25px`, conic-gradient from 300° cycling
  rim-hi → rim-lo → transparent → rim-lo → rim-mid (at 180°) → rim-lo → transparent → rim-lo → rim-hi, masked to a ring with
  the content-box/border-box `mask-composite: exclude` trick. (No `::after`.)
- Modifiers: `.glass--chrome` swaps tint to `--glass-chrome`; `.glass--thick` uses `--glass-thick` + `--blur-thick`.
- `.stat` is a lighter variant (own background/blur, shadow + 1px inset top rim, radius 18).

### Controls
- `.btn` pill 42px (34 for `--sm`), variants: `--accent` (glossy: top white gloss band + accent gradient, inset highlights, accent
  glow drop shadow, text shadow, hover brightness 1.06), `--glass` (gel: vertical `--gel-hi→lo` + inset rim/edge), `--ghost`
  (accent ink, soft accent hover), `--danger`; disabled 45% opacity. `.ibtn` 40px circle (+`--sm` 32, `--glass`). `.tbtn` 46px toolbar circle.
- `.seg` segmented: `--fill` pill track, padding 3; `span.seg__pill` uses lens tokens and is moved by `moveLens`; buttons
  `aria-pressed`; `.seg--sm`.
- `.switch` iOS-style checkbox (51×31, knob spring translate 20px, knob widens on :active). `.check` round checkbox with
  spring-scaled tick. `.field` inputs: `--fill` background, 14px radius, focus ring = 2.5px accent-ink shadow; custom select chevron.
- Chips: `.pchip` (hue 16% tint + dot), `.picon` (gradient tile, 30% radius, sizes sm/md/lg), `.prio--*`, `.badge`, `.delta--*`,
  avatars `.av--xs..xl`, `.av-stack` (−8px overlap, ring), `.presence--*` dots (focus violet, meeting orange, online green, away grey).
- Charts base styles (`.chart*`, `.bars*`, `.donut*`, `.tone--*`, `.tone-stroke--*`, `.spark`) live in core CSS.
- Page header `.head`: grid areas `lead actions / stats stats`; `.stat` tiles.

### Layout
- Sidebar fixed (top/bottom 14px, left `--frame-left`, width `--side-w`, radius 32, column flex). Toolbar fixed top 14px
  from `--main-left` to `--frame-right`, `pointer-events:none` except children; `.toolbar__tools` 60px pill on the right.
  `.main` padding `88px frame-right 48px main-left`.
- **≥ 1360px**: `.main` top padding 14 (header sits beside the floating toolbar); head areas `lead lead / stats actions`;
  `.head__lead` reserves right padding = tools width (`--tools-w`, measured by RO) + 28 + island width; island right-anchored.
- **≤ 1100px**: icon rail (`--side-w: 76px`), labels/counts/pinned/me-text hidden, nav items 52×48; search pill collapses to icon.
- **height ≤ 640 / ≤ 440 (desktop)**: tighter nav, hide pinned/brand, scrollable sidebar.
- **≤ 760px (phone)**: sidebar hidden; toolbar at safe-area top with always-visible compact title pill (max 50vw) + 48px tools
  (search pill hidden, avatar `#btn-me-top` shown); floating **tab bar** at bottom (64px glass pill with lens + separate 64px
  search circle); main padding accounts for safe areas and tab bar (bottom ~128px); head stacks (stats as 2-col or 3-col grid);
  modal/drawer become bottom sheets with grabber; focused card inset 70/10/96.
- Phone landscape (≤ 760 & height ≤ 500): shows the icon rail instead of the tab bar.
- ≤ 480 / 380 / 374 / 360: smaller tab bar, hide theme button (≤ 374), smaller stat values.
- `(pointer: coarse)`: 44px hit targets, invisible ::after hit-area extenders, inputs ≥ 16px (no iOS zoom).
  `(hover: none)`: hover backgrounds disabled.
- `html:has(dialog[open])` locks scroll; `overscroll-behavior: contain` on overlays.

### Motion / reduced motion
- CSS: `prefers-reduced-motion` forces transition/animation durations to 0.01ms.
- JS: every helper wraps durations/staggers/delays in `dur()` (→ 0 when reduced) or skips tweens entirely (lens jumps,
  ripples/squash off, page exit skipped, island snaps). `gsap.globalTimeline.timeScale` is exposed for record mode.

### Boot sequence
On `document.fonts.ready` (or `window.PANE.enter()` in record mode): apply look, theme label, bell badge, task count,
pinned list, magnetic buttons, inject wallpaper SVG, start glass system, start press effects. Then intro timeline:
sidebar clip-reveal + x −30→0 (0.9 s expo.out); brand/nav items/side groups fade from x −10 (stagger .035) at 0.15 s;
toolbar tools + tab bar clip-reveal from y −16 at 0.1 s; first route at 0.12 s; at 1.4 s enable hover-lift and init the island.
Record mode exposes `window.PANE = {enter, drive(clockFn), speed, route}` to drive GSAP from an external clock.

---

## Open questions
1. `is-solid` / reduced-transparency CSS blocks appear mangled by the minifier; JS glass gate ignores `is-solid`, so on
   Chromium the SVG filter may still be applied. Decide: solid mode should disable the JS filter and frost.
2. `html.lg-lite` has no CSS rules in core (maybe in route CSS or unused) — only JS behaviour is known.
3. `.sw`, `.wp`, `.tk-card`, `.next__rest` are referenced from core but defined in route chunks (settings swatches/wallpaper
   tiles, task cards, home "up next").
4. `pane:task` / `pane:event` CustomEvents are dispatched by route chunks (exact call sites not reviewed here).
5. The `charts` chunk (shared renderers for line/bars/donut/spark) is not covered by this document.
