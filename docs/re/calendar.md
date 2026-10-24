# Route: Calendar (`#/calendar`)

Source: `calendar-BBHADzF1.js` + `calendar-Do5qSHKR.css`. For the shared contract, store, card, segment, drawer, modal and toast, see `home.md` §0.

## 1. Entry point

```
page = { title: "Calendar", mount(el){ root = el; render(); wire(); }, enter({first, same}){ if(!same) intro(first) } }
```

The route has no params and no `leave`.

**Module state** (memory only, nothing in localStorage):
- `view`: `"month" | "week"`, default month.
- `selected`: the selected day as a midnight timestamp, initially today.
- `cursor`: the anchor date. In month view it is the 1st of the shown month; in week view it is any date inside the shown week.
- `dirty`: set when a store change arrives while the view is hidden.
- `navTween`: the current navigation tween.

**Constants:**
- Week grid hours run from **8 to 19** (11 rows).
- The agenda shows at most **5** due tasks.
- The week start comes from `settings.weekStart`, default 1 (Monday).

**Event colour:** the project hue when the event has a project, otherwise a hue picked by kind:

| kind | hue | icon | label |
|---|---|---|---|
| meeting | indigo | users | Meeting |
| focus | purple | focus (moon) | Focus block |
| review | teal | sparkle | Review |
| deadline | pink | flag | Deadline |
| social | orange | chat | Team |

**Data used:**
- `events` (see home.md): grouped by day start, sorted by start time.
- `projects[].milestones` `{title, due, done}`: shown as flags on days.
- Active tasks (`order < 1000`): due on the selected day.

## 2. Layout

```
header.head
  title = month view: "October 2026"; week view: "October 2026" if week inside one month else "Sep – Oct 2026"
  sub   = "{n} event(s) this week" (current real week)
  actions:
    div.cal-nav[role=group]  — pill (fill bg, 42px, padding 3):
        button.cal-nav__btn[data-nav=-1] chevL ("Previous month|week")
        button.cal-nav__btn.cal-nav__today[data-nav=0] "Today"
        button.cal-nav__btn[data-nav=1] chevR
    seg.cal-viewseg [month “Month”, week “Week”]
    btn--accent [data-act=new]  calPlus icon + "New event"
div.cal[.is-week]
  section.card.glass.cal-monthcard   (month view)
  section#cal-agenda.card.glass.cal-agenda (month view, right column)
  section#cal-week.card.glass.cal-weekcard (week view)
```

**`.cal` grid:**
- Default: `minmax(0,1fr) minmax(300px,390px)`, `align-items: start`.
- In week mode (`.is-week`): a single column.
- ≤1280px: the right column becomes `minmax(280px,330px)` and the word " more" is hidden.
- ≤960px: a single column, and the agenda is no longer sticky.
- `.cal [hidden]{display:none!important}`.

### Month card `.cal-monthcard`

- `--cell-h: clamp(104px, 11.2vh, 136px)` and padding `clamp(12px, .6vw+8px, 18px)`.
- `div.cal-wd`: a 7-column weekday header (Mon…Sun ordered by weekStart). The labels are uppercase, 650 12.5px, letter-spacing .04em, text-2.
- `div.cal-stage` (relative) contains `div.cal-grid` (7 columns, `grid-auto-rows: var(--cell-h)`, gap 4) and an absolutely positioned **`span.cal-ring`** that marks the selection.
- **42 day cells**, always 6 weeks starting from the week start of the 1st. Each cell is `button.cal-day`.
  - **Modifiers:** `.is-out` (another month), `.is-today`, `.is-weekend`, `.is-past`.
  - **Attributes:** `data-day={midnight ts}`, roving `tabindex` (0 only on the selected day), `aria-pressed` = selected, `aria-current=date` on today, and a long `aria-label` such as "Monday, October 5, 2 events, milestone: X".
  - **Styling:** `--fill-hover` background, which becomes `--fill` on hover. Out-of-month cells are transparent. Radius 14, padding 7/6/6, flex column with gap 5.
  - `.cal-day__top` contains:
    - `.cal-day__n`, the day number in a 26px pill (display font 650 14px). Today's pill is accent with white text and an accent glow shadow. Weekend numbers are text-2; out-of-month numbers are text-3.
    - `+N more` when there are more than 3 events (the " more" word is wrapped in `.cal-more__w`).
    - Up to 2 milestone flags `.cal-flag.hue--x`: a 20px tile with radius 6, a 16% hue background and a flag icon, pushed right.
  - `.cal-day__evs`: up to 3 event pills `.cal-ev.hue--x`.
    - 18px tall, radius 6, 17% hue background, 600 12px text.
    - A 3×10 hue bar drawn with `::before`.
    - The text is ellipsised.
    - Past events use a 9% background and text-2.
  - `.cal-day__dots`: up to 4 hue dots, hidden on desktop.
