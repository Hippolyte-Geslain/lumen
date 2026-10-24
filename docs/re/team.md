# Team route (`#/team`, `#/team/:id`)

Source studied: `team-DqS2YHvo.js`, `team-64NTyTji.css`, shared helpers in `index-Bn4EHT_o.js`.
Behavioral description only — re-implement from scratch.

Key design point: there is NO separate detail page. `#/team/:id` keeps the member grid rendered and opens the member's **profile in the shared side drawer** (`<dialog id="drawer">`, sheet from the bottom on ≤760px). Closing the drawer rewrites the hash back to `#/team` via `history.replaceState` (no new history entry, no hashchange).

## 1. Entry point / lifecycle

Exports `page`:
- `title(params)` → member name when `params[0]` resolves, else `"Team"`.
- `mount(el)` — store root, render grid (see below), bind team filter segmented control, wire horizontal-scroll affordance for the filter, enable hover-lift on cards, attach delegated click listener (`[data-msg]` → message popover; `[data-act=invite]` → invite modal), subscribe to `members` and `tasks`, start a 30-second self-rescheduling clock tick (GSAP `delayedCall(30)`) that refreshes every `[data-clock]` element's local-time text.
- `enter({ params, first, same })`:
  - If not `same`: if not first visit, fully re-render the grid (fresh DOM each re-entry); then play the intro.
  - If `params[0]` present and (it differs from the open profile or the drawer is closed): after a delay (0 if `same`, else 0.45s so the intro plays first) — and only if the hash still points at that member — open the profile drawer.
  - If no param and a profile is open → close the drawer.
- `leave()` — closes the profile drawer if open. (Only route in this set that implements `leave`.)
- No cleanup return.

### Intro
Timeline: header intro at 0 (split-letter title, sub/actions fade-up, stat clip-reveal + count-up); visible `.mcard`s clip-reveal at 0.1 (y 28, stagger .04). At 0.4: workload bars grow `scaleX 0→r` (1s power3.out, stagger .04); presence dots on card avatars pop (scale .2→1, back.out(3), stagger .03); `.mcard__info` children fade-up (y 6, stagger .012).

## 2. Layout

### Header
- Title "Team", sub "`{people} people · {teams} teams`".
- Stats: "Online now" (presence ≠ away) with suffix "/ {people}"; "In focus" (presence = focus); "Average load" (pct, mean of load/capacity across members).
- Actions: `.tfilter-wrap` (horizontally scrollable pill container, hidden scrollbar) holding segmented control "Team" (`tfilter`) with All, Product, Design, Engineering, Marketing; then `button.btn.btn--accent[data-act=invite]` with user-plus icon "Invite".
  - ≤760px: wrap takes full row; segmented control keeps intrinsic width (`min-width:max-content`); when content overflows to the right, class `is-more` applies a right-edge fade mask (last 64px). Clicking a segment scrolls it into view (smooth unless reduced motion).

### Grid
`div.tgrid`: `repeat(auto-fill, minmax(min(100%, 300px), 1fr))`, gap `var(--gap)`, align start. Members in store order. Empty state `.tgrid-empty` ("No one here yet" / "Invite someone to this team.", users icon) when no card visible.

Team → hue map: Product blue, Design pink, Engineering indigo, Marketing orange.

### Member card
`article.mcard.glass.hue--{teamHue}[data-key][data-sig][data-lift]` (hidden if filtered out). Grid gap 14px:
1. `.mcard__top` (flex wrap; is a size container `mtop`): lg avatar (photo `<img>` or initials gradient) WITH presence dot; `.mcard__id` → h3 `.mcard__name` with link to `#/team/:id` (ellipsis, underline on hover) + "You" badge (accent-soft) for the current user; role line. Team chip `pchip hue--x` (coloured dot + team name) aligned top-right. Container query (≤300px): chip drops under the name, indented 62px.
2. `.mcard__info` grid `auto | 1fr`:
   - presence label (`i.presence--{p}` dot + label "Online/In focus/In a meeting/Away"), or — for invited members with no photo — mail icon + "Invite sent".
   - right-aligned local time: sun icon (orange) during 7:00–18:59 local, otherwise moon (indigo); bold time "h:mm AM" (`data-clock` = member tz) + city.
   - under it (column 2, right): offset text — "Your time" (me), "Same time as you", or "Xh ahead/behind" (decimals for half-hour zones).
