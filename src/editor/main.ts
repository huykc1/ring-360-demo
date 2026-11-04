// Ring 360 level editor: Editor tab (levels, generator, cube, inspector) and Organiser tab (collections).
import './editor.css';
import { checkLevel, type Check } from '../core/checks';
import { convert2D, isLayoutBank } from '../core/convert2d';
import { PRESETS } from '../core/generate';
import { angleOf, closestOnPolyline, defaultPath, isRing, polar, barPath } from '../core/geom';
import type { SimResult } from '../core/sim';
import {
    COLOR_NAMES,
    COLORS,
    FACES,
    cloneLevel,
    emptyLevel,
    normalizeLevel,
    type Difficulty,
    type FaceId,
    type GeneratorParams,
    type Level,
    type Piece,
    type PieceType,
    type Status,
    type Vec2
} from '../core/types';
import { CubeView } from '../view/CubeView';
import { clear, h, later, logo, ui } from './dom';
import { NetView } from './netview';
import { Organiser } from './organiser';
import { BrowserStore, FolderStore, folderSupported, hasPermission, pickFolder, recallFolder, rememberFolder, type Store } from './store';

type Tool = 'select' | PieceType | 'bomb' | 'fixed-bomb' | 'hook';

const TOOLS: { tool: Tool; label: string; title: string }[] = [
    { tool: 'select', label: '⌖', title: 'Select and move (V)' },
    { tool: 'ring', label: 'C', title: 'Add C ring' },
    { tool: 'closed', label: 'O', title: 'Add closed ring' },
    { tool: 'bar', label: '—', title: 'Add bar' },
    { tool: 'elbow', label: 'L', title: 'Add L bar' },
    { tool: 'u', label: 'U', title: 'Add U bar' },
    { tool: 'rolling-elbow', label: 'S', title: 'Add screw' },
    { tool: 'hook', label: '⚲', title: 'Hook: click the holding ring, then the held piece' },
    { tool: 'bomb', label: '●', title: 'Add or remove a bomb on a piece' },
    { tool: 'fixed-bomb', label: '◎', title: 'Add a fixed bomb on a face' }
];

const app = {
    store: null as Store | null,
    levels: [] as Level[],
    cur: null as Level | null,
    saved: '',
    sel: null as string | null,
    tool: 'select' as Tool,
    hookOwner: null as string | null,
    undo: [] as string[],
    redo: [] as string[],
    lastEditKey: '',
    lastEditAt: 0,
    view: ui.get<'3d' | 'net'>('view', '3d'),
    tab: ui.get<'editor' | 'organiser'>('tab', 'editor'),
    checks: [] as Check[],
    sim: null as SimResult | null,
    simBusy: false,
    genBusy: false,
    preset: 'Normal' as keyof typeof PRESETS,
    seed: Math.floor(Math.random() * 9000) + 1000,
    params: structuredClone(PRESETS.Normal) as GeneratorParams,
    search: '',
    footer: ''
};

const root = document.getElementById('app')!;
document.documentElement.dataset.theme = ui.get('theme', 'dark');

// ---------------- worker ----------------

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let jobSeq = 0;
const pending = new Map<number, (data: unknown) => void>();
worker.onmessage = (e: MessageEvent<{ job: number }>) => {
    pending.get(e.data.job)?.(e.data);
    pending.delete(e.data.job);
};
function run<T>(msg: Record<string, unknown>): Promise<T> {
    const job = ++jobSeq;
    return new Promise((resolve) => {
        pending.set(job, resolve as (d: unknown) => void);
        worker.postMessage({ ...msg, job });
    });
}

// ---------------- storage ----------------

async function boot() {
    const remembered = folderSupported() ? await recallFolder() : null;
    if (remembered && (await hasPermission(remembered, false).catch(() => false))) return connect(await FolderStore.open(remembered));
    if (ui.get<string>('store', '') === 'browser') return connect(new BrowserStore());
    renderConnect(remembered);
}

function renderConnect(remembered: FileSystemDirectoryHandle | null) {
    clear(
        root,
        h(
            'div',
            { class: 'connect' },
            h('div', { style: { fontSize: '22px' } }, logo()),
            h('h2', {}, 'Ring 360 Editor'),
            h('p', { class: 'muted' }, 'Pick where the levels live. A folder works in Chrome and Edge; browser storage stays in this browser only.'),
            h('p', { class: 'muted' }, 'To edit the levels the demo plays, choose the ring-360-demo project folder: the editor then works on public/levels/ directly.'),
            h(
                'div',
                { class: 'row' },
                remembered &&
                    h('button', { class: 'primary', onClick: async () => (await hasPermission(remembered, true)) && connect(await FolderStore.open(remembered)) }, `Reconnect “${remembered.name}”`),
                folderSupported() &&
                    h('button', { class: remembered ? '' : 'primary', onClick: async () => {
                        const d = await pickFolder().catch(() => null);
                        if (!d) return;
                        await rememberFolder(d);
                        connect(await FolderStore.open(d));
                    } }, 'Choose levels folder'),
                h('button', { onClick: () => connect(new BrowserStore()) }, 'Use browser storage')
            ),
            !folderSupported() && h('p', { class: 'muted' }, 'This browser cannot open folders; use Chrome or Edge for folder storage.')
        )
    );
}

async function connect(store: Store) {
    app.store = store;
    ui.set('store', store.kind);
    app.levels = await store.listLevels();
    await addDemoLevels(store);
    sortLevels();
    renderShell();
    const lastId = ui.get<string>('lastLevel', '');
    const first = app.levels.find((l) => l.id === lastId) ?? app.levels[0];
    if (first) await openLevel(first.id, true);
    else refreshAll();
}

