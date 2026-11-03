// Level generator. The placement rule here is a placeholder (a 3x3 grid of slots per face); the result is
// always run through the simulator, and the seed is bumped until a solvable level comes out.
import { type FaceId, type GeneratorParams, type Level, type Piece, type Vec2, COLOR_NAMES, emptyLevel } from './types';
import { to3D, unfold, type V3 } from './cube';
import { angleOf, barPath, closestOnPolyline, polar, wrap, defaultPath } from './geom';
import { simulate, type SimResult } from './sim';

export const PRESETS: Record<'Normal' | 'Hard' | 'Super hard', GeneratorParams> = {
    Normal: {
        faces: 4, edgeHookShare: 0.2, maxOwn: 3, maxHeld: 3, colors: 7,
        rings: { min: 9, max: 16 }, closed: { min: 0, max: 3 }, bars: { min: 1, max: 8 }, screws: { min: 0, max: 0 },
        bombs: { min: 0, max: 0 }, depth: { min: 3, max: 5 }, radius: { min: 44, max: 55 }, gap: { min: 100, max: 135 }
    },
    Hard: {
        faces: 4, edgeHookShare: 0.2, maxOwn: 3, maxHeld: 3, colors: 7,
        rings: { min: 12, max: 16 }, closed: { min: 1, max: 3 }, bars: { min: 3, max: 8 }, screws: { min: 0, max: 1 },
        bombs: { min: 0, max: 1 }, depth: { min: 4, max: 6 }, radius: { min: 44, max: 55 }, gap: { min: 100, max: 135 }
    },
    'Super hard': {
        faces: 4, edgeHookShare: 0.2, maxOwn: 4, maxHeld: 3, colors: 7,
        rings: { min: 10, max: 16 }, closed: { min: 0, max: 3 }, bars: { min: 6, max: 10 }, screws: { min: 0, max: 2 },
        bombs: { min: 1, max: 2 }, depth: { min: 3, max: 6 }, radius: { min: 44, max: 55 }, gap: { min: 100, max: 135 }
    }
};

export const DIFFICULTY_OF: Record<string, Level['difficulty']> = { Normal: 'normal', Hard: 'hard', 'Super hard': 'super_hard' };

const FACE_ORDER: FaceId[] = ['front', 'right', 'top', 'left', 'bottom', 'back'];
const SPACING = 130;

export function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Slot {
    face: FaceId;
    x: number;
    y: number;
    p3: V3;
}

export interface GenerateResult {
    level: Level;
    seed: number;
    attempts: number;
    sim: SimResult;
}

export function generate(id: string, preset: string, params: GeneratorParams, seed: number, maxAttempts = 12): GenerateResult {
    let last: GenerateResult | null = null;
    for (let k = 0; k < maxAttempts; k++) {
        const level = buildOnce(id, params, seed + k);
        level.difficulty = DIFFICULTY_OF[preset] ?? 'normal';
        level.generator = { preset, seed: seed + k, params };
        const sim = simulate(level);
        last = { level, seed: seed + k, attempts: k + 1, sim };
        if (sim.solvable) return last;
    }
    return last!;
}