3. `.mload.mload--{ok|high|over}` panel (filled, radius 18px): header "Workload" + optional pill "Nearly full" (ratio > .85) / "Over capacity" (> 1); right "{h}h / {cap}h". 8px meter bar, fill is `scaleX(min(1, ratio))` with gradient of the level colour (green / orange / danger).
4. `footer.mcard__foot`: "{n} open task(s)" with tasks icon; actions: glass small "Profile" link (`#/team/:id`) and, except for me, a glass icon button (chat icon) `[data-msg=id]` labelled "Message {first name}" with `aria-haspopup=dialog`.

Card signature for diffing: name, role, team, presence, city, tz, photo, open hours, capacity, open task count.

### Profile drawer content (`.prof.hue--{teamHue}`, grid gap 18px)
- `header.prof__hero`: tinted gradient panel (hue 22% → 6%, 1px inset hue rim, radius 26px, right padding 56px to clear the drawer's close button) with xl (96px) avatar + presence dot, name (700 `clamp(22px,1vw+16px,28px)`), role, chips (team chip + presence label or "Invite sent"). ≤420px: stacks vertically.
- Only for me: "Your status" label + full-width segmented control (`prof__seg`, equal-width buttons) Online / Focus / Away.
- `dl.tp__meta.prof__meta`: Email (mail icon + accent `mailto:` link), Local time (sun/moon + live clock · city).
- `.prof__stats` filled panel (radius 22px): 92px ring (r=40 in 100 viewBox, stroke 9, track `--well`, arc level colour, value `round(ratio*100)%` + "load") and numbers list: Workload "{h}h of {cap}h", Focus this week (sum of focus minutes since Monday 00:00, formatted "Xh"/"X.Yh"/"Nm"), Open tasks.
- Sections `section.tp__block` each with header h3 + count badge:
  - Open tasks (sorted by due): up to 6 rows `button.prof__row[data-task]` (project icon sm, title, "{due label} · {project name}" — red when overdue, priority badge if high/urgent); if more than 6, ghost link "{n} more on the board" → `#/tasks`. Empty: check icon "Nothing open. Free to help."
  - This week: events this calendar week (Mon–Sun) the member attends, excluding kind `focus`, up to 5: `button.prof__row[data-event]` with day tile (weekday short + date; hue 16% bg, 40×44, radius 12) and title + "Today/Tomorrow/Mon, Oct 3 · 9:30 AM". Empty: "A clear week."
  - Projects where member is in `members` or is lead: links `a.prof__proj` → `#/projects/:id` (icon, name, "Lead"/"Member", chevron-right). Empty: "Not on a project yet."
- Footer (not for me): accent "Message {first}" button `[data-msg]` + glass "Email" mailto link.

## 3. Interactions

- **Filter**: segmented control (click, arrow keys wrap, sliding pill). Same Flip filtering as Projects: hiding cards clip out (0.2s), GSAP Flip on remaining (0.65s power3.inOut), newly shown cards clip-reveal (y 18, stagger .04, delay .1) and their workload bars grow from 0 (delay .3).
- **Hover lift**: `data-lift` cards rise 4px on hover (fine pointer only).
- **Message popover** (`[data-msg]` on card or drawer): icon-pop on the trigger (scale .72→1, back.out(3)); opens a shared anchored popover (`.pop.glass.glass--thick.pop--msg`, width `min(340px, 100vw−24px)`, aligned to trigger's right edge, flips above if no room, clip-reveal in) containing a form: "To {name}" row with avatar, textarea (placeholder "Write to {first}…", rounded 16px, min-height 84px, autofocus on fine pointer), hint "{their local time} for {first}", accent "Send" button. Submitting empty → focus + horizontal shake (x −6 → 0, elastic.out(1,.3)). Ctrl/Cmd+Enter submits. On send: popover closes (focus returns to trigger), info toast "Message sent to {first}" (chat icon). Nothing is stored. Popover closes on outside pointerdown, Escape, resize, or outside scroll; clicking the same trigger toggles it closed. `aria-expanded` maintained on trigger.
- **Invite modal** (`[data-act=invite]`): shared modal form "Invite someone" / sub "They join as soon as they accept." / submit "Send invite". Fields: Name* (wide, placeholder "Sam Rivera"), Email* (type email, wide), Role (placeholder "Product Designer"), Team select (default = current filter or Product). Validation: required fields (error line + shake), regex email check → "That email doesn't look right.", duplicate email (case-insensitive) → "Someone with that email is already on the team." On success: push member `{ id: generated "m…", name, role || "Teammate", team || "Product", photo: "", presence: "away", city/tz copied from me, email, capacity: 32 }`, emit `members`, toast "Invite sent to {first}" (mail icon) with Undo (removes member). After 0.3s, scroll the new card into view. New members show initials avatar and "Invite sent" instead of presence.
- **Profile drawer** open (`#/team/:id` or card name / Profile link): unknown id → `replaceState('#/team')` + warning toast "That person isn't on the team". Drawer opens (shared: dialog `showModal`, slides from x +70 on desktop / y +120 on mobile, clip-reveal; children fade-up y 14 stagger .05). On mount: binds status segmented control (if me), animates ring arc 0→value (1.2s, delay .25, power3.inOut), pops hero presence dot (delay .45). Clicks inside: `[data-task]`/`[data-event]` first rewrite hash to `#/team` (so the profile won't reopen) then open the task drawer / event view (replacing the drawer content); `[data-msg]` opens the message popover. Closing (close button, Escape/cancel, backdrop click) → if hash still starts with `#/team/`, replaceState to `#/team`.
- **Your status** (me only): change presence → emit `members`; hero presence dot class/title updated with a pop (from .3); presence label re-rendered; toast "You're now {online|in focus|away}" (icons check / focus / moon) with Undo (restores and re-opens the profile if still open).
- **Live updates**: on `members` or `tasks` → keyed reconcile of cards (new cards appended + revealed + bars grown; changed cards re-rendered with bar morph from old to new ratio (0.8s power3.inOut); removed cards clip-out then removed; if a new card is hidden by filter, reset filter to All); header sub and stats count-tween with a flash bump; "/ N" suffix updated. If the profile drawer is open, its hero presence dot class is refreshed.
- **Clock**: every 30s all `[data-clock]` elements (cards and drawer) recompute local time text.

## 4. Data

- Members (12 seeded) `{ id, name, role, team: Product|Design|Engineering|Marketing, photo (slug; photos served from a `/pane/photos/...` path, "-sm" variant for small sizes), presence: online|focus|meeting|away, city, tz (strings like "GMT", "GMT+1", "GMT+5:30", "GMT−6" with a Unicode minus), email, capacity (hours/week: 28/32/36) }`. Current user `me = "lin"` (Lin Zhao, Product Lead, London, GMT).
- Seed presences: 6 online, 2 focus, 2 meeting, 3 away → "Online now 9/12", "In focus 2".
- Time zone math: parse `GMT[+|-|−]H[:MM]` into minutes; member local time = now + (memberOffset − myOffset); "day" = 7 ≤ hour < 19.
- Workload hours = sum of `est` on the member's open (status ≠ done, order < 1000) tasks; level: ratio > 1 over, > .85 high, else ok.
- Focus this week: sum of focus session minutes from Monday 00:00 of the current week until now.
- No route-specific localStorage; changes go through the store (`pane:v1`).

## 5. Notable CSS

- `.mcard`: radius `var(--r-xl)`; background radial hue glow anchored top-RIGHT (110% 60% at 100% 0%, hue 16% → transparent 60%) over `var(--glass)`; padding `clamp(16px, .6vw+13px, 20px)`.
- `.mcard__name` 650 17px display; "You" badge 20px tall accent-soft/accent-ink.
- `.mload` uses `--lv` level colour (green / orange / danger); bar 8px with gradient (lv 60% → lv); head pill `em` with lv 20% bg.
- `.mcard__where .ico` orange (day) / indigo (night via `[data-day=false]`).
- `.pop--msg` padding 14px; `.msg__text` radius 16px, no resize.
- `.prof__hero` gradient panel radius 26px; `.prof__stats` radius 22px; ring 92px stroke 9 rotated −90°.
- `.prof__row` / `.prof__proj` radius 14px, padding 8px, hover `--fill-hover`; `.prof__day` 40×44 tile.
- Coarse pointer: card action buttons 44px; profile rows min-height 48px; name link and mailto links get expanded hit areas.
- Shared `.glass` material (index CSS): layered background (pointer-following radial "glint" at `--gx/--gy`, 172° sheen, translucent `--glass`), `backdrop-filter: blur() saturate() brightness()`, inset depth + drop shadow, radius `--r-lg`, and a 1.25px conic-gradient rim drawn with a masked `::before`.
