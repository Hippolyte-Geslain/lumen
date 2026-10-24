# Settings route (`#/settings`, `#/settings/:section`)

Source studied: `settings-BKYvGRAH.js`, `settings-DCYnfzEW.css`, shared helpers + look/theme engine in `index-Bn4EHT_o.js`, theme tokens in `index-TQp-C7g7.css`.
Behavioral description only — re-implement from scratch.

## 1. Entry point / lifecycle

Exports `page = { title: "Settings", mount(el), enter({ first, same, params }) }`. No `leave`, no cleanup.

- `mount(el)`: renders everything once (header + nav + 5 section cards), binds the Theme and Glass segmented controls, and wires listeners: delegated `click`, `change`, `input`, `focusout`; subscribes to look changes (to re-sync controls), to focus-timer events (to refresh the "Start" cell), sets up scroll-spy observers and a ResizeObserver to re-place the nav lens.
- `enter({ same, params })`:
  - `same` (hash changed within settings): if `params[0]` is a valid section different from the current one → scroll to it.
  - otherwise: sync all controls to current look, refresh focus cell, play the intro; if `params[0]` names a section, after 0.5s (first visit) / 0.3s (re-entry) smooth-scroll to it; else current section = profile and lens placed without animation.
- Sections: `profile`, `notifications`, `appearance`, `focus`, `data` (deep-linkable as `#/settings/<id>`).

### Intro
Header intro at 0; `.snav` and all `.sgroup` cards clip-reveal at 0.12 (y 30, stagger .06). At 0.4: place nav lens; nav items + me link fade/slide from x −8 (stagger .035); visible-in-viewport `.cell, .me-card, .stepper` fade-up (y 10, stagger .025); wallpaper tiles "toss in" (opacity 0, y 40, alternating rotation ±3°, scale .94 → rest; 0.8s back.out(1.4); stagger .05, delay .1); accent dots pop (scale .4→1, back.out(3), stagger .04, delay .25).

## 2. Layout

- Header: title "Settings", sub "Your profile, the look of Pane, and when it nudges you". No stats/actions.
- `.settings` grid: `minmax(230px, 272px) | minmax(0, 1fr)`, gap `var(--gap)`, align start.
  - ≤900px: single column, nav hidden entirely.

### Left: section nav `nav.snav.glass` (sticky, top 92px, radius 28px, padding 12px 10px)
- `a.snav__me[data-go=profile]` (href `#/settings/profile`): lg avatar + name (`data-me=name`) + email (`data-me=email`), bottom separator.
- `.snav__track` (relative) with an absolutely positioned **lens** `.snav__lens` (background `var(--lens)` gradient + `--lens-glow` shadow; starts opacity 0) and 5 items `a.snav__item[data-go]` (50px tall, radius 16px): small coloured icon tile (`picon picon--sm hue--x`), label, chevron (accent-ink when current). Items: Profile (user, blue), Notifications (bell, pink), Appearance (palette, purple), Focus (timer, orange), Data (layers, teal). Current item has `aria-current="true"`.
- Lens movement (shared helper, vertical axis, radius 16): lens sized to the target item; moves with `back.out(1.35)` 0.62s while doing a squash/stretch scale keyframe (stretch along Y proportional to distance, then `elastic.out(1.1, .38)` back to 1). No animation on first placement / resize.

### Right: `.settings__col` (grid, gap var(--gap)) with five `section.sgroup.glass#set-{id}[data-sec]`
Each: radius `var(--r-xl)`, padding `clamp(16px,.6vw+12px,22px)` (6px bottom), `scroll-margin-top: 96px`; header with h2 `.sgroup__title` (650 17px display) and `.sgroup__sub`. Body is mostly a `ul.cells` of **cells**:
- Cell = `li.cell` grid `auto | 1fr`: coloured icon tile, then `.cell__main` (flex, wrap, space-between, min-height 58px, padding 10px 0, separator top border between consecutive cells) containing `.cell__text` (bold label + small hint; a `<label for>` when tied to an input) and optional `.cell__ctl` (right-aligned control).
- Variants: `cell--block` (control below text, full width), `cell--link` (whole row is a button with chevron that nudges 3px right on hover), `cell--go`.