function buildOnce(id: string, P: GeneratorParams, seed: number): Level {
    const rnd = mulberry32(seed);
    const ri = (r: { min: number; max: number }) => Math.floor(r.min + rnd() * (r.max - r.min + 1));
    const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
    const level = emptyLevel(id);
    const S = level.cubeSize;

    let nRings = ri(P.rings);
    const nClosed = ri(P.closed);
    const nBars = ri(P.bars);
    const nScrews = ri(P.screws);
    const nBombs = Math.min(ri(P.bombs), nClosed);
    const depthMax = Math.max(1, ri(P.depth));
    const faces = FACE_ORDER.slice(0, Math.max(1, Math.min(6, P.faces)));
    const capacity = faces.length * 9;
    nRings = Math.max(2, Math.min(nRings, capacity - nClosed - nBars - nScrews));
    const total = Math.min(capacity, nRings + nClosed + nBars + nScrews);

    // 1. Slots: grow a connected cluster across the chosen faces, filling faces evenly.
    const slots: Slot[] = [];
    for (const face of faces) {
        for (const gy of [-1, 0, 1]) for (const gx of [-1, 0, 1]) slots.push({ face, x: gx * SPACING, y: gy * SPACING, p3: to3D(face, gx * SPACING, gy * SPACING, S).p });
    }
    const near = (a: Slot, b: Slot) => a !== b && Math.hypot(a.p3[0] - b.p3[0], a.p3[1] - b.p3[1], a.p3[2] - b.p3[2]) < SPACING * 1.45;
    const chosen: Slot[] = [pick(slots.filter((s) => s.face === faces[0]))];
    const perFace = new Map<FaceId, number>([[faces[0], 1]]);
    while (chosen.length < total) {
        const frontier = slots.filter((s) => !chosen.includes(s) && chosen.some((c) => near(c, s)));
        if (!frontier.length) break;
        const minFill = Math.min(...frontier.map((s) => perFace.get(s.face) ?? 0));
        const s = pick(frontier.filter((f) => (perFace.get(f.face) ?? 0) <= minFill + 1));
        chosen.push(s);
        perFace.set(s.face, (perFace.get(s.face) ?? 0) + 1);
    }

    // 2. Types: closed rings early (they hold), bars and screws late (always held).
    const n = chosen.length;
    const types: Piece['type'][] = new Array(n).fill('ring');
    const lateIdx = [...Array(n).keys()].slice(Math.floor(n * 0.4)).sort(() => rnd() - 0.5);
    let li = 0;
    for (let k = 0; k < nBars && li < lateIdx.length; k++) types[lateIdx[li++]] = pick(['bar', 'bar', 'elbow', 'u'] as const);
    for (let k = 0; k < nScrews && li < lateIdx.length; k++) types[lateIdx[li++]] = 'rolling-elbow';
    const earlyIdx = [...Array(n).keys()].filter((k) => types[k] === 'ring').slice(0, Math.max(1, Math.floor(n * 0.6))).sort(() => rnd() - 0.5);
    for (let k = 0; k < nClosed && k < earlyIdx.length; k++) types[earlyIdx[k]] = 'closed';
    if (types[0] !== 'ring' && types[0] !== 'closed') types[0] = 'ring';

    // 3. Holds: each piece picks earlier neighbours as owners (keeps the graph acyclic).
    const depth: number[] = new Array(n).fill(0);
    const owners: number[][] = chosen.map(() => []);
    const ownCount: number[] = new Array(n).fill(0);
    const canOwn = (k: number) => types[k] === 'ring' || types[k] === 'closed';
    for (let k = 1; k < n; k++) {
        let cands = [...Array(k).keys()].filter((j) => canOwn(j) && near(chosen[j], chosen[k]) && ownCount[j] < P.maxOwn && depth[j] + 1 < depthMax + 1);
        // Closed rings are held only when a bomb can free them.
        if (types[k] === 'closed' && owners.filter((o, i) => types[i] === 'closed' && o.length).length >= nBombs) cands = [];
        if (!cands.length) continue;
        const cross = cands.filter((j) => chosen[j].face !== chosen[k].face);
        const deep = [...cands].sort((a, b) => depth[b] - depth[a]);
        const first = cross.length && rnd() < P.edgeHookShare ? pick(cross) : rnd() < 0.6 ? deep[0] : pick(cands);
        owners[k].push(first);
        const extra = Math.floor(rnd() * Math.min(P.maxHeld, 2));
        for (let e = 0; e < extra; e++) {
            const more = cands.filter((j) => !owners[k].includes(j));
            if (!more.length) break;
            owners[k].push(pick(more));
        }
        for (const j of owners[k]) ownCount[j]++;
        depth[k] = Math.max(...owners[k].map((j) => depth[j])) + 1;
    }
    // Pieces with no hook at all would break at once: hang them on any neighbouring owner, else drop them.
    const keep = new Array(n).fill(true);
    for (let k = 0; k < n; k++) {
        if (owners[k].length || ownCount[k]) continue;
        const j = [...Array(n).keys()].find((j) => j !== k && canOwn(j) && near(chosen[j], chosen[k]) && !owners[j].includes(k) && ownCount[j] < P.maxOwn && types[k] !== 'closed');
        if (j !== undefined) {
            owners[k].push(j);
            ownCount[j]++;
        } else keep[k] = false;
    }

    // 4. Geometry.
    const colors = COLOR_NAMES.slice(0, Math.max(2, Math.min(COLOR_NAMES.length, P.colors)));
    const counters: Record<string, number> = {};
    const prefix: Record<string, string> = { ring: 'r', closed: 'c', bar: 'b', elbow: 'l', u: 'u', 'rolling-elbow': 's' };
    const pieces: (Piece | null)[] = chosen.map((s, k) => {
        if (!keep[k]) return null;
        const t = types[k];
        counters[t] = (counters[t] ?? 0) + 1;
        const p: Piece = {
            id: `${prefix[t]}${counters[t]}`,
            type: t,
            face: s.face,
            x: Math.round(s.x + (rnd() - 0.5) * 12),
            y: Math.round(s.y + (rnd() - 0.5) * 12),
            color: pick(colors),
            rotation: 0
        };
        if (t === 'ring' || t === 'closed') {
            p.radius = Math.min(56, ri(P.radius));
            if (t === 'ring') p.gap = ri(P.gap);
        } else {
            p.path = defaultPath(t).map((q) => ({ x: q.x * 0.9, y: q.y * 0.9 }));
        }
        return p;
    });
    const live = (k: number) => pieces[k] as Piece;

    // Bars face their first owner so the sleeve lands mid-leg and the bar can slide out sideways.
    for (let k = 0; k < n; k++) {
        const p = pieces[k];
        if (!p || p.type === 'ring' || p.type === 'closed' || !owners[k].length) continue;
        const o = unfold(live(owners[k][0]).face, live(owners[k][0]), p.face, S);
        const toOwner = angleOf(p, o);
        p.rotation = Math.round((toOwner + 90) / 90) * 90;
    }

    // Bombs: a C ring next to a held closed ring is moved so the two circles cross; the bomb rides on it.
    const descendants = (root: number) => {
        const out = new Set<number>();
        const walk = (k: number) => {
            for (let t = 0; t < n; t++) if (owners[t].includes(k) && !out.has(t)) (out.add(t), walk(t));
        };
        walk(root);
        return out;
    };
    // Make sure enough closed rings are held for the requested bombs.
    for (const k of [...Array(n).keys()].filter((k) => pieces[k]?.type === 'closed' && !owners[k].length)) {
        if ([...Array(n).keys()].filter((i) => pieces[i]?.type === 'closed' && owners[i].length).length >= nBombs) break;
        const desc = descendants(k);
        const j = [...Array(n).keys()].find((j) => j !== k && pieces[j] && canOwn(j) && !desc.has(j) && near(chosen[j], chosen[k]) && ownCount[j] < P.maxOwn);
        if (j === undefined) continue;
        owners[k].push(j);
        ownCount[j]++;
    }
    const heldClosed = [...Array(n).keys()].filter((k) => pieces[k]?.type === 'closed' && owners[k].length);
    let bombsPlaced = 0;
    const hosts = new Set<number>();
    for (const k of heldClosed) {
        if (bombsPlaced >= nBombs) break;
        const c = live(k);
        const host = [...Array(n).keys()].find(
            (j) =>
                pieces[j]?.type === 'ring' &&
                !hosts.has(j) &&
                chosen[j].face === c.face &&
                near(chosen[j], chosen[k]) &&
                !owners[j].includes(k) &&
                !owners[k].includes(j)
        );
        if (host === undefined) continue;
        hosts.add(host);
        const h = live(host);
        const d = (c.radius ?? 48) + (h.radius ?? 48) - 14;
        const moved = polar(c, d, angleOf(c, h));
        h.x = Math.round(moved.x);
        h.y = Math.round(moved.y);
        h.bomb = { angle: Math.round(wrap(angleOf(h, c) + (rnd() < 0.5 ? 70 : -70))) };
        bombsPlaced++;
    }

    // A held closed ring with no bomb next to it could never be freed: let it go.
    for (const k of heldClosed) {
        const c = live(k);
        const hasBomb = pieces.some((p) => p?.bomb && p.face === c.face && Math.hypot(p.x - c.x, p.y - c.y) < 2 * SPACING);
        if (!hasBomb) {
            for (const j of owners[k]) ownCount[j]--;
            owners[k] = [];
            if (!ownCount[k]) pieces[k] = null;
        }
    }

    // Connections and ring rotations (no sleeve may start inside a gap).
    const conns: Level['connections'] = [];
    for (let k = 0; k < n; k++) {
        const t = pieces[k];
        if (!t) continue;
        let leg: { x: number; y: number } | null = null;
        for (const j of owners[k]) {
            const o = pieces[j];
            if (!o) continue;
            const ou = unfold(o.face, o, t.face, S);
            let anchor: Vec2;
            if (t.type === 'ring' || t.type === 'closed') anchor = polar(t, t.radius ?? 48, angleOf(t, ou));
            else {
                // Screws are hooked on their long leg; every sleeve on a bar must sit on parallel legs.
                const pts = barPath(t);
                const legs = t.type === 'rolling-elbow' ? pts.slice(0, 2) : pts;
                const hit = closestOnPolyline(ou, legs);
                const a = legs[hit.seg];
                const b = legs[hit.seg + 1];
                const d = { x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) };
                if (leg && Math.abs(leg.x * d.y - leg.y * d.x) > 0.1) continue;
                leg = d;
                anchor = hit.point;
            }
            conns.push({ owner: o.id, target: t.id, anchor: { x: Math.round(anchor.x * 10) / 10, y: Math.round(anchor.y * 10) / 10 } });
        }
    }
    // Drop pieces that ended up with no hook at all.
    const used = new Set(conns.flatMap((c) => [c.owner, c.target]));
    for (let k = 0; k < n; k++) if (pieces[k] && !used.has(pieces[k]!.id)) pieces[k] = null;
    for (const p of pieces) {
        if (!p || p.type !== 'ring') continue;
        // Sleeves holding this ring, and the roots of its own stems, must stay clear of its gap.
        const phis = conns.filter((c) => c.target === p.id).map((c) => angleOf(p, c.anchor!));
        for (const c of conns.filter((c) => c.owner === p.id)) {
            const t = pieces.find((q) => q?.id === c.target)!;
            phis.push(angleOf(p, unfold(t.face, c.anchor!, p.face, S)));
        }
        // Pick a gap direction clear of every sleeve and stem; narrow the gap when nothing fits.
        for (let gap = p.gap ?? 110; gap >= 40; gap -= 10) {
            const ok: number[] = [];
            for (let a = 0; a < 360; a += 5) if (phis.every((phi) => Math.abs(wrap(phi - a)) > gap / 2 + 12)) ok.push(a);
            if (ok.length) {
                p.gap = gap;
                p.rotation = pick(ok);
                break;
            }
        }
    }

    level.pieces = pieces.filter((p): p is Piece => !!p);
    level.connections = conns;
    return level;
}
