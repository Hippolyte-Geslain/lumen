# Reverse-engineering notes

Target: the public "Pane" demo (a paid template sold on codeandchill.store). The goal was to
understand **how** it is built and rebuild the same techniques as original code. Lumen ships no
code, data, copy, photos or branding from the template. Buy the template if you want its exact
source.

## Method (REA "reverse-engineer-anything" workflow)

Followed the staged workflow from [morluto/rea](https://github.com/morluto/rea), skill `reverse-engineer-anything`:

1. **Route the target.** It is a browser target, so I did passive runtime observation in a browser: loaded scripts and
   stylesheets, `<meta>` tags, fonts, `<html>` data-attributes, the inline pre-paint script, the resource timing
   list across all 7 routes (this triggers every lazy chunk), and the injected SVG `<filter>` defs.
2. **Static artifact analysis.** Captured the shipped `index.html` plus 17 JS/CSS assets into an isolated folder.
   None of them were ever run. Then:
   ```bash
   npx -y rea-agents@latest analyze-javascript-application <dir> --json
   ```
   Evidence `ev_b151ee4482a7d1a28f2d975375b220f6b23e2a3e8909bb6d31f06a3a02933b02`, 98k AST nodes, 9 modules parsed with
   no failures.
   - **Observed:** 1 core module and 8 lazy chunks. Every route imports bindings from the core. There are no network
     endpoints: the 2 candidates REA reported are `Map.get` calls. Persistence goes through `localStorage`
     get/set/remove.
   - **Limitation:** REA did not analyse the 2 inline scripts in `index.html`, so I read those by hand.
3. **Decompose.** 3 parallel workers read the prettified bundle and wrote behaviour specs in prose:
   [core](core.md), [home](home.md), [charts](charts.md), [tasks](tasks.md), [calendar](calendar.md),
   [projects](projects.md), [insights](insights.md), [team](team.md), [settings](settings.md).
4. **Rebuild.** Lumen is a clean-room implementation written against those specs.

## Key findings

| Area | Finding | Evidence type |
|---|---|---|
| Stack | Vite build, vanilla JS rendering with template strings into `innerHTML`, GSAP 3 core with Flip and no other plugins, Inter font after the SF system stack | runtime + static |
| Liquid glass | For each element, a signed-distance-field displacement map of its rounded rect is drawn on a canvas. It feeds an SVG chain `feImage → feDisplacementMap` (split into R/G/B channels on chrome surfaces for chromatic aberration) `→ feGaussianBlur → saturate`, applied with `backdrop-filter:url(#id)`. Only Chromium supports this; other browsers fall back to a CSS blur. | runtime DOM + static |
| Batching | One `ResizeObserver` collects changed elements, the GSAP ticker processes at most 3 per frame, filters are cached by size and radius, and a p75 frame-time watchdog switches to "lite" mode | static |
| Motion | Jelly lens (`back.out` plus a stretch keyframe, then `elastic.out`), clip-path card reveals, page titles split into characters, and a dynamic-island toast/timer morphed through a clip-path inset | static |
| Theming | Pre-paint script reads the saved look; tokens are set per `data-theme`, `data-wall`, `data-accent` and `data-glass`; wallpaper is one SVG whose gradient stops read CSS variables | runtime + static |
| Data | Seeded PRNG demo state, reseeded every day so relative dates stay valid, with pub/sub by topic | static |

## Known gaps in the original (fixed in Lumen)

- The minified CSS for solid mode is garbled, and the JS glass gate ignores `is-solid`. Lumen turns off both the
  filter and the frost in solid mode.
- The wallpaper cross-fade copies CSS variables that don't exist, so the fade shows nothing. Lumen draws the outgoing
  wallpaper as its own SVG with fresh gradient IDs, so the old palette stays visible while it fades.