At ≥1360px the column becomes 2 columns: Profile, Notifications, Focus, Data stretch to row height; Appearance and the end sentinel span both columns; wallpaper grid fixed at 5 columns (max-width 820px).
A 1px `.settings__end` sentinel follows the last card.

#### Profile ("How the team sees you")
- `.me-card`: xl avatar (96px) with presence dot and ring shadow, big name (700 `clamp(20px,.8vw+14px,26px)`), role, email — each tagged `data-me=name|role|email` for live mirroring.
- Cells with inline text inputs (`input.cell__input[data-profile]`, borderless, right-aligned muted text, max 300px; on focus: filled background, left-aligned, 2.5px accent ring): Name (user, blue; autocomplete name), Email (mail, indigo; type email), Role (tasks icon, teal; autocomplete organization-title).
- ≤600px: inputs go full width, left aligned, stacked under label.

#### Notifications ("What Pane taps you on the shoulder for")
Five switch cells (`input.switch[role=switch][data-notify]`):
| key | label | hint | icon/hue | default |
|---|---|---|---|---|
| mentions | Mentions | When someone @mentions you | chat / blue | on |
| due | Due dates | The morning a task of yours is due | flag / orange | on |
| meetings | Meetings | Five minutes before they start | calendar / pink | on |
| digest | Daily digest | One summary at 9:00 AM | inbox / teal | off |
| focusEnd | Focus finished | When a session ends | timer / purple | on |
(Stored only; nothing in the app actually schedules notifications.)

#### Appearance ("The whole app re-tints through its glass")
1. Theme (moon/indigo, hint "Auto follows your system"): segmented control `set-theme` — Light (sun icon), Dark (moon), Auto (`system`, half-filled circle icon).
2. Wallpaper (`cell--block`, drop/pink; hint shows current wallpaper name): grid `.wps` (`auto-fill minmax(96px,1fr)`; 3 columns ≤600px; 5 at ≥1360px) of buttons `button.wp[data-wall][aria-pressed]`. Each tile: `.wp__art[data-wall=id]` (4:3, radius 16px, inner 1px sep ring + shadow; transparent 2.5px outline offset 3px → accent-ink when selected) containing a mini rendition of the wallpaper SVG (same generator as the real background, scoped by putting `data-wall` on the tile so its own palette applies), plus three tiny glass "UI" shapes (sidebar bar, card, chip) and a check badge (22px accent circle bottom-right, visible when selected); name label below.
3. Accent (`cell--block cell--accent`, palette/orange; hint shows accent name): `.sws` row of 44px buttons `button.sw.sw--{id}[data-accent]` each with a 32px coloured dot (`--sw`), inner highlight + coloured drop shadow; selected → 2.5px outline in the same colour and the check icon scales in (spring).
4. Glass (layers/blue, hint "Clear shows more of the wallpaper"): segmented `set-glass` — Clear / Tinted.
5. Reduce transparency (shield/green, hint "Solid surfaces, no frost"): switch `#set-solid[data-look=solid]`.
≤600px: theme/glass segmented controls go full width with equal buttons; wallpaper/accent rows bleed left by −42px (under the icon column); swatches spread `space-between`.

#### Focus ("The timer the island keeps")
- `.steppers` 2-column grid (1 column ≤400px) of two steppers `.stepper[data-step][data-min][data-max][data-by]` (filled panel radius 22px): label, row with round 42px minus/plus buttons (accent-ink icon, `disabled` at bounds → opacity .35) and an `<output aria-live>` showing a huge number (700 `clamp(34px,2vw+16px,44px)`) + "min".
  - Session: `focusMinutes` 15–90 step 5 (default 25). Break: `breakMinutes` 5–30 step 5 (default 5).
- Cell "Start a session now" (play/orange, `cell--go`): hint text = "{focus} minutes, then a {break}-minute break" or, while a session runs, "In focus · m:ss left"; button `[data-act=focus]` = accent "▶ Start" or glass "■ End session".

