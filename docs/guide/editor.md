# Level editor spec

Status: draft, agreed with the designer before the first editor build. Items marked `_TBD_` are open and will be settled while testing.

The editor is a separate page in this project, served next to the game at `<pagesUrl>/editor/` (beside `/demo/` and `/docs/`). It is not part of the `build_demo` / `release_demo` version snapshots.

## 1. The game in one paragraph

A 2D ring-tangle puzzle (pieces held by each other through hooks) is wrapped onto the faces of a 3D cube. The player rotates the cube 360° to see every face, and frees pieces one by one until none is left. Version 1 uses a **cube**; a **sphere** comes later (`_TBD_`). The level logic stays 2D on each face; 3D is only how it is shown.

## 2. Level data

### Pieces

All piece types from the reference 2D layout bank (`Ring Tangle — Main Campaign`) are in scope for the first test:

| `type` | Shape | How it moves |
|---|---|---|
| `ring` | C-shaped open ring (`radius`, `gap` in degrees, `rotation` = gap direction) | Rotates around its centre; its wire slides through the hooks holding it |
| `closed` | Closed ring, no gap | Never frees itself; can only be broken by a bomb |
| `bar` | Straight or bent bar (`path` points, `rotation`, `guides`) | Slides along the leg held by a hook |
| `elbow` | L-shaped bar | Slides along the leg held by a hook |
| `u` | U-shaped bar | Slides along the leg held by a hook |
| `rolling-elbow` | "Screw": L-shaped bar with one leg locked by a metal joint | Pushing along the locked leg flips the other leg to the opposite side, then it slides out |

Attachments:

- **Hook (`stems`)**: a short stick on the holding ring ending in a same-coloured sleeve that wraps around the held piece's wire.
- **Bomb (`bomb`)**: attached to a ring or bar and moves with it. `fixedBombs` sit still on a face.
- **Colours**: gold, teal, coral, violet, mint, blue, green.

### Connections

`connections` list who holds whom: `owner` (always a `ring` or `closed`) holds `target` (any piece), optionally with `anchor`, `contactAngle` or `mode: "thread"`. Holds are declared, not derived from the drawing.

### Cube

- Every piece has a `face`: `front`, `back`, `left`, `right`, `top`, `bottom`.
- `x, y` are local to that face. Coordinates past the face edge fold over the edge onto the neighbouring face, so pieces and hooks may **cross cube edges**.
- The level has a `cubeSize` (face size in level units, about 400 so a 2D reference level fits one face).
- The level has a `bombRadius` (blast radius, default 70, value `_TBD_` after testing).

### Level file

Kept close to the reference file. Fields: `schema` (`ring360-level`), `schemaVersion` (1), `id`, `name`, `version`, `status`, `difficulty` (`normal`, `hard`, `super_hard`), `category`, `cubeSize`, `bombRadius`, `pieces`, `connections`, `fixedBombs`, `instruction`, and `generator` (preset, seed and parameters when generated). Tutorial steps from the 2D bank are not carried over yet (`_TBD_`).

## 3. Rules the editor and game share

1. A ring can rotate only while it **holds nothing**.
2. A sleeve holds a piece **while it sits on the piece's wire right now**: a ring is out of a sleeve while its gap is at the sleeve, and is caught again if it keeps turning and the wire comes back into the sleeve. A bar is out once its leg has slid past the sleeve, and caught again if it slides back.
3. Bars, L and U pieces slide along the held leg.
4. A piece **breaks in place** (it does not fly away) when the player **lets go** while nothing holds it and it holds nothing. While dragging, the piece glows orange; it glows teal while it is free, meaning letting go now breaks it.
5. A ring held by several sleeves breaks only when its gap covers all of them at once. The generator only puts several sleeves on a ring when they fit inside its gap.
6. A closed ring is removed only by a bomb (or a booster).
7. A bomb explodes when it touches another ring or another ring's hook. It breaks the piece it is attached to and every piece within its blast radius, closed rings included. Pieces held by a broken piece are released.
8. Blast radius: tunable, value `_TBD_` (tested in the build).
9. Win: every piece is broken. There is no lose state; a player who gets stuck presses Restart.

### Boosters (prototype values)

Two booster buttons sit either side of the rotate pad at the bottom of the play screen.

- **Hammer**: tap the button, then tap a piece: that piece breaks at once and the pieces it held are released. 3 uses per attempt.
- **Rocket**: breaks the 3 pieces nearest the middle of the face turned towards the player. 2 uses per attempt.
- The badge shows the uses left; at 0 it shows "+". There is no shop: tapping an empty booster only shows a message. Restart refills both.
- Final counts, prices and whether boosters carry over between levels: `_TBD_`.

## 4. Level generation

The designer picks a preset (Normal, Hard, Super hard), adjusts any value, and presses Generate. The result can then be edited by hand. Same parameters + same seed give the same level.

Preset defaults come from the 400 reference levels (middle 50% range):

| Parameter | Normal | Hard | Super hard |
|---|---|---|---|
| Total pieces | 17–24 | 18–22 | 20–25 |
| C rings | 9–16 | 12–16 | 10–16 |
| Closed rings | 0–3 | 1–3 | 0–3 |
| Bars / L / U | 1–8 | 3–8 | 6–10 |
| Screws | 0 | 0–1 | 0–2 |
| Bombs | 0 | 0–1 | 1–2 |
| Chain depth | 3–5 | 4–6 | 3–6 |
| Max pieces one ring holds | 3 | 3 | 3–4 |
| Max hooks on one piece | 3 | 3 | 2–3 |
| Colours | 7 | 7 | 7 |

