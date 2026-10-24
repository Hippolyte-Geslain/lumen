# Route: Tasks (`#/tasks`, `#/tasks/{taskId}`)

Source: `tasks-BvvKz7Xh.js` + `tasks-CbJGeki3.css`. For the shared page contract, store, card, segment, popover/menu, drawer, modal and toast, see `home.md` §0.

## 1. Entry point

```
page = {
  title: "Tasks",
  mount(el)  { O = el; render(); wire(); },
  enter({params, first, same}) {
    if (!same) intro(first);
    const id = params[0];
    if (id) delayedCall(same ? 0 : 0.45, () => openTaskDrawer(id, { onClose: () => {
              if (location.hash.startsWith("#/tasks/")) history.replaceState(null, "", "#/tasks"); } }));
    else if (same) closeDrawer();      // navigating from /tasks/x back to /tasks closes the drawer
  },
  leave() { if (drag?.on) dropDrag(true /*instant*/); else if (drag) cancelPress(); }
}
```

The task drawer is deep-linkable. Card clicks set `location.hash = "#/tasks/{id}"` instead of opening the drawer directly.

**Module state:**
- `view`: `"board" | "list"`, persisted in `localStorage["pane:tasks-view"]` and defaulting to board.
- `sort`: `"due" | "prio"`, default due. Memory only.
- `showAllDone`: false.
- `dirty`: false.
- `filter`: `{project:"", mine:false, prio:"", q:""}`.
- `collapsed`: a `Set` that starts as `{"done"}` and controls which list groups are collapsed.
- `DONE_LIMIT = 8`.

The working set is the **active tasks**: `tasks.filter(t => t.order < 1000)`.

Filter predicate: the project matches, mine means assignee = me, the priority matches, and `q` is a substring of `"{title} {project name} {assignee name}"`, lowercased.

## 2. Layout

```
header.head
  title "Tasks", sub "{open} open across {n} project(s)"
  stats: open "Open" | week "Due this week" | late "Overdue" (.is-alert → red value when >0) | done "Done this week"
  actions: seg.tk-viewseg [board: icon+“Board”, list: icon+“List”] + btn--accent [data-act=new] “New task”
div.tk  (grid, 1 column, gap var(--gap); `.tk [hidden]{display:none!important}`)
  div.tk-bar.glass        — filter bar (pill)
  div.tk-board            — 4 kanban columns (board view)
  section#tk-listcard.card.glass.tk-listcard — grouped list (list view)
```

Stats definitions:
- `open`: not done.
- `week`: open tasks with due ≥ today and < week start + 7 days. The week start respects `settings.weekStart`, which defaults to 1 (Monday).
- `late`: open tasks with due < today.
- `done`: tasks with doneAt inside this week. This count **includes** historical tasks.

### Filter bar `.tk-bar.glass`

- Border-radius 999px (a pill), padding 7, flex-wrap, gap 8.
- Chips (`.tk-chip`): 40px tall, pill-shaped, `--fill` background, weight 600, 14.5px.
  1. `[data-f=project]` (`aria-haspopup=menu`): a lead icon (folder, or a 10px hue dot with a 3px halo once a project is chosen), the label "All projects" or the project name (max 22ch, ellipsised), and a caret.
  2. `[data-f=mine]` (`aria-pressed`): my xs avatar with a ring, then "Mine only".
  3. `[data-f=prio]`: a flag icon, the label "Any priority" or "{High} only", and a caret.
  - An active chip gets `.is-on`: `--accent-soft` background, `--accent-ink` text and an inset 1.5px ring.
- Search: `label.tk-find`, a pill holding a search icon and `input[type=search].tk-find__input` with the placeholder "Filter by title, project or person". On focus-within it shows a 2.5px accent ring.
- `button.tk-clear[data-f=clear]` "Clear", hidden when no filter is active.
- **Project menu:**
  - A custom popover (`pop--menu tk-pmenu`, align start), `role=menu`.
  - The first row is "All projects", shown with a conic-gradient 4-colour dot (`.tk-hue--all`).
  - Then one row per project that has active tasks: hue dot, name, a right-aligned "{n} open" count, and a check mark for the current choice.
  - The checked item is focused on open. Arrow keys cycle the items. Items fade in with a 0.02 stagger.
- **Priority menu:** a standard menu with "Any priority", a separator, then Urgent, High, Medium and Low as radio items.
- **Search behaviour:**
  - Input is debounced 140ms with `gsap.delayedCall`.
  - Escape clears a non-empty input and stops propagation.
- Turning on "Mine only" pops the avatar (scale .5→1).

### Board `.tk-board`