#### Data ("Everything stays in this browser")
Two link cells:
- Export tasks as CSV (download/green; hint "{n} tasks, one row each" — n excludes synthetic history tasks) `[data-act=export]`.
- Reset demo data (refresh/danger hue; label in danger colour; hint "Back to the sample workspace") `[data-act=reset]`.

## 3. Interactions

- **Nav click** (`[data-go]`, incl. the me link): prevent default; set current section (lens animates); suppress scroll-spy for ~1s (until `scrollend` resets it); smooth-scroll so the card top sits 96px (76px on ≤760px) below viewport top; `history.replaceState` to `#/settings/<id>` (no hashchange → no re-enter).
- **Scroll spy**: IntersectionObserver over the 5 cards with rootMargin `-28% 0 -62% 0` (a band ~28–38% down the viewport); current = first section (in nav order) intersecting the band. A second observer on the end sentinel selects "data" when the bottom is reached (and scrollY > 40). Ignored while the view is hidden or during programmatic scrolls.
- **Profile inputs**: on each `input`, mirror the value into every `[data-me=<field>]` (me-card and nav); debounce-save 0.8s after the last keystroke; `focusout` flushes a pending save immediately. Save validates: empty name → warning toast "Your name can't be empty" (user icon); bad email (simple `x@y.z` regex) → warning toast "That email doesn't look right" (mail icon); unchanged → no-op. Otherwise writes `settings.name/email/role`, mirrors onto the current member record (name/email/role), emits `settings` + `members` (sidebar footer name/role update), toast "Saved".
- **Notification switch change**: set `settings.notify[key]`, emit `settings`; switch does a squish (scaleX 1.08 / scaleY .9 → 1, `elastic.out(1.2,.4)` 0.6s) and the row icon wiggles (scale .86 + rotate −8° when checked / +8° when unchecked → rest, back.out(2.6)).
- **Theme / Glass segmented**: on change call the look setter `{theme}` / `{glass}` immediately.
- **Wallpaper tile click** (if different): cross-fade the background — clone the fixed `.wall` element as a "ghost" layered above, apply the new wall, fade the ghost out (0.7s power2.inOut) then remove (previous ghosts killed first). Tile art bounces (scale .9→1, `elastic.out(1,.45)` 0.7s); check badge pops (from .3).
- **Accent swatch click** (if different): set `{accent}`; dot bounces (scale .72→1, `elastic.out(1.1,.4)` 0.65s).
- **Reduce transparency switch**: set `{solid}`; same squish/wiggle feedback.
- **Stepper buttons**: clamp new value to [min,max] by step; write to `settings`, emit `settings`; update disabled states; number "rolls" — old value slides out vertically (yPercent ∓60, fade, 0.12s power2.in), new value slides in from the opposite side (0.42s back.out(2.2)); button icon pops (scale .7→1, back.out(3)). Changing Session also refreshes the Start-cell hint.
- **Start / End session** (`[data-act=focus]`): toggles the global focus timer (Dynamic-Island-style widget elsewhere in the shell) with `settings.focusMinutes`. The cell re-renders on every timer event (start/pause/resume/stop/done; `tick` events only while the view is visible).
- **Export CSV**: header `Title, Project, Status, Priority, Assignee, Due, Created, Done, Estimate (h)`; one row per non-history task with project name, human status ("To do/In progress/In review/Done"), priority label, assignee name, ISO dates (YYYY-MM-DD, empty if none), est. Downloads `pane-tasks.csv`; toast "Exported N tasks" (download icon).
- **Reset demo data**: shared confirm modal (danger style) "Reset demo data?" / "Tasks, events and your edits go back to the sample workspace." / button "Reset"; on confirm regenerate the seed store, emit all topics, then `location.reload()`. (Look preferences in `pane:look` are NOT reset.)
- **External look changes** (e.g. a theme toggle elsewhere, or system theme change in Auto): controls re-sync silently (segmented pills move without firing callbacks; wallpaper/accent `aria-pressed`; solid switch; name hints).