- **≤620px (phone):**
  - `--cell-h: clamp(50px,13vw,64px)`.
  - Cells are centred. The event pills and "+more" are hidden, and **5px dots** are shown instead.
  - Only one flag is shown, as a 14px icon pinned to the top-right corner.

**Selection ring `.cal-ring`:**
- It has the selected cell's size and is positioned with transforms at the cell's offsetLeft and offsetTop.
- Its look is an inset 2px accent-ink ring plus a 4px 16% outer halo, radius 14. When a day has keyboard focus (`.cal-stage:has(.cal-day:focus-visible)`), the ring is thicker (2.5px and 5px at 30%). The cells themselves get no outline.
- **Moving the selection:**
  - Position tween over 0.6s with `elastic.out(1, .78)`.
  - At the same time, a scale "tap" with keyframes 0.92 (0.12s, power2.out), then 1 (0.55s, `elastic.out(1, .5)`).
- If the ring is hidden when it gets placed, it pops in (scale .8→1, opacity 0→1, 0.5s, `back.out(2.2)`).
- During navigation and view switches, the ring is hidden (opacity 0 over 0.12s) and "armed" again after a delay with a delayed call. A ResizeObserver on the stage re-places it without animation.

### Agenda card `#cal-agenda`

- Sticky at `top: 86px`.
- The title is the relative day: "Today", "Tomorrow", "Yesterday" or the weekday name, in display font 700 at 22px.
- The sub reads "{Month D} · {n} events" or "no events".
- Tools: a glass sm button "Add event" `[data-act=add]`.
- The body `div.cal-ag` (grid, gap 14) contains, in order:
  1. **Milestones** `p.cal-ms.hue--x`: a 14% hue background, radius 16, a flag icon, the bold title and "{Project} milestone" in small text.
  2. **Timeline** `ol.cal-tl` of `li.cal-tl__item.hue--x[.is-past][.is-live]`. Each item is a `button.cal-tl__btn[data-event]` laid out as a grid of `64px | 4px | 1fr` with gap 12, radius 16 and a hover fill. Its parts are:
     - `.cal-tl__time`: the start time in bold, plus the duration in small text ("30 min" or "1.5 h").
     - `.cal-tl__rail`: a 4px vertical bar in the hue. Past items fade it to .45.
     - `.cal-tl__body`: the title (15px, weight 620), an optional place line (a video icon for "Video call", otherwise a pin), and a foot line. The foot holds an xs avatar stack of 4, a kind pill `.cal-kind` (15% hue background, icon and label), and a red "Now" pill `.cal-live` while the event is live.
     - **Now marker** (selected day = today only): `li.cal-tl__now` is inserted before the first future event, or appended after all events. It shows the current time in red, 64px wide on the left, followed by a 2px red line with a 10px dot at its start.
     - With no events, the timeline shows "No events."
  3. **Due tasks** `section.cal-due`:
     - A top separator, then the heading "Due today" or "Due this day" with a count badge.
     - Up to 5 `li.cal-task` items, sorted with not-done first and then by due time. Each has a checkbox `[data-done]` and a `button.cal-task__t[data-task]` showing the title and a small line with a 7px project hue dot and the project name. Done tasks get a line-through.
     - If there are more than 5, a ghost link reads "{n} more in Tasks" and points to `#/tasks`.