function sortLevels() {
    app.levels.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ---------------- level state ----------------

const dirty = () => !!app.cur && JSON.stringify(app.cur) !== app.saved;

async function openLevel(id: string, restoreDraft = false) {
    if (dirty() && !confirm('Discard unsaved changes to this level?')) return;
    const stored = await app.store!.readLevel(id);
    if (!stored) return;
    app.cur = stored;
    app.saved = JSON.stringify(stored);
    app.sel = null;
    app.undo = [];
    app.redo = [];
    app.sim = null;
    ui.set('lastLevel', id);
    if (restoreDraft) {
        const draft = await app.store!.readDraft();
        if (draft && draft.id === id && JSON.stringify(draft) !== app.saved) {
            app.cur = draft;
            app.footer = `Restored unsaved draft of ${id}`;
        }
    }
    refreshAll(true);
}

/** Applies a change to the working level with undo support. Edits sharing `key` within a moment merge into one undo step. */
function edit(fn: (lv: Level) => void, key = '') {
    if (!app.cur) return;
    const now = performance.now();
    if (!(key && key === app.lastEditKey && now - app.lastEditAt < 800)) {
        app.undo.push(JSON.stringify(app.cur));
        if (app.undo.length > 200) app.undo.shift();
        app.redo = [];
    }
    app.lastEditKey = key;
    app.lastEditAt = now;
    fn(app.cur);
    app.sim = null;
    changed();
}

function changed(full = false) {
    if (app.sel && !app.cur?.pieces.some((p) => p.id === app.sel)) app.sel = null;
    refreshView(full);
    renderInspector();
    renderHeader();
    renderLevels();
    later('checks', 150, () => {
        if (!app.cur) return;
        app.checks = checkLevel(app.cur);
        renderInspector();
    });
    later('draft', 800, () => app.cur && app.store?.writeDraft(dirty() ? app.cur : null));
}

function undo() {
    if (!app.cur || !app.undo.length) return;
    app.redo.push(JSON.stringify(app.cur));
    app.cur = normalizeLevel(JSON.parse(app.undo.pop()!));
    app.lastEditKey = '';
    changed();
}

function redo() {
    if (!app.cur || !app.redo.length) return;
    app.undo.push(JSON.stringify(app.cur));
    app.cur = normalizeLevel(JSON.parse(app.redo.pop()!));
    app.lastEditKey = '';
    changed();
}

async function save() {
    if (!app.cur || !app.store) return;
    app.cur.version += 1;
    await app.store.writeLevel(app.cur, true);
    await app.store.writeDraft(null);
    app.saved = JSON.stringify(app.cur);
    const i = app.levels.findIndex((l) => l.id === app.cur!.id);
    if (i >= 0) app.levels[i] = cloneLevel(app.cur);
    else app.levels.push(cloneLevel(app.cur));
    app.footer = `Saved ${app.cur.name} (version ${app.cur.version})`;
    renderAllPanels();
}

/** Level info fields are written to the file straight away, without a new version or the unsaved piece edits. */
async function writeMeta(patch: Partial<Level>) {
    if (!app.cur || !app.store) return;
    Object.assign(app.cur, patch);
    const savedObj = JSON.parse(app.saved) as Level;
    Object.assign(savedObj, patch);
    app.saved = JSON.stringify(savedObj);
    await app.store.writeLevel(savedObj, false);
    const i = app.levels.findIndex((l) => l.id === savedObj.id);
    if (i >= 0) app.levels[i] = savedObj;
    renderLevels();
    renderHeader();
}

async function renameId(newId: string) {
    if (!app.cur || !app.store) return;
    const oldId = app.cur.id;
    newId = newId.trim();
    if (!newId || newId === oldId) return renderDetails();
    if (app.levels.some((l) => l.id === newId)) {
        app.footer = `Id “${newId}” is already used`;
        renderFooter();
        return renderDetails();
    }
    const savedObj = { ...(JSON.parse(app.saved) as Level), id: newId };
    await app.store.renameLevel(oldId, savedObj);
    app.cur.id = newId;
    app.saved = JSON.stringify(savedObj);
    const cols = await app.store.readCollections();
    for (const c of cols) c.levels = c.levels.map((x) => (x === oldId ? newId : x));
    await app.store.writeCollections(cols);
    app.levels = app.levels.map((l) => (l.id === oldId ? savedObj : l));
    sortLevels();
    ui.set('lastLevel', newId);
    app.footer = `Renamed ${oldId} → ${newId}`;
    renderAllPanels();
}

function uniqueLevelId(base: string) {
    const ids = new Set(app.levels.map((l) => l.id));
    if (!ids.has(base)) return base;
    for (let k = 2; ; k++) if (!ids.has(`${base}-${k}`)) return `${base}-${k}`;
}

async function addLevels(levels: Level[]) {
    let first = '';
    for (const lv of levels) {
        lv.id = uniqueLevelId(lv.id.replace(/[^\w.-]+/g, '_'));
        await app.store!.writeLevel(lv, false);
        app.levels.push(lv);
        first ||= lv.id;
    }
    sortLevels();
    app.footer = `Imported ${levels.length} level(s)`;
    if (first) await openLevel(first);
    renderAllPanels();
}

async function newLevel() {
    let n = app.levels.length + 1;
    let id = `r360_${String(n).padStart(3, '0')}`;
    while (app.levels.some((l) => l.id === id)) id = `r360_${String(++n).padStart(3, '0')}`;
    await addLevels([emptyLevel(id, `Level ${n}`)]);
}

async function duplicateLevel() {
    if (!app.cur) return;
    const copy = cloneLevel(app.cur);
    copy.id = `${app.cur.id}-copy`;
    copy.name = `${app.cur.name} copy`;
    copy.version = 0;
    await addLevels([copy]);
}

async function deleteLevel() {
    if (!app.cur || !app.store) return;
    if (!confirm(`Delete level “${app.cur.name}” (${app.cur.id})? Its version history is kept.`)) return;
    await app.store.deleteLevel(app.cur.id);
    app.levels = app.levels.filter((l) => l.id !== app.cur!.id);
    app.footer = `Deleted ${app.cur.id}`;
    app.cur = null;
    app.saved = '';
    if (app.levels[0]) await openLevel(app.levels[0].id);
    else refreshAll();
}

function parseImported(text: string, name: string): Level[] {
    const data = JSON.parse(text);
    if (isLayoutBank(data)) return data.level_layouts_attributes.map((x) => convert2D(x.client_data));
    return [normalizeLevel({ id: name.replace(/\.json$/, ''), ...data })];
}

async function importFiles() {
    const input = h('input', { type: 'file', accept: '.json,application/json', multiple: true });
    input.onchange = async () => {
        const out: Level[] = [];
        for (const f of Array.from(input.files ?? [])) {
            try {
                out.push(...parseImported(await f.text(), f.name));
            } catch {
                app.footer = `Skipped ${f.name}: not a level file`;
            }
        }
        if (out.length) await addLevels(out);
        else renderFooter();
    };
    input.click();
}

const DEMO_CATEGORY = 'DEMO';

/**
 * Makes sure the levels the demo plays are in this storage, tagged DEMO, without asking. Each demo level
 * is added once per storage, so one the designer deletes does not come back. In the project folder they
 * are the demo's own files already.
 */
async function addDemoLevels(store: Store) {
    if (store instanceof FolderStore && store.isProject) return;
    const base = import.meta.env.DEV ? '../levels/' : '../demo/levels/';
    const seenKey = `demoSeen:${store.kind}:${store.label}`;
    const seen = new Set(ui.get<string[]>(seenKey, []));
    try {
        const index = (await (await fetch(`${base}index.json`, { cache: 'no-cache' })).json()) as { levels: { id: string; file: string }[] };
        for (const e of index.levels) {
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            if (app.levels.some((l) => l.id === e.id)) continue;
            const level = normalizeLevel(await (await fetch(`${base}${e.file}`, { cache: 'no-cache' })).json());
            level.category = DEMO_CATEGORY;
            await store.writeLevel(level, false);
            app.levels.push(level);
        }
        ui.set(seenKey, [...seen]);
    } catch {
        /* offline or no demo build: the editor works without the demo levels */
    }
}

async function importFolder() {
    const input = h('input', { type: 'file', multiple: true });
    input.setAttribute('webkitdirectory', '');
    input.onchange = async () => {
        const out: Level[] = [];
        for (const f of Array.from(input.files ?? [])) {
            if (!f.name.endsWith('.json') || f.webkitRelativePath.includes('/.versions/')) continue;
            try {
                out.push(...parseImported(await f.text(), f.name));
            } catch {
                /* skip */
            }
        }
        if (out.length) await addLevels(out);
    };
    input.click();
}

// ---------------- pieces ----------------

function nextPieceId(type: PieceType) {
    const prefix = { ring: 'r', closed: 'c', bar: 'b', elbow: 'l', u: 'u', 'rolling-elbow': 's' }[type];
    const ids = new Set(app.cur!.pieces.map((p) => p.id));
    for (let k = 1; ; k++) if (!ids.has(`${prefix}${k}`)) return `${prefix}${k}`;
}

function addPiece(type: PieceType, face: FaceId, at: Vec2) {
    const id = nextPieceId(type);
    const p: Piece = {
        id,
        type,
        face,
        x: Math.round(at.x),
        y: Math.round(at.y),
        color: COLOR_NAMES[app.cur!.pieces.length % COLOR_NAMES.length],
        rotation: type === 'ring' ? 90 : 0
    };
    if (type === 'ring' || type === 'closed') {
        p.radius = 48;
        if (type === 'ring') p.gap = 115;
    } else p.path = defaultPath(type);
    edit((lv) => lv.pieces.push(p));
    select(id);
}

function deletePiece(id: string) {
    edit((lv) => {
        lv.pieces = lv.pieces.filter((p) => p.id !== id);
        lv.connections = lv.connections.filter((c) => c.owner !== id && c.target !== id);
    });
}

function renamePiece(oldId: string, newId: string) {
    newId = newId.trim();
    if (!newId || newId === oldId || app.cur!.pieces.some((p) => p.id === newId)) return renderInspector();
    edit((lv) => {
        lv.pieces.find((p) => p.id === oldId)!.id = newId;
        for (const c of lv.connections) {
            if (c.owner === oldId) c.owner = newId;
            if (c.target === oldId) c.target = newId;
        }
    });
    select(newId);
}

/** Sleeve position for a new hook: the target's wire point nearest the click (or the owner). */
function anchorFor(target: Piece, near: Vec2): Vec2 {
    if (isRing(target)) return polar(target, target.radius ?? 48, angleOf(target, near));
    return closestOnPolyline(near, barPath(target)).point;
}

function addHook(ownerId: string, targetId: string, near?: Vec2) {
    const lv = app.cur!;
    const owner = lv.pieces.find((p) => p.id === ownerId)!;
    const target = lv.pieces.find((p) => p.id === targetId)!;
    if (ownerId === targetId || !isRing(owner)) {
        app.footer = 'Only a ring can hold a piece';
        return renderFooter();
    }
    if (lv.connections.some((c) => c.owner === ownerId && c.target === targetId)) return;
    const a = anchorFor(target, near ?? (owner.face === target.face ? owner : target));
    edit((l) => l.connections.push({ owner: ownerId, target: targetId, anchor: { x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10 } }));
    app.footer = `${ownerId} now holds ${targetId}`;
    renderFooter();
}

function toggleBomb(id: string, near?: Vec2) {
    edit((lv) => {
        const p = lv.pieces.find((q) => q.id === id)!;
        if (p.bomb) delete p.bomb;
        else if (isRing(p)) p.bomb = { angle: Math.round(near ? angleOf(p, near) : 0) };
        else {
            const local = near ? closestOnPolyline(near, barPath(p)).point : p;
            const back = rotateBack({ x: local.x - p.x, y: local.y - p.y }, p.rotation);
            p.bomb = { position: { x: Math.round(back.x), y: Math.round(back.y) } };
        }
    });
}

function rotateBack(v: Vec2, deg: number): Vec2 {
    const r = (-deg * Math.PI) / 180;
    return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
}

function select(id: string | null) {
    app.sel = id;
    cube?.setSelected(id);
    if (net) {
        net.selected = id;
        net.draw();
    }
    renderInspector();
}

function setTool(t: Tool) {
    app.tool = t;
    app.hookOwner = t === 'hook' && app.sel && isRing(app.cur!.pieces.find((p) => p.id === app.sel)!) ? app.sel : null;
    renderTools();
}

/** Click on the work area with the current tool. */
function toolClick(pieceId: string | undefined, face: FaceId | undefined, local: Vec2 | undefined) {
    const t = app.tool;
    if (t === 'hook') {
        if (!pieceId) return;
        if (!app.hookOwner) {
            const p = app.cur!.pieces.find((q) => q.id === pieceId)!;
            if (!isRing(p)) {
                app.footer = 'Pick a ring as the holder first';
                return renderFooter();
            }
            app.hookOwner = pieceId;
            select(pieceId);
            renderTools();
            return;
        }
        addHook(app.hookOwner, pieceId, local);
        app.hookOwner = null;
        setTool('select');
        return;
    }
    if (t === 'bomb') {
        if (pieceId) toggleBomb(pieceId, local);
        return;
    }
    if (t === 'fixed-bomb') {
        if (face && local) edit((lv) => lv.fixedBombs.push({ face, x: Math.round(local.x), y: Math.round(local.y) }));
        return;
    }
    if (t !== 'select' && face && local) {
        addPiece(t, face, local);
        setTool('select');
    }
}

// ---------------- generator / simulator ----------------

async function generateLevel() {
    if (!app.cur || app.genBusy) return;
    app.genBusy = true;
    renderGen();
    app.footer = 'Generating…';
    renderFooter();
    const res = await run<{ level: Level; seed: number; attempts: number; sim: SimResult }>({
        kind: 'generate',
        id: app.cur.id,
        preset: app.preset,
        params: app.params,
        seed: app.seed
    });
    app.genBusy = false;
    edit((lv) => {
        lv.pieces = res.level.pieces;
        lv.connections = res.level.connections;
        lv.fixedBombs = res.level.fixedBombs;
        lv.difficulty = res.level.difficulty;
        lv.generator = res.level.generator;
        lv.cubeSize = res.level.cubeSize;
    });
    app.sim = res.sim;
    app.seed = res.seed;
    app.footer = `Generated ${app.cur.id} from seed ${res.seed}${res.attempts > 1 ? ` (${res.attempts} tries)` : ''} · ${res.sim.solvable ? 'solvable' : 'NOT solvable'} · not saved`;
    if (app.cur.difficulty !== (JSON.parse(app.saved) as Level).difficulty) await writeMeta({ difficulty: app.cur.difficulty });
    renderAllPanels();
}

async function simulateLevel() {
    if (!app.cur || app.simBusy) return;
    app.simBusy = true;
    renderInspector();
    const res = await run<{ sim: SimResult }>({ kind: 'simulate', level: app.cur });
    app.simBusy = false;
    app.sim = res.sim;
    renderInspector();
}

// ---------------- layout ----------------

let cube: CubeView | null = null;
let net: NetView | null = null;
let organiser: Organiser | null = null;
const el = {} as Record<
    'header' | 'body' | 'left' | 'right' | 'levels' | 'details' | 'gen' | 'tools' | 'viewport' | 'inspector' | 'footer' | 'center',
    HTMLElement
>;

function renderShell() {
    el.header = h('header');
    el.left = h('aside', { class: 'side left' });
    el.right = h('aside', { class: 'side right' });
    el.center = h('section', { class: 'center' });
    el.body = h('div', { class: 'body' }, el.left, el.center, el.right);
    el.footer = h('footer');
    clear(root, el.header, el.body, el.footer);
    renderAllPanels();
}

function renderAllPanels() {
    renderHeader();
    if (app.tab === 'organiser') {
        cube?.dispose();
        net?.dispose();
        cube = null;
        net = null;
        organiser ??= new Organiser(() => app.store!, () => app.levels, (msg) => ((app.footer = msg), renderFooter()));
        organiser.mount(el.left, el.center, el.right);
        renderFooter();
        return;
    }
    organiser = null;
    renderSide(el.left, 'left', 'Levels', (box) => (el.levels = box));
    renderSide(el.right, 'right', 'Inspector', (box) => (el.inspector = box));
    el.details = h('div', { class: 'details' });
    el.gen = h('div', { class: 'gen' });
    el.tools = h('div', { class: 'tools' });
    el.viewport = h('div', { class: 'viewport' });
    clear(el.center, el.details, el.gen, h('div', { class: 'work' }, el.tools, el.viewport));
    renderLevels();
    renderDetails();
    renderGen();
    renderTools();
    renderViewport();
    renderInspector();
    renderFooter();
}

function refreshAll(full = false) {
    if (app.tab === 'organiser') return renderAllPanels();
    renderLevels();
    renderDetails();
    renderGen();
    refreshView(full);
    renderInspector();
    renderHeader();
    renderFooter();
    app.checks = app.cur ? checkLevel(app.cur) : [];
    renderInspector();
}

function renderSide(box: HTMLElement, side: 'left' | 'right', title: string, setBody: (b: HTMLElement) => void) {
    const collapsed = ui.get(`${side}Collapsed`, false);
    box.className = `side ${side}${collapsed ? ' collapsed' : ''}`;
    box.style.width = `${ui.get(`${side}Width`, side === 'left' ? 230 : 290)}px`;
    const body = h('div', { class: 'side-scroll' });
    const toggle = h('button', { class: 'ghost icon', title: collapsed ? 'Expand' : 'Collapse', onClick: () => (ui.set(`${side}Collapsed`, !collapsed), renderSide(box, side, title, setBody), side === 'left' ? renderLevels() : renderInspector()) }, (side === 'left') !== collapsed ? '‹' : '›');
    const resizer = h('div', { class: 'resizer' });
    resizer.addEventListener('pointerdown', (e) => {
        const startX = e.clientX;
        const startW = box.offsetWidth;
        const move = (ev: PointerEvent) => {
            const w = Math.max(170, Math.min(520, startW + (side === 'left' ? ev.clientX - startX : startX - ev.clientX)));
            box.style.width = `${w}px`;
        };
        const up = () => {
            ui.set(`${side}Width`, box.offsetWidth);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    clear(box, h('div', { class: 'side-head' }, side === 'right' && toggle, h('h3', {}, title), side === 'left' && toggle), body, !collapsed && resizer);
    setBody(body);
}

function renderHeader() {
    const store = app.store!;
    const tab = (t: 'editor' | 'organiser', label: string) =>
        h('button', { class: app.tab === t ? 'active' : '', onClick: () => {
            if (app.tab === t) return;
            app.tab = t;
            ui.set('tab', t);
            renderAllPanels();
        } }, label);
    const status = app.tab === 'organiser' ? '' : !app.cur ? '' : dirty() ? `${app.cur.name} · Unsaved changes` : 'Saved';
    clear(
        el.header,
        logo(),
        h('span', { class: 'app-name' }, 'Ring 360 Editor'),
        h('span', { class: 'tabs' }, tab('editor', 'Editor'), tab('organiser', 'Organiser')),
        h('span', { class: 'grow' }),
        h('span', { class: 'pill', title: store.kind === 'folder' ? 'Levels folder' : 'Saved in this browser only' }, store.kind === 'folder' ? `📁 ${store.label}` : store.label),
        h('button', { class: 'icon', title: 'Reload from storage (after editing files outside the editor)', onClick: async () => {
            app.levels = await store.listLevels();
            sortLevels();
            if (app.cur && !dirty()) await openLevel(app.cur.id);
            renderAllPanels();
        } }, '⟳'),
        h('button', { title: 'Change folder or storage', onClick: async () => {
            if (dirty() && !confirm('Discard unsaved changes?')) return;
            app.cur = null;
            app.saved = '';
            ui.set('store', '');
            renderConnect(folderSupported() ? await recallFolder() : null);
        } }, 'Change folder'),
        h('span', { class: 'status-saved' }, status),
        h('button', { class: 'icon', title: 'Undo (Ctrl/Cmd+Z)', disabled: !app.undo.length || app.tab !== 'editor', onClick: undo }, '↶'),
        h('button', { class: 'icon', title: 'Redo (Shift+Ctrl/Cmd+Z)', disabled: !app.redo.length || app.tab !== 'editor', onClick: redo }, '↷'),
        h('button', { class: 'icon', title: 'Save (Ctrl/Cmd+S)', disabled: !dirty() || app.tab !== 'editor', onClick: save }, '💾'),
        themeSwitch(),
        h('button', { class: 'primary', disabled: !app.cur, onClick: openPlay }, '▶ Play')
    );
}

/** "Dark" on/off switch. The game's Settings dialog writes the same stored value. */
function themeSwitch() {
    const input = h('input', { type: 'checkbox', checked: document.documentElement.dataset.theme !== 'light' });
    input.addEventListener('change', () => setTheme(input.checked ? 'dark' : 'light'));
    return h('label', { class: 'switch', title: 'Dark theme' }, input, h('span', { class: 'track' }), 'Dark');
}

function setTheme(theme: 'dark' | 'light') {
    document.documentElement.dataset.theme = theme;
    ui.set('theme', theme);
    net?.draw();
}

// Follow a theme change made in the game's Settings (another tab on the same site).
window.addEventListener('storage', (e) => {
    if (e.key !== 'ring360-ui:theme' || !e.newValue) return;
    document.documentElement.dataset.theme = JSON.parse(e.newValue);
    if (app.store) renderHeader();
});

/** Levels grouped by category: DEMO first, then other categories A-Z, then levels without one. */
function levelGroups(list: Level[]): [string, Level[]][] {
    const groups = new Map<string, Level[]>();
    for (const l of list) {
        const shown = app.cur && l.id === app.cur.id ? app.cur : l;
        const cat = shown.category.trim();
        const key = cat.toUpperCase() === DEMO_CATEGORY ? DEMO_CATEGORY : cat || 'Uncategorised';
        groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    const rank = (k: string) => (k === DEMO_CATEGORY ? 0 : k === 'Uncategorised' ? 2 : 1);
    return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function renderLevels() {
    if (!el.levels || app.tab !== 'editor') return;
    const q = app.search.toLowerCase();
    const list = app.levels.filter((l) => !q || l.id.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
    const search = h('input', { placeholder: 'Search name or id', value: app.search });
    search.addEventListener('input', () => {
        app.search = search.value;
        later('search', 120, () => {
            renderLevels();
            const s = el.levels.querySelector('input');
            s?.focus();
            (s as HTMLInputElement | null)?.setSelectionRange(app.search.length, app.search.length);
        });
    });
    clear(
        el.levels,
        h(
            'div',
            { class: 'row', style: { marginBottom: '8px', flexWrap: 'wrap' } },
            h('button', { class: 'icon', title: 'New level', onClick: newLevel }, '+'),
            h('button', { class: 'icon', title: 'Duplicate level', disabled: !app.cur, onClick: duplicateLevel }, '⧉'),
            h('button', { class: 'icon', title: 'Import JSON files (levels or a 2D layout bank)', onClick: importFiles }, '⇩'),
            h('button', { class: 'icon', title: 'Import a folder of levels', onClick: importFolder }, '▤'),
            h('button', { class: 'icon', title: 'Delete level', disabled: !app.cur, onClick: deleteLevel }, '🗑')
        ),
        search,
        h('div', { style: { height: '8px' } }),
        levelGroups(list).map(([group, items]) => {
            const collapsed = ui.get(`lvGroup:${group}`, false) && !q;
            return h(
                'div',
                { class: 'lv-group' },
                h(
                    'button',
                    { class: 'lv-group-head', onClick: () => (ui.set(`lvGroup:${group}`, !collapsed), renderLevels()) },
                    h('span', {}, collapsed ? '▸' : '▾'),
                    h('span', { class: 'grow' }, group),
                    h('span', { class: 'muted' }, String(items.length))
                ),
                !collapsed &&
                    items.map((l, i) => {
                        const shown = app.cur && l.id === app.cur.id ? app.cur : l;
                        const faces = new Set(shown.pieces.map((p) => p.face)).size;
                        return h(
                            'div',
                            { class: `lv${app.cur?.id === l.id ? ' active' : ''}`, onClick: () => app.cur?.id !== l.id && openLevel(l.id) },
                            h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
                            h('span', { class: 'name', title: l.id }, shown.name, app.cur?.id === l.id && dirty() ? ' •' : ''),
                            app.cur?.id === l.id
                                ? h('button', { class: 'ghost icon', title: 'Older versions', onClick: (e: Event) => (e.stopPropagation(), showVersions(e.currentTarget as HTMLElement)) }, '🕘')
                                : h('span'),
                            h('span', { class: 'sub' }, `${shown.pieces.length} pcs · ${faces} face${faces === 1 ? '' : 's'} `, h('span', { class: 'tag' }, shown.difficulty), ` ${shown.status}`)
                        );
                    })
            );
        }),
        !list.length && h('p', { class: 'muted' }, app.levels.length ? 'No match' : 'No levels yet: press + or import some.')
    );
}

async function showVersions(anchor: HTMLElement) {
    if (!app.cur || !app.store) return;
    const versions = await app.store.listVersions(app.cur.id);
    const r = anchor.getBoundingClientRect();
    const pop = h('div', { class: 'popover', style: { left: `${r.left}px`, top: `${r.bottom + 4}px` } });
    const close = () => (pop.remove(), window.removeEventListener('pointerdown', outside));
    const outside = (e: Event) => !pop.contains(e.target as Node) && close();
    clear(
        pop,
        h('div', { class: 'cap', style: { padding: '4px 6px' } }, 'Saved versions'),
        versions.length
            ? versions.map((v) =>
                  h('button', { class: 'ghost', onClick: () => {
                      close();
                      const keepVersion = app.cur!.version;
                      edit((lv) => Object.assign(lv, cloneLevel(v), { version: keepVersion, id: lv.id }));
                      app.footer = `Loaded version ${v.version} as unsaved changes · Save to keep it`;
                      renderFooter();
                  } }, `Version ${v.version} · ${v.pieces.length} pcs`)
              )
            : h('div', { class: 'muted', style: { padding: '6px' } }, 'No older versions yet')
    );
    document.body.append(pop);
    setTimeout(() => window.addEventListener('pointerdown', outside), 0);
}

function renderDetails() {
    if (!el.details) return;
    const lv = app.cur;
    if (!lv) return clear(el.details, h('span', { class: 'muted' }, 'No level open'));
    const name = h('input', { value: lv.name });
    name.addEventListener('input', () => later('name', 500, () => writeMeta({ name: name.value })));
    const id = h('input', { value: lv.id });
    id.addEventListener('change', () => renameId(id.value));
    const sel = <T extends string>(value: T, opts: T[], on: (v: T) => void) => {
        const s = h('select', {}, opts.map((o) => h('option', { value: o, selected: o === value }, o)));
        s.addEventListener('change', () => on(s.value as T));
        return s;
    };
    const cat = h('input', { value: lv.category, placeholder: 'e.g. tutorial' });
    cat.addEventListener('input', () => later('cat', 500, () => writeMeta({ category: cat.value })));
    clear(
        el.details,
        h('label', {}, h('div', { class: 'cap' }, 'Name'), name),
        h('label', {}, h('div', { class: 'cap' }, 'Id'), id),
        h('label', {}, h('div', { class: 'cap' }, 'Status'), sel<Status>(lv.status, ['WIP', 'PROD', 'ARCHIVE'], (v) => writeMeta({ status: v }))),
        h('label', {}, h('div', { class: 'cap' }, 'Difficulty'), sel<Difficulty>(lv.difficulty, ['normal', 'hard', 'super_hard'], (v) => writeMeta({ difficulty: v }))),
        h('label', {}, h('div', { class: 'cap' }, 'Category'), cat)
    );
}

function renderGen() {
    if (!el.gen) return;
    const P = app.params;
    const num = (value: number, on: (v: number) => void, cls = '') => {
        const i = h('input', { type: 'number', value, class: cls });
        i.addEventListener('change', () => on(Number(i.value)));
        return i;
    };
    const range = (label: string, r: { min: number; max: number }, title = '') =>
        h('span', { class: 'f', title }, label, num(r.min, (v) => (r.min = v)), '–', num(r.max, (v) => (r.max = v)));
    const preset = h('select', {}, Object.keys(PRESETS).map((k) => h('option', { value: k, selected: k === app.preset }, k)));
    preset.addEventListener('change', () => {
        app.preset = preset.value as keyof typeof PRESETS;
        app.params = structuredClone(PRESETS[app.preset]);
        renderGen();
    });
    const more = ui.get('genMore', false);
    clear(
        el.gen,
        h('span', { class: 'cap' }, 'Generator'),
        h('span', { class: 'f' }, preset),
        h('span', { class: 'f' }, 'Seed', num(app.seed, (v) => (app.seed = v), 'wide'), h('button', { class: 'ghost icon', title: 'Random seed', onClick: () => ((app.seed = Math.floor(Math.random() * 90000) + 1000), renderGen()) }, '🎲')),
        h('span', { class: 'f' }, 'Faces', num(P.faces, (v) => (P.faces = Math.max(1, Math.min(6, v))))),
        h('span', { class: 'f', title: 'Share of hooks that reach over a cube edge' }, 'Edge hooks %', num(Math.round(P.edgeHookShare * 100), (v) => (P.edgeHookShare = v / 100))),
        h('span', { class: 'grow' }),
        h('button', { class: 'ghost', onClick: () => (ui.set('genMore', !more), renderGen()) }, more ? 'Less ▴' : 'More ▾'),
        h('button', { class: 'primary', disabled: app.genBusy || !app.cur, onClick: generateLevel }, app.genBusy ? 'Generating…' : 'Generate'),
        h('span', { class: 'break' }),
        h('span', { class: 'group' }, 'Difficulty'),
        range('Depth', P.depth, 'Longest chain of holds'),
        h('span', { class: 'f', title: 'Most pieces one ring holds' }, 'Ring holds ≤', num(P.maxOwn, (v) => (P.maxOwn = v))),
        h('span', { class: 'f', title: 'Most hooks on one piece' }, 'Hooks/piece ≤', num(P.maxHeld, (v) => (P.maxHeld = v))),
        range('Bars', P.bars),
        range('Bombs', P.bombs),
        more && h('span', { class: 'break' }),
        more && range('C rings', P.rings),
        more && range('Closed', P.closed),
        more && range('Screws', P.screws),
        more && h('span', { class: 'f' }, 'Colours', num(P.colors, (v) => (P.colors = v))),
        more && range('Radius', P.radius),
        more && range('Gap°', P.gap)
    );
}

function renderTools() {
    if (!el.tools) return;
    clear(
        el.tools,
        TOOLS.map((t) => h('button', { class: app.tool === t.tool ? 'on' : '', title: t.title, onClick: () => setTool(t.tool) }, t.label))
    );
    el.viewport?.querySelector('.tool-hint')?.remove();
    const hint =
        app.tool === 'hook'
            ? app.hookOwner
                ? `Now click the piece ${app.hookOwner} should hold`
                : 'Click the ring that holds'
            : app.tool === 'select'
              ? ''
              : app.tool === 'bomb'
                ? 'Click a piece to add or remove its bomb'
                : `Click a face to place ${app.tool === 'fixed-bomb' ? 'a fixed bomb' : `a ${app.tool}`}`;
    if (hint && el.viewport) el.viewport.append(h('div', { class: 'tool-hint' }, hint, ' · Esc to cancel'));
}

function renderViewport() {
    cube?.dispose();
    net?.dispose();
    cube = null;
    net = null;
    const layer = h('div', { class: 'layer' });
    const buttons = h(
        'div',
        { class: 'vp-buttons' },
        h('button', { class: app.view === '3d' ? 'on' : '', onClick: () => ((app.view = '3d'), ui.set('view', '3d'), renderViewport(), renderTools()) }, '3D'),
        h('button', { class: app.view === 'net' ? 'on' : '', onClick: () => ((app.view = 'net'), ui.set('view', 'net'), renderViewport(), renderTools()) }, 'Net'),
        app.view === '3d' && h('button', { onClick: () => cube?.resetView() }, 'Fit view')
    );
    const hint = h('div', { class: 'vp-hint' }, app.view === '3d' ? 'Drag: orbit cube · Wheel: zoom · Drag a selected piece: move it' : 'Click: select · Drag: move (across faces too) · Del: delete');
    clear(el.viewport, layer, buttons, hint);
    if (app.view === '3d') {
        cube = new CubeView(layer);
        bind3D(layer);
    } else {
        net = new NetView(layer);
        bindNet(layer);
    }
    refreshView(true);
}

function refreshView(full = false) {
    if (!app.cur) {
        if (cube) cube.setLevel(emptyLevel('none'));
        net?.setLevel(emptyLevel('none'));
        return;
    }
    if (cube) {
        cube.selected = app.sel;
        cube.setLevel(app.cur);
        if (full) cube.resetView();
    }
    if (net) {
        net.selected = app.sel;
        net.setLevel(app.cur);
    }
}

function bind3D(layer: HTMLElement) {
    let mode: 'none' | 'orbit' | 'move' = 'none';
    let last = { x: 0, y: 0 };
    let downAt = { x: 0, y: 0 };
    let grab: Vec2 | null = null;
    layer.addEventListener('pointerdown', (e) => {
        if (!cube || !app.cur) return;
        layer.setPointerCapture(e.pointerId);
        last = downAt = { x: e.clientX, y: e.clientY };
        const hit = cube.pick(e.clientX, e.clientY);
        if (app.tool !== 'select') {
            toolClick(hit.pieceId, hit.face, hit.pieceId ? pieceLocal(hit.pieceId, e) : hit.local);
            mode = 'none';
            return;
        }
        if (hit.pieceId && hit.pieceId === app.sel) {
            const p = app.cur.pieces.find((q) => q.id === hit.pieceId)!;
            const at = cube.facePoint(p.face, e.clientX, e.clientY);
            grab = at ? { x: at.x - p.x, y: at.y - p.y } : null;
            mode = grab ? 'move' : 'orbit';
        } else {
            mode = 'orbit';
        }
    });
    layer.addEventListener('pointermove', (e) => {
        if (!cube || !app.cur || mode === 'none') return;
        if (mode === 'orbit') {
            cube.orbit(e.clientX - last.x, e.clientY - last.y);
            last = { x: e.clientX, y: e.clientY };
            return;
        }
        const p = app.cur.pieces.find((q) => q.id === app.sel);
        if (!p || !grab) return;
        const hit = cube.pick(e.clientX, e.clientY);
        const face = hit.face ?? p.face;
        const at = cube.facePoint(face, e.clientX, e.clientY);
        if (!at) return;
        const g = grab;
        edit((lv) => {
            const q = lv.pieces.find((x) => x.id === p.id)!;
            if (face !== q.face) {
                q.face = face;
                for (const c of lv.connections) if (c.target === q.id) delete c.anchor;
            }
            moveTo(lv, q, Math.round(at.x - g.x), Math.round(at.y - g.y));
        }, `move:${p.id}`);
    });
    layer.addEventListener('pointerup', (e) => {
        if (!cube || !app.cur) return;
        const click = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4;
        if (click && app.tool === 'select' && mode !== 'none') select(cube.pick(e.clientX, e.clientY).pieceId ?? null);
        mode = 'none';
    });
    layer.addEventListener('wheel', (e) => (e.preventDefault(), cube?.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08)), { passive: false });
}

function pieceLocal(id: string, e: PointerEvent): Vec2 | undefined {
    const p = app.cur!.pieces.find((q) => q.id === id)!;
    return cube?.facePoint(p.face, e.clientX, e.clientY) ?? undefined;
}

/** Moves a piece and drags the sleeves on it along so hooks stay on its wire. */
function moveTo(lv: Level, p: Piece, x: number, y: number) {
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    for (const c of lv.connections) if (c.target === p.id && c.anchor) c.anchor = { x: c.anchor.x + dx, y: c.anchor.y + dy };
}

function bindNet(layer: HTMLElement) {
    let dragging: { id: string; grab: Vec2 } | null = null;
    layer.addEventListener('pointerdown', (e) => {
        if (!net || !app.cur) return;
        const at = net.locate(e.clientX, e.clientY);
        const pid = net.pick(e.clientX, e.clientY) ?? undefined;
        if (app.tool !== 'select') {
            if (at && (at.inside || pid)) toolClick(pid, at.face, at.local);
            return;
        }
        select(pid ?? null);
        if (pid && at) {
            const p = app.cur.pieces.find((q) => q.id === pid)!;
            dragging = { id: pid, grab: { x: at.local.x - p.x, y: at.local.y - p.y } };
            layer.setPointerCapture(e.pointerId);
        }
    });
    layer.addEventListener('pointermove', (e) => {
        if (!net || !app.cur || !dragging) return;
        const at = net.locate(e.clientX, e.clientY);
        if (!at) return;
        const d = dragging;
        edit((lv) => {
            const q = lv.pieces.find((x) => x.id === d.id)!;
            if (at.inside && at.face !== q.face) {
                q.face = at.face;
                for (const c of lv.connections) if (c.target === q.id) delete c.anchor;
            }
            const local = at.face === q.face ? at.local : null;
            if (local) moveTo(lv, q, Math.round(local.x - d.grab.x), Math.round(local.y - d.grab.y));
        }, `move:${d.id}`);
    });
    layer.addEventListener('pointerup', () => (dragging = null));
}

// ---------------- inspector ----------------

function renderInspector() {
    if (!el.inspector || app.tab !== 'editor') return;
    const lv = app.cur;
    if (!lv) return clear(el.inspector, h('p', { class: 'muted' }, 'Open or create a level.'));
    const p = lv.pieces.find((q) => q.id === app.sel);
    clear(el.inspector, p ? pieceInspector(lv, p) : levelInspector(lv), checksBlock(), simBlock());
}

function field(label: string, input: HTMLElement) {
    return [h('span', { class: 'k' }, label), input];
}

function numIn(value: number, on: (v: number) => void, step = 1) {
    const i = h('input', { type: 'number', value: Math.round(value * 10) / 10, step });
    i.addEventListener('input', () => i.value !== '' && on(Number(i.value)));
    return i;
}

function pieceInspector(lv: Level, p: Piece) {
    const set = (k: string, fn: (q: Piece) => void) => edit((l) => fn(l.pieces.find((x) => x.id === p.id)!), `${p.id}:${k}`);
    const id = h('input', { value: p.id });
    id.addEventListener('change', () => renamePiece(p.id, id.value));
    const face = h('select', {}, FACES.map((f) => h('option', { value: f, selected: f === p.face }, f)));
    face.addEventListener('change', () => set('face', (q) => {
        q.face = face.value as FaceId;
        for (const c of lv.connections) if (c.target === q.id) delete c.anchor;
    }));
    const color = h('select', {}, COLOR_NAMES.map((c) => h('option', { value: c, selected: c === p.color }, c)));
    color.addEventListener('change', () => set('color', (q) => (q.color = color.value)));
    const holds = lv.connections.filter((c) => c.owner === p.id);
    const heldBy = lv.connections.filter((c) => c.target === p.id);
    const chip = (label: string, go: string, c: { owner: string; target: string }) =>
        h('span', { class: 'chip', onClick: () => select(go) }, label, h('button', { title: 'Remove hook', onClick: (e: Event) => {
            e.stopPropagation();
            edit((l) => (l.connections = l.connections.filter((x) => !(x.owner === c.owner && x.target === c.target))));
        } }, '×'));
    let pathBox: HTMLTextAreaElement | null = null;
    if (!isRing(p)) {
        pathBox = h('textarea', { rows: 3 }, JSON.stringify(p.path ?? defaultPath(p.type)));
        pathBox.addEventListener('change', () => {
            try {
                const path = JSON.parse(pathBox!.value) as Vec2[];
                if (Array.isArray(path) && path.length >= 2) set('path', (q) => (q.path = path));
            } catch {
                app.footer = 'Path must be JSON like [{"x":-50,"y":0},{"x":50,"y":0}]';
                renderFooter();
            }
        });
    }
    return h(
        'div',
        {},
        h('div', { class: 'cap' }, `Selection · ${p.type === 'ring' ? 'C ring' : p.type === 'closed' ? 'closed ring' : p.type === 'rolling-elbow' ? 'screw' : p.type}`),
        h(
            'div',
            { class: 'kv' },
            field('Id', id),
            field('Face', face),
            field('x', numIn(p.x, (v) => set('x', (q) => moveTo(app.cur!, q, v, q.y)))),
            field('y', numIn(p.y, (v) => set('y', (q) => moveTo(app.cur!, q, q.x, v)))),
            field(p.type === 'ring' ? 'Gap dir °' : 'Rotation °', numIn(p.rotation, (v) => set('rot', (q) => (q.rotation = v)), 5)),
            isRing(p) && field('Radius', numIn(p.radius ?? 48, (v) => set('radius', (q) => (q.radius = Math.max(10, v))))),
            p.type === 'ring' && field('Gap °', numIn(p.gap ?? 110, (v) => set('gap', (q) => (q.gap = Math.max(10, Math.min(300, v)))), 5)),
            field('Colour', h('span', { class: 'row' }, h('span', { class: 'swatch', style: { background: COLORS[p.color] ?? p.color } }), color)),
            pathBox && field('Path', pathBox),
            p.bomb && isRing(p) && field('Bomb °', numIn(p.bomb.angle ?? 0, (v) => set('bomb', (q) => (q.bomb = { angle: v })), 5))
        ),
        h('div', { class: 'cap' }, 'Holds'),
        h('div', { class: 'chips', style: { margin: '4px 0 8px' } }, holds.length ? holds.map((c) => chip(c.target, c.target, c)) : h('span', { class: 'muted' }, isRing(p) ? 'nothing' : 'bars cannot hold')),
        h('div', { class: 'cap' }, 'Held by'),
        h('div', { class: 'chips', style: { margin: '4px 0 8px' } }, heldBy.length ? heldBy.map((c) => chip(c.owner, c.owner, c)) : h('span', { class: 'muted' }, 'nothing')),
        h(
            'div',
            { class: 'row', style: { flexWrap: 'wrap' } },
            isRing(p) && h('button', { onClick: () => ((app.tool = 'hook'), (app.hookOwner = p.id), renderTools()) }, '+ Hook'),
            h('button', { onClick: () => toggleBomb(p.id) }, p.bomb ? '− Bomb' : '+ Bomb'),
            h('button', { onClick: () => deletePiece(p.id) }, 'Delete'),
            h('button', { class: 'ghost', onClick: () => select(null) }, 'Deselect')
        )
    );
}

function levelInspector(lv: Level) {
    const instr = h('textarea', { rows: 2, placeholder: 'Shown at the top of the game screen' }, lv.instruction ?? '');
    instr.addEventListener('input', () => edit((l) => (l.instruction = instr.value || undefined), 'instruction'));
    return h(
        'div',
        {},
        h('div', { class: 'cap' }, 'Level'),
        h(
            'div',
            { class: 'kv' },
            field('Pieces', h('span', {}, `${lv.pieces.length} · ${lv.connections.length} hooks`)),
            field('Cube size', numIn(lv.cubeSize, (v) => edit((l) => (l.cubeSize = Math.max(200, v)), 'cube'), 10)),
            field('Bomb radius', h('span', { class: 'row' }, numIn(lv.bombRadius, (v) => edit((l) => (l.bombRadius = Math.max(0, v)), 'blast'), 5), h('span', { class: 'tbd', title: 'Value to be settled in testing' }, 'TBD'))),
            field('Fixed bombs', h('span', { class: 'row' }, String(lv.fixedBombs.length), lv.fixedBombs.length > 0 && h('button', { class: 'ghost', onClick: () => edit((l) => l.fixedBombs.pop()) }, 'Remove last'))),
            field('Instruction', instr),
            lv.generator && field('Generated', h('span', { class: 'muted' }, `${lv.generator.preset} · seed ${lv.generator.seed}`))
        ),
        h('p', { class: 'muted' }, 'Click a piece to edit it. Tools on the left add pieces, hooks and bombs.')
    );
}

function checksBlock() {
    return h(
        'div',
        { class: 'section' },
        h('div', { class: 'cap' }, 'Level checks'),
        app.checks.map((c) =>
            h('div', { class: `check ${c.ok ? 'ok' : 'bad'}`, title: c.pieces ? 'Click to select' : '', onClick: () => c.pieces?.[0] && select(c.pieces[0]) }, c.ok ? '✓ ' : '⚠ ', c.text)
        )
    );
}

function simBlock() {
    const s = app.sim;
    const row = (k: string, v: Node | string) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '2px 0' } }, h('span', { class: 'muted' }, k), v);
    return h(
        'div',
        { class: 'section' },
        h('div', { class: 'cap' }, 'Simulation'),
        s
            ? [
                  row('Solvable', h('span', { style: { color: s.solvable ? 'var(--ok)' : 'var(--bad)' } }, s.solvable ? 'yes' : s.truncated ? 'not found (search limit)' : 'no')),
                  row(s.exact ? 'Min moves' : 'Moves (found)', s.minMoves === null ? '—' : s.exact ? String(s.minMoves) : `≤ ${s.minMoves}`),
                  row('Dead ends', String(s.deadEnds)),
                  row('Pieces movable at start', String(s.openingMoves)),
                  row('Positions explored', String(s.explored)),
                  row('Difficulty score', h('span', { class: 'tbd' }, 'TBD'))
              ]
            : h('p', { class: 'muted' }, 'Not run for this version of the level.'),
        h('button', { style: { marginTop: '6px' }, disabled: app.simBusy || !app.cur, onClick: simulateLevel }, app.simBusy ? 'Running…' : 'Run simulation')
    );
}

function renderFooter() {
    if (el.footer) el.footer.textContent = app.footer;
}

// ---------------- play test ----------------

function openPlay() {
    if (!app.cur) return;
    const level = cloneLevel(app.cur);
    const src = `${import.meta.env.DEV ? '../' : '../demo/'}?embed=1`;
    const frame = h('iframe', { src, title: 'Play test' });
    const close = () => {
        overlay.remove();
        window.removeEventListener('message', onMsg);
        window.removeEventListener('keydown', onKey);
    };
    const onMsg = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow) return;
        if (e.data?.type === 'ring360:ready') frame.contentWindow!.postMessage({ type: 'ring360:play', level }, '*');
        if (e.data?.type === 'ring360:back') close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const overlay = h('div', { class: 'play-overlay' }, frame, h('button', { class: 'close', onClick: close }, '✕ Close'));
    window.addEventListener('message', onMsg);
    window.addEventListener('keydown', onKey);
    document.body.append(overlay);
}

// ---------------- keyboard ----------------

window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).closest('input, textarea, select');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (app.tab === 'editor' && dirty()) save();
        return;
    }
    if (typing || app.tab !== 'editor') return;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel) {
        deletePiece(app.sel);
    } else if (e.key === 'Escape') {
        setTool('select');
        select(null);
    } else if (e.key.toLowerCase() === 'v') {
        setTool('select');
    } else if (app.sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        const id = app.sel;
        edit((lv) => {
            const q = lv.pieces.find((x) => x.id === id)!;
            moveTo(lv, q, q.x + d[0], q.y + d[1]);
        }, `move:${id}`);
    }
});

window.addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
});

boot();