## 4. Data & the look engine

### Settings in the store (`pane:v1` → `settings`)
`{ name, email, role, focusMinutes: 25, breakMinutes: 5, weekStart: 1, notify: { mentions, due, meetings, digest, focusEnd } }` (seed: Lin Zhao / lin@pane.app / Product Lead; digest false, others true). Store regenerates daily (seed keyed to today's date), so edits last until midnight.

### Look preferences — localStorage key `pane:look`
Separate from the store. Shape (defaults):
```
{ theme: "dark", wall: "ash", accent: "blue", glass: "tinted", solid: false }
```
- Loaded as defaults merged with parsed JSON (parse errors → defaults). Ignored/not saved when URL has `?record`.
- Setter merges a partial object, saves JSON, then applies:
  - `html[data-theme]` = resolved theme (`system` → `dark`/`light` via `matchMedia('(prefers-color-scheme: dark)')`, re-applied live on OS change while in system mode).
  - `html[data-wall]` = wallpaper id.
  - `html[data-accent]` = accent id.
  - `html[data-glass]` = `clear` | `tinted`.
  - `html.is-solid` class toggled by `solid`.
  - `<meta name="theme-color">` = `#0a0a0c` (dark) / `#e4e4ea` (light).
  - Notifies look subscribers.
- Wallpapers (10): `ash` Ash, `sand` Sand, `sage` Sage (these three are flat colour — lines and bubbles hidden via `--wline:0; --wbub:0`), `aurora` Aurora, `smoke` Smoke, `tide` Tide, `bloom` Bloom, `ember` Ember, `grove` Grove, `dusk` Dusk (illustrated). Each defines light + dark palettes of CSS vars `--wbg1/2` (background gradient), `--wa1/2`, `--wb1/2`, `--wc1/2`, `--wd1/2` (four wave-layer gradients), and optional `--wline` / `--wbub` opacities.
- Wallpaper SVG (fixed `.wall` behind the app, z −1; viewBox 1600×1000, `slice`): background rect + 4 flowing blob/wave paths each filled with its own two-stop linear gradient from the vars, a translucent white ribbon, thin white contour strokes (opacity `--wline`), and 12 glassy "bubbles" (radial white rim gradient + small rotated highlight ellipse; opacity `--wbub`). `body` also gets the bg gradient (fixed).
- Accents (6): `blue`, `purple`, `pink`, `orange`, `green`, `graphite`, each setting `--accent` and `--accent-ink` (lighter ink in dark theme; graphite also defines a green `--switch-on`). Swatch colours on the settings page hard-code the light/dark `--accent` values.
- Glass: `clear` lowers the glass/chrome alpha (light .14/.12, dark .20/.18 vs default .32/.26 light, .42/.36 dark).
- Solid (`html.is-solid`): glass surfaces switch to an opaque fallback (same treatment as `prefers-reduced-transparency: reduce`).

## 5. Notable CSS

- `.snav__item` text-2 → text on hover/current (font-weight 560 → 620); chevron accent-ink when current.
- `.cell__input` transparent until hover (`--fill-hover`) / focus (`--fill` + accent ring); 16px font on ≤760px (prevents iOS zoom).
- `.me-card .av` ring `0 0 0 3px var(--av-ring)` + lift shadow.
- `.wp__art` outline-based selection (2.5px accent-ink, offset 3px); glass mini-shapes use `var(--glass)` + 0.5px rim.
- `.sw__dot` outline in its own colour when pressed; check icon hidden (opacity 0, scale .4) until pressed (spring transition `--spring` = cubic-bezier(.34,1.45,.55,1)).
- `.stepper__btn` 42px (46px coarse), hover accent-soft.
- `.cell__btn--danger b` danger colour; `.settings .hue--danger` maps `--hue` to danger for the icon tile.
- Shared tokens: radii `--r-xl 30px`, `--r-lg 24px`; `--gap clamp(12px,.6vw+8px,20px)`; easing `--ease cubic-bezier(.22,.8,.24,1)`.