Cube-only parameters (not in the reference data, proposed values):

- Faces used: 1–6, default 4 (about 5–8 pieces per face).
- Share of hooks crossing a cube edge: default about 20%.
- Ring radius 44–55, gap 100–135°.
- Seed.

The five difficulty parameters (chain depth, max held per ring, max hooks per piece, bars, bombs and closed rings) sit together at the top of the generator. The placement rule in version 1 is a **placeholder** to be replaced later; the generator always checks the result is solvable.

## 5. Storage and level management

- Data lives in a folder the designer picks (File System Access API, Chrome or Edge only), or in browser storage for quick trials.
- Each level keeps its **3 latest versions**; an autosaved draft protects the level being edited.
- Import single JSON files or a whole folder, and import levels from a reference 2D layout bank (each 2D level is placed on one face). Import never overwrites: a duplicate id becomes `-2`, `-3`...
- Delete asks for confirmation and keeps the version history. Renaming an id moves the file, its history and its collection entries.
- Level info: Name, Id, Status (WIP, PROD, ARCHIVE), Difficulty, Category.
- Levels are ordered into collections in the Organiser tab.

```
<root folder>/
  levels/<id>.json
  levels/.versions/<id>/            3 latest versions
  drafts/current.json               autosaved draft
  collections.json
  collections/<Name>/001_<id>.json  ordered copies per collection
```

## 6. Checking a level

Warnings:

- A connection points to a missing piece, or a piece hooks itself.
- A sleeve is not on the held piece's wire.
- A held closed ring with no bomb nearby.
- Two pieces overlap at the start.
- Circular holds (A holds B, B holds A).
- No piece can move on the first turn.

Play button: the project's own game build opens over the editor with the level being edited. The game reads the editor's level file directly (no conversion) and uses the same rules code.

Simulation: a simplified solver tries moves (rotate a ring or slide a bar until it frees a sleeve or hits another piece) and reports solvable or not, minimum moves, and dead-end branches. How these combine into a difficulty score: `_TBD_`.

## 7. Play test and demo

- Play test HUD: Back to editor, Restart, level name, pieces left. No move counter, no timer.
- The standalone demo (`/demo/`) has a level select screen. Which levels it ships with (for example a collection copied into the project): `_TBD_`.
- Settings (gear button on the level select and play screens), remembered in the browser:
  - **Dark theme**: game colours (navy background, dark cards); the cube stays cream. Changing it mid-level keeps progress.
  - **Rotate from anywhere** (default ON): ON, a drag on any empty spot turns the cube; OFF, only drags that start on the rotate button at the bottom turn it.
  - **Editor dark theme**: the same value as the editor's own "Dark" switch in its header.

## 8. Look and feel

Athena logo (orange on dark, black on light), Fish Ball editor colour tone, dark and light themes with a remembered Theme toggle. Layout: level list on the left, work area in the centre, inspector on the right; panels collapse and resize and remember their state. Tabs: Editor and Organiser. UI text in English.

## 9. Using the editor (version 1)

Open `<pagesUrl>/editor/` (or `http://localhost:8080/editor/` with `npm run dev`). The first screen asks for a levels folder (Chrome or Edge) or browser storage.

### Editing the demo's levels (project mode)

The levels the demo plays are the files in `public/levels/` of this project, listed in play order in `public/levels/index.json`. To edit them, run `npm run dev`, open `http://localhost:8080/editor/` in Chrome or Edge, and choose the **ring-360-demo project folder**. The editor recognises the project and:

- reads and writes levels directly in `public/levels/` (so saving a level changes the demo's file);
- keeps its version history, drafts and collection copies in `editor-data/` (not bundled into the game, and ignored by git except `editor-data/collections.json`);
- shows a **Demo** collection in the Organiser that mirrors `index.json`. Add, remove or reorder levels there and press Save collection to rewrite `index.json`. Saving, renaming or deleting a level that is in the demo updates its `index.json` entry too.

The live site only changes after the files are committed, pushed and released (`npm run release:latest`). The editor on the live site cannot write to the repository; in browser storage or another folder, **Import demo levels** copies the demo's current levels in for viewing and editing.

- **Levels panel**: `+` new, `⧉` duplicate, `⇩` import JSON files (Ring 360 levels or a 2D layout bank), `▤` import a folder, `🗑` delete, `🕘` older versions of the open level.
- **Generator**: pick a preset, adjust values, press Generate. The result replaces the open level's pieces as an unsaved, undoable change.
- **Tools** (left strip): select, C ring, closed ring, bar, L, U, screw, hook (click the holding ring, then the held piece), bomb on a piece, fixed bomb.
- **Views**: 3D (drag to orbit, drag the selected piece to move it, also across faces) and Net (the six faces unfolded; click, drag, arrow keys to nudge).
- **Shortcuts**: Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo, Delete removes the selected piece, Esc cancels a tool.
- **Play** opens the game over the editor with the open level, unsaved changes included.

### Known limits of version 1

- Collisions and bomb blasts are checked between pieces on the same face; pieces on other faces are not obstacles yet.
- In the Net view, hooks between faces that are not next to each other in the cross (for example top and left) are drawn running off the edge.
- The simulator does an exhaustive search on small levels; on larger ones it reports the moves of the first solution it finds ("Moves (found)"), an upper bound rather than the minimum.
- The generator's placement (a 3x3 grid of slots per face) is a placeholder.

