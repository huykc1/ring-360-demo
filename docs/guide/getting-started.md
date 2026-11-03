# Getting Started

## Requirements

- Node.js 20.19 or newer
- npm

## Install

```bash
git clone https://github.com/huykc1/ring-360-demo.git
cd ring-360-demo
npm install
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the game at http://localhost:8080 and the level editor at http://localhost:8080/editor/ |
| `npm run build` | Type-check and build the game into `dist/` |
| `npm run build:editor` | Build the level editor into `dist-editor/editor/` |
| `npm run preview` | Serve the built game locally |
| `npm run docs:dev` | Start the docs dev server |
| `npm run docs:build` | Build the docs into `docs/.vitepress/dist/` |
| `npm run build:site` | Build the full Pages site (landing + demo + docs + editor) into `_site/` |
| `npm run preview:site` | Serve `_site/` at http://localhost:8091 |

## Testing on a phone

Run `npx vite --host`, then open the printed network URL on a phone on the same Wi‑Fi.

## Code map

| Path | What it is |
|---|---|
| `src/core/` | Level format, cube mapping, rules, simulator, generator, checks, 2D bank import (shared by game and editor) |
| `src/view/CubeView.ts` | Three.js view of a level on the cube |
| `src/scenes/` | Phaser scenes: `Boot`, `Menu` (level select), `Play` (HUD and input) |
| `src/editor/` | Level editor page (`editor/index.html`) |
| `public/levels/` | Levels bundled with the demo (`index.json` lists them in order) |

The game draws the cube with Three.js in `#cube-layer` and the HUD with Phaser on a transparent canvas on top; Phaser receives all input and forwards drags to the cube view.