- A grid of `repeat(4, minmax(258px, 1fr))` with `overflow-x: auto` and hidden scrollbars.
- It uses negative margins and padding (`-14px -gutter -44px` / `14px gutter 44px`) so the card shadows aren't clipped.
- **Breakpoints:**
  - ≤1100px: `scroll-snap-type: x proximity`, and the columns snap to their start.
  - ≤760px: `grid-auto-flow: column`, `grid-auto-columns: 86vw`, mandatory snapping, gap 12, and the column min-height becomes 56vh.

**Columns:** one `section.card.glass.tk-col[data-status]` per status:

| id | name | dot |
|---|---|---|
| todo | To do | hollow ring in text-3 |
| doing | In progress | blue |
| review | In review | purple |
| done | Done | green |

- Each column is a flex column with min-height `min(70vh, 760px)` and padding 14/10/12.
- **Head:**
  - A 10px status dot (`tk-dot--{id}`, with a 3px 22% halo).
  - `h2.tk-col__name`: display font 650, 16px.
  - A count pill `.tk-col__count`: `--fill` background, 22px tall.
  - A plus icon button `[data-add=status]` pushed to the right with margin-left auto.
- `p.tk-col__empty`, shown when nothing is visible: a dashed 1.5px border, radius 18, min-height 92. Its text is one of:
  - "No matches" when a filter is active.
  - "Drag finished work here" for the Done column.
  - "Drop a task here" otherwise.
- `div.tk-col__list[data-list]`: a flex column with gap 10, min-height 72, position relative.
- Done column only: `button.tk-col__all[data-all]`, reading "Show all {n}" or "Show fewer". It is hidden when there are 8 or fewer done tasks.
- **Drop highlight:** `.tk-col::after` is an overlay with a 7% accent fill and an inset 2px accent ring, at opacity 0. It becomes visible on `.is-over` with a .25s transition.

**Sorting:**
- Not-done columns sort by `order` ascending, then by priority rank (urgent 0 … low 3).
- Done sorts by `doneAt` descending and is truncated to 8 unless "show all" is on.

**Card `article.tk-card.hue--{projectHue}[.is-done][data-key]`:**
- `--glass-thick` background, `var(--shadow)` plus an inset top rim highlight, radius 18, padding 12/12/12/14. It is a grid with gap 10.
- `cursor: grab` and `user-select: none`.
- Two pseudo-elements:
  - `::before` has a lift shadow at opacity 0, which goes to .8 on hover and 1 when lifted.
  - `::after` has an accent-coloured glow (`0 30px 46px -20px accent 55%`) that is visible only while lifted.
- Content:
  - `.tk-card__top`: a project chip (22px, ellipsised), a priority badge (high and urgent only, and not when done) pushed right, and the `button.tk-card__more[data-more]` "⋯" button. That button is 30px, round, and at opacity 0 until hover or focus-within. It is always visible on coarse or no-hover pointers, where it grows to 40px.
  - `h3.tk-card__title > button.tk-card__open[data-open]`:
    - Done tasks start with a 20px accent circle containing a check (`.tk-card__check`).
    - The title text is clamped to 3 lines.
    - An `::after` with inset 0 makes the **whole card clickable**, and also carries the focus-visible outline.
    - Done cards dim the text to text-2.
  - When there are subtasks, `.tk-card__subs` shows a 5px meter (`<i>` with scaleX(done/total) in `--hue`) followed by "a/b".
  - `.tk-card__foot` (600 12.5px, text-2):
    - A due item with an icon: a flag for late, styled `.is-late` (danger); a check for done; or a calendar otherwise. Due-today tasks are styled `.is-today` (accent-ink).
    - For done cards, the label shows `doneAt` as "Mon D".
    - A comment count with a chat icon.
    - The assignee's xs avatar with a ring, pushed right.
- **Render diffing:**
  - Each card element remembers a signature string: title|status|priority|assignee|due|doneAt|project|subsDone|subsTotal|comments. It is only re-rendered when the signature changes.
  - If a card transitions to done, a "completion" effect plays. See §3.

### List card `#tk-listcard`

- A card titled "All tasks", with the sub `<span data-list-sub>` set to "{n} on the board" or "{n} match(es)".
- Tools: a segment `seg--sm tk-sortseg` for Due / Priority.
- Inside, `div.tk-groups` holds one `section.tk-group[data-group]` per status:
  - `h3 > button.tk-group__btn[aria-expanded][aria-controls]`: chevron (rotated -90deg when collapsed), status dot, name, and a count badge `[data-gcount]`.
  - `ul.tk-rows#tkg-{id}`, which is `hidden` when the group is collapsed. Done starts collapsed.
  - When a filter is active, empty groups are hidden.
