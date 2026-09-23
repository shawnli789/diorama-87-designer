# Diorama 1:87 — RC Terrain Designer

A beginner-friendly 3D design tool for planning a real, physically-built 1:87 RC diorama
(terrain, roads, construction/work zones) in real-world centimeters.

**Live site:** https://shawnli789.github.io/diorama-87-designer/

Just open the link — no setup needed.

## What it does

- 3D scene (three.js) with orbit / pan / zoom + one-click top-down, isometric, and free cameras
- Real-centimeter grid + always-visible 1:87 scale reference
- Base-plate setup form (default 90×60cm)
- Terrain brushes (raise / lower / smooth) with live slope % and red over-grade flagging
- Terrain presets (flat, gentle hillside, steep terrace, valley) + cross-section slice → foam layer count
- Click-to-draw roads with auto-smoothing, terrain drape, steep-grade + tight-turn highlighting
- Polygon work zones with auto-color, groups (A/B/C), and notes
- Object library with real-world dimensions, auto-scaled to true 1:87 footprints
- Layers (terrain / roads / zones / objects / notes) with visibility + locks
- Vehicle profile (wheelbase, clearance, max climb, min turn) driving fit checks
- Export: 3D snapshot PNG, true-scale plan SVG, print-at-100% plan, per-layer foam cut sheets, JSON backup/restore
- Auto-save + named version save points, undo/redo throughout, 4-step guided first-build flow

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export in out/
```

## Deploy

The site is served from the `gh-pages` branch (branch-based GitHub Pages):

```bash
npm run build
/tmp/gh-deploy.sh "Deploy diorama designer site"   # pushes ./out to gh-pages via API
```

`.github/workflows/pages.yml` is kept for a future switch to Actions-based deploys —
pushing it requires a token with the `workflow` scope. Source history lives on `main`.
