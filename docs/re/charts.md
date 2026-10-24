# Module: charts (`charts-Co1ox3Rq.js`)

This is not a route. It is a helper chunk of three chart factories, all drawn in hand-written **SVG/DOM** (no canvas and no chart library) and animated with GSAP. It has no CSS file of its own: its styles live in the global `index-*.css` under `.chart*`, `.bars*`, `.donut*`, `.tone--*` and `.tone-stroke--*`.

Consumers:
- Home: bars (week chart).
- Insights: line (throughput) and donut (by project).
- Projects: line (burn-up).

Each factory takes `(containerEl, options)` and returns an object of control methods. None of them returns a cleanup function, and observers and listeners are never removed.

## Shared: "nice" axis max

`niceCeil(v)` works in two steps:
1. If v ≤ 0, return 1.
2. Otherwise compute the magnitude `10^floor(log10 v)` and round the normalised value up to the nearest of 1, 2, 2.5, 5 or 10, then multiply back by the magnitude.

The line chart's y-max is `niceCeil(max(1, all values) * 1.08)`. The bars chart's max is `niceCeil(max(1, values))`.

## 1. Line / area chart — `lineChart(el, opts)`

**Options:** `{ labels: string[], series: [{name, values:number[], tone, dashed?}], format(v)→string, label (aria), height? }`.
- `tone` is one of `accent | ink | muted | blue | purple | pink | orange | green | teal | indigo | yellow`.

**DOM** (the container gets class `chart` and `tabindex=0`):
```
svg.chart__svg[role=img][aria-label]
  defs: linearGradient#g-{label sans non-word} (vertical, stops .chart__stop0 / .chart__stop1)
        clipPath#c-{…} > rect.chart__clip (x=0, height 100%, width animated)
  g.chart__grid        (3 dashed horizontal lines at 0, ½, max + right-aligned y labels at x=l-8)
  g.chart__plot[clip-path] > path.chart__area (fill=url(#g-…)) + one path.chart__line per series
  g.chart__x           (x labels)
  line.chart__cross    (vertical hover crosshair)
  g.chart__dots        (hover dots)
div.chart__tip[role=status][aria-live=polite]
```

**Geometry:**
- Padding is `{l:44, r:12, t:12, b:26}`.
- Width is the container's clientWidth. Height is `opts.height`, otherwise `max(160, clientHeight || 220)`.
- The viewBox is set to the pixel size, so the chart is redrawn on resize rather than scaled.
- `x(i) = l + i/(n-1) * (W-l-r)` and `y(v) = t + (1 - v/max) * (H-t-b)`.

**X labels:** keep every k-th label, where `k = ceil(n / max(2, floor((W-l)/56)))`. The last label is always shown. A k-multiple that falls too close to the last label (within k/2) is dropped so the two don't collide.

**Curve:**
- A smoothed cubic Bezier built in Catmull-Rom style with tension 0.18. The control points use the neighbours (i-1, i+1, i+2), with the endpoints duplicated.
- Each control point's y is **clamped between the two segment endpoints' y values**. This prevents overshoot, so the line never dips below 0 or rises above the peaks.
- The area path is series[0]'s curve closed down to the baseline.
- The area fill colour comes from a `--area` CSS variable set on the container, equal to `var(--{tone})`, with `faint` used for muted. The gradient stop opacity runs from .28 to 0.

**Draw-in animation** (`play(delay=0)`):
- A progress value `p` tweens from 0 to 1 over 1.4s with power2.inOut.
- On every update, the clip rect width is set to `l + (W-l)*p + 2`.
- The effect is a left-to-right wipe of the lines and area. The grid and labels are always visible.

**Hover / keyboard:**
- **Pointer:**
  - `pointermove` maps clientX to the nearest index.
  - The crosshair is drawn at x(i) from top to baseline, with opacity 1.
  - One dot per series is drawn: r 4.5, fill = tone, stroke `--glass-solid` 2.5.
  - The tooltip shows the label in bold, then one row per series: a coloured dot, the name and the formatted value in a right-aligned `<strong>`.
  - Tooltip position is `translate(x, y)`. X is centred on the point and clamped to [4, W - tipW - 4]. Y is the highest series point minus the tip height minus 14, clamped at 0 or below.
  - `pointerleave` (and `blur`) hide all three by setting index = -1.
- **Keyboard:** ArrowLeft and ArrowRight step the index. The first press starts from the last point.
- Redraws are batched through a GSAP-ticker queue, so there is at most one redraw per frame.
- A ResizeObserver on the container triggers a redraw.
- The container listens for `card:resize`. The closest `.card` does too, with a 650ms delay so the Flip expand can finish first.