- `div.tk-list-empty` shows an empty state: a search icon, "No tasks match", "Try a different filter, or clear them all.", and a "Clear filters" glass button `[data-f=clear]`.
- **Row `li.tk-row[data-key]`:**
  - A grid of `22px | 1fr | minmax(0,200px) | 112px | 90px | 28px` with gap 14, min-height 52, radius 14. Rows are separated by an inset 1px top shadow, which is removed around the hovered row.
  - The cells are: checkbox `.check[data-done]`, `button.tk-row__title[data-open]` (ellipsised, accent on hover), then `span.tk-row__meta` (`display: contents`) holding the project chip, the due item (red with a flag when late), and the priority badge. The last cell is the sm avatar.
  - Done rows get a line-through title in text-3.
  - ≤900px: the grid becomes `"ck title who" / "ck meta meta"` and the meta wraps as flex.
- **List sorting:**
  - Done sorts by doneAt descending.
  - Otherwise sort by due then priority, or by priority then due, depending on the sort segment.

## 3. Interactions

**Root click delegation:**
- A capture-phase listener swallows clicks for 450ms after a drag ends.
- `[data-open]` sets the hash to `#/tasks/{id}`, which opens the drawer.
- `[data-more]` opens a menu on the card: one "Move to {Column}" radio item per status (the current one checked), a separator, then "Open task" with an arrow icon.
  - Moving puts the task at the **top** of the target column: it renumbers that column and inserts the task at index 0.
  - It then shows the toast "Moved to {name}" or "Done: {title}" with **Undo**. Undo restores a snapshot of every active task's `{order, status, doneAt}` and emits.
  - Focus is returned to the card's more button.
- `[data-add=status]` opens the New task modal with that status and the filtered project.
- `[data-act=new]` opens the New task modal with the filtered project.
- `[data-all]` toggles show-all-done and re-renders.
- `.tk-group__btn` collapses or expands the group:
  - The chevron rotates (0.45s back.out(2)).
  - Collapsing: the visible rows fade up (opacity 0, y -6, 0.16s, stagger 0.012), then `hidden` is set.
  - Expanding: the rows are unhidden and fade in (y 8, stagger 0.02).
- `[data-f]` handles the project menu, priority menu, mine toggle and clear.

**Checkbox (list view):** clicking it toggles `.is-done` on the row and pops the box. After 0.45s it calls `toggleDone`, which shows a toast with Undo.

**View toggle (board ↔ list):**
1. Persist the new value.
2. Collapse the visible elements of the outgoing view with the clip-path collapse (0.18s).
3. Swap the `hidden` attributes and render without animation.
4. Clip-reveal the new containers (y 18, stagger .05, from .8).
5. Fade up the visible cards or rows (y 12, stagger .018, delay .16).

**Board re-render (`renderBoard(animate)`):**
- If a drag is active, the re-render is deferred by setting a pending flag.
- **FLIP:** record each card's rect first.
- Cards that are no longer shown "leave":
  - They are pinned absolutely at their offset position with pointer-events off.
  - They are moved to the end of the list.
  - They fade and scale to .9 over 0.24s (power2.in) and are then removed.
- Existing cards are reordered with `insertBefore` and only re-rendered if their signature changed.
- Moved cards animate their delta to 0 over 0.55s (power3.inOut). A column that receives a card from elsewhere gets z-index 3 for 0.75s so the card can fly over the other columns.
- New cards come in from opacity 0, y 14 and scale .94, over 0.55s with back.out(1.6) and delay 0.1 + i*0.03.
- **Completion effect** for cards that just became done:
  1. The check pops: scale 0→1 and rotation -40→0 over 0.75s with back.out(3.4).
  2. A ring `span.tk-burst` (2px accent box-shadow) expands from scale .5 to 2.8 and fades out over 0.8s.
  3. The card pulses: scale up to 1.035 (0.15s), then back to 1 with elastic.out(1, .42) over 0.7s.
  - When the card also moved, the effect is delayed 0.5s.
- When a column's count changes, the count text flashes.

**List re-render:** the rows are re-rendered as innerHTML, then a FLIP runs (0.55s). New rows fade up 8px with stagger min(i,12)*0.015.

**Store subscriptions:** `tasks` and `projects` trigger a re-render of both views and the stats. If the view is hidden, it is marked dirty instead. Stat values count to their new numbers and flash. `.is-alert` is toggled on the late stat.

### Drag-and-drop (custom pointer events; no Draggable plugin)

`pointerdown` on `.tk-board` starts a press. It ignores non-primary mouse buttons, leaving cards and the more button. The press state is `{el, task, pointerId, mouse, x0, y0, px, py, rect, offsetY, on:false, slot, col, idx, col0, idx0, hold, vx, …}`.