- **Empty day** (no events, tasks or milestones): an empty state `.cal-free` with a calendar icon, "A clear day", "Nothing on the calendar[ today].", and an "Add event" button.

### Week card `#cal-week`

- The title is "Oct 5 – 11", or "Sep 29 – Oct 5" across months. The sub is "{n} events".
- Tools: the hint "Click an empty slot to add", hidden at ≤760px.
- The body is `div.cal-wk__scroll` (horizontal overflow, thin scrollbar) containing `div.cal-wk`.
  - `--hh: clamp(46px, 5.6vh, 60px)` is the hour height, and the minimum width is 660px.
- `.cal-wk__head` and `.cal-wk__body` share the grid `58px repeat(7, 1fr)`.
  - **Head:** an empty first cell, then one `.cal-wk__day[.is-today]` per day with the short weekday in small uppercase and the date number in a 28px pill. Today's pill is accent with white text, and its weekday label is accent-ink.
  - **Body:** height `calc(var(--hh) * 11)`, position relative.
    - `.cal-wk__hours` (sticky left, z 3) holds the labels "8 AM" … "11 AM", "Noon", "1 PM" … "6 PM". Each label is absolutely positioned at `top = i/11 * 100%`, right-aligned and shifted -50% vertically (except the first). On phones the labels become small glass pills on the left.
    - 7 × `div.cal-wk__col[data-col=dayTs][.is-today][.is-weekend][role=group]`.
      - Each column has a left border in `--sep` and hour lines drawn with `repeating-linear-gradient(to bottom, var(--sep) 0 1px, transparent 1px var(--hh))`. Today's column gets a 6% accent tint and weekend columns get `--fill-hover`.
      - `cursor: copy`.
    - **Event blocks** `button.cal-blk.hue--x[.is-past][.is-short][data-event]`:
      - Only events that overlap 8–19 are drawn. Each is absolutely positioned:
        - `top = (max(8, startH) - 8) / 11`.
        - `height` comes from an end clamped to [start + 0.25h, 19].
        - `left = lane/of` and `width = 1/of`, both as percentages.
      - **Overlap layout:** the events of one day are walked in start order and split into clusters. A new cluster starts when an event begins at or after the running max end. Within a cluster, an event takes the first lane whose last end ≤ its start, otherwise it opens a new lane. Every event in a cluster gets `of` = the cluster's lane count.
      - **Styling:** 20% hue background (30% on hover, 10% for past events), an inset 3px hue left bar, a transparent 2px border with `background-clip: padding-box` (this creates gutters between blocks), radius 12 and padding 6/8/6/9.
      - **Content:** the title in bold (650 12.5px, ellipsised). Unless the block is short, a second line shows "time · place".
      - `.is-short` applies when the duration is under 0.9h: the block becomes a single row with no time line.
    - **Now line** `span.cal-now` (today's column only, during 8–19): a 2px red line with a 10px dot that has a 3px 25% halo. Its `top` is a percentage refreshed every 60s by a recursive delayed call.

## 3. Interactions

**Root click delegation:**
- `[data-nav]`:
  - **-1 / +1:** the month view moves by a calendar month. The selection stays on today if today is in the new month, otherwise it moves to the 1st. The week view moves by 7 days; the selection becomes today if the new week is the current week, otherwise it shifts by 7 days.
  - **0 (Today):** if today is already in view, just select it. Otherwise jump there with a slide whose direction depends on where today lies.
- `[data-event]` opens the event drawer, which offers Join (for video calls) and Remove.
- `[data-task]` opens the task drawer.
- `.cal-day` selects that day. If the day is in another month (an out cell), the grid navigates to that month with a slide.
- `[data-act=new]` opens the **New event** modal:
  - Month view: the start is the selected day.
  - Week view: the start is `max(today, week start)`.
  - If the chosen day is today, the default start is the next half hour at least 1h ahead. Otherwise it is that day at 10:00.
- `[data-act=add]` (in the agenda) does the same for the selected day.
- **Clicking an empty slot in a week column** (mouse event, not on a block) opens New event with a pre-filled start:
  - The hour is `8 + floor(fraction * 11 * 2)/2`, clamped to [8, 18.5].
  - So the slot snaps to 30 minutes.

**New event modal fields:** title (required), date, time, length (15/30/45/60/90/120 min), type (kind), project (None or any active project), and place. The new event's attendees are `[me]`. Submitting shows the toast "{title} · {Today}, {time}" with Undo.

**Keyboard on day cells** (roving tabindex; the newly selected cell gets focus):
- ArrowLeft and ArrowRight move ±1 day; ArrowUp and ArrowDown move ±7 days.
- PageUp and PageDown move ±1 month.
- Home and End jump to the start or end of the selected day's week.
- Moving past the visible month triggers the slide navigation.

**Checkbox on agenda tasks:**
1. Toggle `.is-done` and pop the box.
2. After 0.35s, run `toggleDone` (with toast and Undo).

**View switch (month ↔ week):**
1. Hide the ring.
2. Set `cursor` to the selected day (week view) or the first of its month (month view).
3. Collapse the old cards with the clip-path collapse (0.18s).
4. Swap the `hidden` attributes and the `.is-week` class, then re-render.
5. Run the title split animation.
6. Update the aria-labels of the nav buttons.
7. Clip-reveal the new cards (y 18, stagger .06, from .8).
8. Then, depending on the new view:
   - **Week:** blocks pop in, and the scroller is scrolled so today's column sits at its offsetLeft minus 66px.
   - **Month:** the cells cascade, then the ring arms after 0.4s.

**Slide navigation (`slide(dir)`):**
1. Finish any running nav tween.
2. Animate the current grid (`.cal-grid` or `.cal-wk`) to x = -dir×44 and opacity 0 (0.17s, power2.in).
3. Re-render the grid.
4. Update the header title. If the text changed, it re-runs the per-character split reveal (chars rise from yPercent 115 with rotation 6, 0.85s power4.out, stagger .022).
5. Animate the grid in from x = dir×56 and opacity 0 to rest (0.6s, expo.out).
6. Month view arms the ring after 0.22s; week view runs the block pop at 0.12.
7. The agenda updates with its own transition: fade out (y 6, 0.12s), swap the content, then stagger the items in (y 10, stagger .035).

**Animations used:**
- **Block pop:** `.cal-blk` from opacity 0, y 14, scale .94 to rest over 0.6s with `back.out(1.7)`, stagger 0.025.
- **Month cell cascade:** `.cal-day` from opacity 0, y 10, scale .94 over 0.6s with `back.out(1.6)`, using a **grid stagger** `{grid:[6,7], from:"start", amount: 0.22–0.4}`.

**Store subscriptions:**
- `events` and `projects`: re-render the grid and the agenda, and update the header sub. If hidden, mark the view dirty.
- `tasks`: re-render the agenda, or mark the view dirty.

## 4. Enter animation

If the view is dirty, re-render first. Then:

- At 0: the page-header intro.
- At 0.12: clip-reveal the visible cards (y 30, stagger 0.08).
- **Month:**
  - Hide the ring.
  - Run the cell cascade at 0.3s with an amount of 0.4 on the first enter, 0.22 afterwards.
  - Arm the ring at 0.8s (first) or 0.6s.
  - At 0.42, the agenda items fade up (y 12, stagger .045).
- **Week:** at 0.35, the blocks pop and today's column is scrolled into view.

## 5. Notable CSS details

- Nav pill buttons are 36px (44px on coarse pointers), radius 999. The chevrons use stroke 2.2.
- Hue tinting is done throughout with `color-mix(in srgb, var(--hue) N%, transparent)`:
  - ev 17 / 9 / 8 (past and out)
  - flag 16
  - milestone 14
  - kind 15
  - block 20 / 30 / 10
- Danger red (`--danger`) is used for the now line, the "Now" pill and the now-marker text.
- The agenda is sticky. The month grid has fixed-height rows controlled by `--cell-h`.
- Typography: display font for the day numbers, titles and group headers; tabular numbers for times.