**`update(newSeries, newLabels = labels)`** morphs to the new data even when the point count changes:
1. Resample the old values onto the new length by linear interpolation.
2. Tween t from 0 to 1 over 0.9s with power3.inOut, lerping old→new for every point on each frame.
3. At the end, snap to the exact new values.

**`redraw()`** is exposed.

**CSS:**
- Lines: width 2.6, round caps and joins. Dashed lines use `5 6` at width 2.
- Grid lines use `--sep` with dash `3 5`. Axis text is 12px, weight 500, `--text-2`.
- Crosshair: `--text-3`, 1px.
- Tooltip: `--glass-solid` background, `var(--shadow)` plus an inset `--sep` ring, radius 14, padding 10/12, min-width 150, 13px text, opacity transition .15s.
- Focus ring: 2.5px `--accent-ink`, offset 4, radius 14.

## 2. Bars chart — `barsChart(el, opts)`

This is plain DOM, not SVG.

**Options:** `{ labels, values, format, tone='accent', label, highlight? (index) }`.

**DOM:** the container gets class `bars`, `role=list` and an aria-label. It contains one entry per label:
```
div.bars__col[.is-hi][role=listitem][aria-label="L: fmt(v)"][title]
  div.bars__track > span.bars__bar.bars__bar--{tone} style="height:{v/max*100}%"
  span.bars__lab
```

**CSS:**
- `.bars` is a flex row with gap `clamp(6px, .6vw, 12px)` and a default height of 180px.
- Each column is a flex column with gap 8.
- The track is `--well` with radius 12. It flexes to fill, aligns to the bottom and hides overflow.
- The bar uses `--bar` (from its tone), radius 12, min-height 4px. The glossy look comes from these layers:
  - Background: `linear-gradient(180deg, #ffffff6b, #fff0 55%), var(--bar)`.
  - Shadows: an inset top highlight `0 1px 1px #fff9`, an inset bottom `0 -1px 2px #0000001f`, and a coloured drop shadow `0 8px 16px -10px var(--bar)`.
  - **Non-highlighted** columns get a washed overlay instead: `linear-gradient(#ffffff9e, #ffffff57)` in light mode, or `linear-gradient(#0000001a, #00000052)` in dark mode. Only the highlighted (today) column is fully saturated.
- Labels are 12px, weight 560, `--text-2`, centred.

**Animation:**
- `play(delay)`: the bars grow with scaleY 0→1, origin at the bottom, over 0.9s, power3.out, stagger 0.035.
- `update(newValues)`: re-renders with the new heights. Each bar then animates from `scaleY = (old/oldMax) / (new/newMax)` (capped at 6) back to 1 over 0.7s with power3.inOut, so the bar visually morphs from its old height.

## 3. Donut chart — `donutChart(el, opts)`

**Options:** `{ parts: [{label, value, tone}], center: string, sub: string, label }`.

**DOM:** the container gets class `donut`: a 168px square, `position: relative`. It contains:
- An SVG with `viewBox 0 0 140 140`, rotated -90deg.
  - `circle.donut__track`: r 52, stroke `--well` at width 16.
  - One `circle.donut__arc.tone-stroke--{tone}` per part: r 52, stroke-width 16, round caps.
- `div.donut__mid`, absolutely centred, holding `<b>` (display font 700 24px) and `<span>` (12.5px, text-2).

**Segments:**
- `C = 2π*52`. Each part's length is `value/total*C`.
- If there is more than one part, 3px is subtracted from each length to leave gaps between segments.
- `stroke-dasharray = "{len} {C}"`, with `stroke-dashoffset = -cumulative`.
- The length is stored in `data-len`.

**Animation:**
- `play(delay)`: each arc tweens its `stroke-dasharray` attribute from `0 C` to `len C` over 1s, power3.inOut, staggered 0.12 per arc.
- `update(parts, center?)` re-renders and replays.

## Notes for re-implementation

- All durations go through a reduced-motion gate: the duration becomes 0 under `prefers-reduced-motion`.
- Colour tokens used: `--accent-ink`, `--text`, `--text-3`, `--faint`, plus the hue palette `--blue`, `--purple`, `--pink`, `--orange`, `--green`, `--teal`, `--indigo` and `--yellow`.
- The gradient and clip IDs are derived from the aria label. Two charts with the same label on one page would collide, so it is better to generate unique IDs.