1. **Activation:**
   - **Mouse:** the drag lifts once the pointer has moved more than 5px.
   - **Touch/pen:** a long-press of **0.28s** lifts the card (a `gsap.delayedCall`). The card shrinks to .975 while the press is held. Moving more than 10px before the lift cancels the press, which allows scrolling, and the card springs back to scale 1 (back.out(2)).
   - `pointermove`, `pointerup` and `pointercancel` are attached to `window`. A non-passive `touchmove` on the document calls `preventDefault` while dragging. The `contextmenu` event is suppressed during a press.
2. **Lift:**
   1. Kill tweens on the card and measure its rect.
   2. Insert a `div.tk-slot` placeholder of the same height in its place. The slot has a dashed 1.5px accent border at 55%, an 8% accent fill and radius 18.
   3. Move the card into a fixed full-viewport `div.tk-layer` (z 70, pointer-events none), positioned absolutely at its old left, top and width.
   4. Add `.is-lifted` to the card, `.is-over` to the source column, `html.tk-dragging` (forces `cursor: grabbing` and disables selection everywhere) and `.tk-board.is-dragging` (disables scroll-snap).
   5. Scale the card to 1.045 (0.5s back.out(2.4)) and give it an initial tilt of 2.5°.
3. **Move:**
   - The card's transform is set to `(px - x0, py - y0)`.
   - **Velocity tilt:** `vx` is smoothed as `vx*0.6 + (dx/dt)*0.4`, and the rotation is `clamp(-9, 9, 2.5 + vx*7)`, applied with `gsap.quickTo(rotation, 0.45s power3.out)`.
   - **Hit-testing:**
     - The target column is the one with the smallest horizontal distance to the pointer (0 when the pointer is inside it).
     - The insert index is the first card whose midpoint is below the dragged card's centre (`py - offsetY + h/2`), compensating for each card's in-flight y transform.
     - The **Done column always inserts at index 0**, because it is sorted by recency.
   - When the target changes:
     1. Move the slot there.
     2. Toggle `.is-over` between the columns.
     3. Update the empty placeholders.
     4. Pop the slot in (scale .94→1, back.out(2)).
     5. FLIP the siblings to their new positions (0.42s power3.out).
4. **Auto-scroll** runs on a GSAP ticker callback for the whole drag:
   - **Horizontal**, when the board overflows: the edge zone is min(72px, 16% of the board width), and the speed reaches 16px per frame at the very edge.
   - **Vertical**, on the window: the top zone is 96px; the bottom zone starts at innerHeight - 64, or -124 on screens ≤760px for the tab bar. The speed reaches 18px per frame.
   - The tilt velocity decays by ×0.85 per frame.
   - If any scrolling happened, the hit-test runs again.
5. **Drop:**
   1. Remove the listeners and the ticker, and block clicks for 450ms.
   2. Tween the card to the slot rect, with rotation 0 and scale 1, over 0.4s (power3.out).
   3. Replace the slot with the card and clear the inline styles.
   4. Unless the card was dropped into Done from another column, play a squash settle: scaleX 1.03 / scaleY .96 back to 1 over 0.65s with elastic.out(1, .45).
   5. **Commit**, but only if the column or index changed:
      - For a not-done target, renumber the column, then set the task's `order` to the midpoint of its neighbours' orders (±0.5 at either end, 0 when the column is alone) and renumber again.
      - If the status changed, call `setStatus`, which sets or clears doneAt and logs activity. Otherwise just emit `tasks`.
      - Show the toast with Undo, which restores the snapshot.
   6. Run any re-render that was deferred during the drag.
   - On `leave()`, the drop is applied instantly without animation.
- Under reduced motion, every visual tween is skipped but the logic is unchanged.

## 4. Enter animation

Only runs when `same` is false. If the view is dirty, it re-renders first.

- At 0: the page-header intro.
- At 0.12: clip-reveal `.tk-bar` together with the columns (board) or the list card (list), using y 30 and stagger 0.06.
- **Board:** for each column i:
  - The first visible cards fade up starting at 0.36 + i*0.07. This covers 10 cards with y 22 on the first enter, or 5 cards with y 12 afterwards, with stagger .05.
  - The subtask meters grow scaleX from 0 starting at 0.6 + i*0.07, over 0.9s with stagger .05.
- **List:** at 0.34, the group headers and rows fade up 10px with stagger .022.

## 5. Data notes

- **Status enum:** todo, doing, review, done, labelled "To do", "In progress", "In review" and "Done".
- **Priority enum:** low, medium, high, urgent. The badge `.prio.prio--{p}` shows a flag icon for urgent.
- `order` is a float. New tasks from the modal get a negative order so they appear at the top.
- The `order < 1000` filter excludes the historical done tasks.
- localStorage keys: `pane:tasks-view` (`"board" | "list"`), plus the global `pane:v1`.
