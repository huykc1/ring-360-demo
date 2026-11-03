// Puzzle rules shared by the game, the editor's checks and the simulator.
// The logic runs in 2D on each face; the cube is only how it is shown.
import { unfold } from './cube';
import {
    angleOf,
    barPath,
    closestOnPolyline,
    dist,
    distToArc,
    distToPolyline,
    distToSeg,
    isRing,
    polar,
    ringGap,
    wrap
} from './geom';
import type { Connection, FaceId, Level, Piece, Vec2 } from './types';
import { TUBE_RADIUS } from './types';

export interface PieceState {
    rot: number;
    dx: number;
    dy: number;
    flipped: boolean;
    broken: boolean;
    /** Screws: still threaded through their metal joint (depends on where the screw is). */
    joint: boolean;
}

export interface State {
    p: Record<string, PieceState>;
    /** Whether each hook's sleeve is on its target's wire right now. Changes as pieces move. */
    hooks: boolean[];
    /** Hooks gone for good because their owner or target was destroyed. */
    cut: boolean[];
    bombUsed: Record<string, boolean>;
    fixedUsed: boolean[];
}

export interface MoveResult {
    moved: number;
    blocked: boolean;
    /** The moved piece ends up held by nothing and holding nothing: letting go now breaks it. */
    freed: boolean;
    /** Pieces destroyed straight away (bombs, boosters). Ordinary breaks wait for `settle`. */
    broken: string[];
    exploded: boolean;
    /** When a move is blocked: where the moving piece touched another piece, and which one. */
    hit?: { face: FaceId; at: Vec2; other: string };
}

export type Mobility =
    | { kind: 'rotate' }
    | { kind: 'slide'; dir: Vec2; canFlip: boolean }
    | { kind: 'flip' }
    | { kind: 'none'; reason: string };

interface HookInfo {
    c: Connection;
    anchor: Vec2;
    /** Ring targets: angle of the sleeve around the target centre. */
    phi?: number;
    /** Bar targets: which leg the sleeve is on. */
    seg?: number;
    /** Stem in the owner's frame: angle relative to the owner's rotation, and length from its centre. */
    stemRel: number;
    stemLen: number;
    sleeve: Vec2;
}

const CONTACT = TUBE_RADIUS * 2 - 1;
const RING_STEP = 1.5;
const BAR_STEP = 2;

export class Puzzle {
    readonly level: Level;
    readonly byId = new Map<string, Piece>();
    readonly hooks: HookInfo[] = [];
    private linked = new Map<string, Set<string>>();
    private byOwner = new Map<string, number[]>();
    private byTarget = new Map<string, number[]>();

    constructor(level: Level) {
        this.level = level;
        for (const p of level.pieces) {
            this.byId.set(p.id, p);
            this.linked.set(p.id, new Set());
        }
        for (const c of level.connections) {
            const owner = this.byId.get(c.owner);
            const target = this.byId.get(c.target);
            if (!owner || !target || owner === target) continue;
            const anchor = c.anchor ?? defaultAnchor(owner, target, level.cubeSize);
            const inOwner = unfold(target.face, anchor, owner.face, level.cubeSize);
            const info: HookInfo = {
                c,
                anchor,
                stemRel: wrap(angleOf(owner, inOwner) - owner.rotation),
                stemLen: dist(owner, inOwner),
                sleeve: inOwner
            };
            if (isRing(target)) info.phi = angleOf(target, anchor);
            else info.seg = closestOnPolyline(anchor, barPath(target)).seg;
            this.hooks.push(info);
            const i = this.hooks.length - 1;
            this.byOwner.set(owner.id, [...(this.byOwner.get(owner.id) ?? []), i]);
            this.byTarget.set(target.id, [...(this.byTarget.get(target.id) ?? []), i]);
            this.linked.get(owner.id)!.add(target.id);
            this.linked.get(target.id)!.add(owner.id);
        }
    }

    initial(): State {
        const s: State = {
            p: {},
            hooks: this.hooks.map(() => true),
            cut: this.hooks.map(() => false),
            bombUsed: {},
            fixedUsed: this.level.fixedBombs.map(() => false)
        };
        for (const p of this.level.pieces) {
            s.p[p.id] = { rot: p.rotation, dx: 0, dy: 0, flipped: false, broken: false, joint: p.type === 'rolling-elbow' };
        }
        // A sleeve that already sits in a ring's gap holds nothing.
        for (const p of this.level.pieces) this.engage(s, p.id);
        this.cascade(s, []);
        return s;
    }

    clone(s: State): State {
        const p: Record<string, PieceState> = {};
        for (const k in s.p) p[k] = { ...s.p[k] };
        return { p, hooks: [...s.hooks], cut: [...s.cut], bombUsed: { ...s.bombUsed }, fixedUsed: [...s.fixedUsed] };
    }

    remaining(s: State) {
        return this.level.pieces.filter((p) => !s.p[p.id].broken).length;
    }

    isWon(s: State) {
        return this.remaining(s) === 0;
    }

    holders(s: State, id: string) {
        return (this.byTarget.get(id) ?? []).filter((i) => s.hooks[i]).length + (s.p[id].joint ? 1 : 0);
    }

    holding(s: State, id: string) {
        return (this.byOwner.get(id) ?? []).filter((i) => s.hooks[i]).length;
    }

    hooksOn(id: string) {
        return this.byTarget.get(id) ?? [];
    }

    /** Held by nothing and holding nothing: the piece breaks when the player lets go. */
    isFree(s: State, id: string) {
        return !s.p[id].broken && this.holders(s, id) === 0 && this.holding(s, id) === 0;
    }

    /** The player let go: every free piece breaks. Returns the pieces that broke. */
    settle(s: State): string[] {
        const broken: string[] = [];
        this.cascade(s, broken);
        return broken;
    }

    mobility(s: State, id: string): Mobility {
        const p = this.byId.get(id);
        const ps = s.p[id];
        if (!p || ps.broken) return { kind: 'none', reason: 'broken' };
        if (isRing(p)) {
            if (this.holding(s, id) > 0) return { kind: 'none', reason: 'holds another piece' };
            return { kind: 'rotate' };
        }
        const pts = this.barPts(s, id);
        const segs = new Set<number>();
        for (const i of this.hooksOn(id)) if (s.hooks[i] && this.hooks[i].seg !== undefined) segs.add(this.hooks[i].seg!);
        if (ps.joint) segs.add(0);
        const canFlip = p.type === 'rolling-elbow' && pts.length > 2 && ![...segs].some((g) => g > 0);
        if (segs.size === 0) return canFlip ? { kind: 'flip' } : { kind: 'none', reason: 'free' };
        let dir: Vec2 | undefined;
        for (const g of segs) {
            const a = pts[g];
            const b = pts[g + 1];
            const len = dist(a, b) || 1;
            const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
            if (!dir) dir = d;
            else if (Math.abs(dir.x * d.y - dir.y * d.x) > 0.05) {
                return canFlip ? { kind: 'flip' } : { kind: 'none', reason: 'held on crossing legs' };
            }
        }
        return { kind: 'slide', dir: dir!, canFlip };
    }

    // ---------- geometry of the current state (also used for drawing) ----------

    barPts(s: State, id: string): Vec2[] {
        const ps = s.p[id];
        return barPath(this.byId.get(id)!, 1, { x: ps.dx, y: ps.dy }, ps.flipped);
    }

    /** Stems drawn on an owner: from its rim to the sleeve, in the owner's face coordinates. */
    stems(s: State, ownerId: string): { from: Vec2; to: Vec2; hook: number }[] {
        const owner = this.byId.get(ownerId)!;
        const out: { from: Vec2; to: Vec2; hook: number }[] = [];
        if (!isRing(owner)) return out;
        const r = owner.radius ?? 48;
        for (const i of this.byOwner.get(ownerId) ?? []) {
            const h = this.hooks[i];
            const a = s.p[ownerId].rot + h.stemRel;
            out.push({ from: polar(owner, r, a), to: polar(owner, h.stemLen, a), hook: i });
        }
        return out;
    }

    bombPoint(s: State, id: string): Vec2 | undefined {
        const p = this.byId.get(id)!;
        if (!p.bomb || s.bombUsed[id]) return undefined;
        if (isRing(p)) return polar(p, p.radius ?? 48, s.p[id].rot - p.rotation + (p.bomb.angle ?? 0));
        const q = p.bomb.position ?? { x: 0, y: 0 };
        const tmp: Piece = { ...p, path: [q, q] };
        return barPath(tmp, 1, { x: s.p[id].dx, y: s.p[id].dy })[0];
    }

    distToPiece(s: State, id: string, pt: Vec2, withStems = true): number {
        const p = this.byId.get(id)!;
        let d: number;
        if (isRing(p)) d = distToArc(pt, p, p.radius ?? 48, s.p[id].rot, ringGap(p));
        else d = distToPolyline(pt, this.barPts(s, id));
        if (withStems) for (const st of this.stems(s, id)) d = Math.min(d, distToSeg(pt, st.from, st.to));
        return d;
    }

    // ---------- moves ----------

    rotate(s: State, id: string, delta: number, stopOnEvent = false): MoveResult {
        const res = emptyResult();
        if (this.mobility(s, id).kind !== 'rotate') return { ...res, blocked: true };
        const p = this.byId.get(id)!;
        const steps = Math.ceil(Math.abs(delta) / RING_STEP);
        const step = delta / Math.max(1, steps);
        const before = this.contacts(s, id);
        for (let k = 0; k < steps; k++) {
            const ps = s.p[id];
            const prev = ps.rot;
            ps.rot = prev + step;
            const hit = this.collision(s, id, p.face, before, res);
            if (hit === 'block') {
                ps.rot = prev;
                res.blocked = true;
                break;
            }
            res.moved += Math.abs(step);
            if (hit === 'bomb') {
                this.detonate(s, id, res);
                break;
            }
            this.engage(s, id);
            if (stopOnEvent && this.isFree(s, id)) break;
        }
        res.freed = this.isFree(s, id);
        return res;
    }

    /**
     * Slides a bar along its held leg; `amount` is signed along the mobility direction. A bar that has
     * slid free can keep going along `freeDir` (the direction of the drag that freed it).
     */
    slide(s: State, id: string, amount: number, stopOnEvent = false, freeDir?: Vec2): MoveResult {
        const res = emptyResult();
        const mob = this.mobility(s, id);
        const m = mob.kind === 'slide' ? mob : freeDir && this.isFree(s, id) ? { kind: 'slide' as const, dir: freeDir, canFlip: false } : null;
        if (!m) return { ...res, blocked: true };
        const p = this.byId.get(id)!;
        const steps = Math.ceil(Math.abs(amount) / BAR_STEP);
        const step = amount / Math.max(1, steps);
        const before = this.contacts(s, id);
        for (let k = 0; k < steps; k++) {
            const ps = s.p[id];
            const prev = { dx: ps.dx, dy: ps.dy };
            ps.dx += m.dir.x * step;
            ps.dy += m.dir.y * step;
            const hit = this.collision(s, id, p.face, before, res);
            if (hit === 'block') {
                Object.assign(ps, prev);
                res.blocked = true;
                break;
            }
            res.moved += Math.abs(step);
            if (hit === 'bomb') {
                this.detonate(s, id, res);
                break;
            }
            this.engage(s, id);
            if (stopOnEvent && this.isFree(s, id)) break;
        }
        res.freed = this.isFree(s, id);
        return res;
    }

    /** Flips a screw's head to the other side of its long leg. */
    flip(s: State, id: string): MoveResult {
        const res = emptyResult();
        const m = this.mobility(s, id);
        if (!(m.kind === 'flip' || (m.kind === 'slide' && m.canFlip))) return { ...res, blocked: true };
        const p = this.byId.get(id)!;
        const ps = s.p[id];
        const before = this.contacts(s, id);
        ps.flipped = !ps.flipped;
        const hit = this.collision(s, id, p.face, before, res);
        if (hit === 'block') {
            ps.flipped = !ps.flipped;
            return { ...res, blocked: true };
        }
        res.moved = 180;
        if (hit === 'bomb') this.detonate(s, id, res);
        this.engage(s, id);
        res.freed = this.isFree(s, id);
        return res;
    }

    /** Boosters: breaks the given pieces outright; pieces they held are released. */
    smash(s: State, ids: string[]): MoveResult {
        const res = emptyResult();
        for (const id of ids) {
            if (!s.p[id] || s.p[id].broken) continue;
            this.forceBreak(s, id);
            res.broken.push(id);
        }
        this.cascade(s, res.broken);
        return res;
    }

    // ---------- internals ----------

    /** Recomputes which hooks on `id` (and a screw's joint) hold it, from where the piece is now. */
    private engage(s: State, id: string) {
        const p = this.byId.get(id)!;
        const ps = s.p[id];
        if (isRing(p)) {
            for (const i of this.hooksOn(id)) s.hooks[i] = !s.cut[i] && !ps.broken && !this.inGap(s, id, this.hooks[i].phi!);
            return;
        }
        const pts = this.barPts(s, id);
        for (const i of this.hooksOn(id)) {
            const h = this.hooks[i];
            s.hooks[i] = !s.cut[i] && !ps.broken && onLeg(h.anchor, pts[h.seg!], pts[h.seg! + 1]);
        }
        if (p.type === 'rolling-elbow') ps.joint = !ps.broken && onLeg(p, pts[0], pts[1]);
    }

    private inGap(s: State, ringId: string, phi: number) {
        const p = this.byId.get(ringId)!;
        const g = ringGap(p);
        return g > 0 && Math.abs(wrap(phi - s.p[ringId].rot)) < g / 2;
    }

    /** Sample points of a moving piece that can bump into other pieces. */
    private solids(s: State, id: string): Vec2[] {
        const p = this.byId.get(id)!;
        const out: Vec2[] = [];
        if (isRing(p)) {
            for (const st of this.stems(s, id)) {
                if (st.to.x !== st.from.x || st.to.y !== st.from.y) {
                    const n = Math.max(1, Math.ceil(dist(st.from, st.to) / 8));
                    for (let k = 1; k <= n; k++) {
                        out.push({ x: st.from.x + ((st.to.x - st.from.x) * k) / n, y: st.from.y + ((st.to.y - st.from.y) * k) / n });
                    }
                }
            }
        } else {
            const pts = this.barPts(s, id);
            out.push(pts[0], pts[pts.length - 1]);
            for (let i = 1; i < pts.length - 1; i++) {
                const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / 8));
                for (let k = 0; k <= n; k++) {
                    out.push({ x: pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / n, y: pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / n });
                }
            }
        }
        return out;
    }

    private others(s: State, id: string, face: FaceId): Piece[] {
        const linked = this.linked.get(id)!;
        return this.level.pieces.filter((q) => q.id !== id && q.face === face && !s.p[q.id].broken && !linked.has(q.id));
    }

    private contacts(s: State, id: string): Set<string> {
        const p = this.byId.get(id)!;
        const set = new Set<string>();
        const pts = this.solids(s, id);
        for (const q of this.others(s, id, p.face)) {
            if (pts.some((pt) => this.distToPiece(s, q.id, pt) < CONTACT)) set.add(q.id);
        }
        return set;
    }

    private collision(s: State, id: string, face: FaceId, before: Set<string>, res: MoveResult): 'none' | 'block' | 'bomb' {
        const bomb = this.bombPoint(s, id);
        const others = this.others(s, id, face);
        if (bomb) {
            if (others.some((q) => this.distToPiece(s, q.id, bomb) < CONTACT + 4)) return 'bomb';
        }
        const pts = this.solids(s, id);
        if (bomb) pts.push(bomb);
        for (const q of others) {
            if (before.has(q.id)) continue;
            const at = pts.find((pt) => this.distToPiece(s, q.id, pt) < CONTACT);
            if (at) {
                res.hit = { face, at, other: q.id };
                return 'block';
            }
        }
        for (let i = 0; i < this.level.fixedBombs.length; i++) {
            const fb = this.level.fixedBombs[i];
            if (s.fixedUsed[i] || fb.face !== face) continue;
            const touch = this.distToPiece(s, id, fb, true) < CONTACT + 6;
            if (touch) {
                s.fixedUsed[i] = true;
                res.exploded = true;
                res.broken.push(...this.explodeAt(s, fb.face, fb, undefined));
            }
        }
        return 'none';
    }

    private detonate(s: State, id: string, res: MoveResult) {
        const p = this.byId.get(id)!;
        const at = this.bombPoint(s, id)!;
        s.bombUsed[id] = true;
        res.exploded = true;
        res.broken.push(...this.explodeAt(s, p.face, at, id));
        this.cascade(s, res.broken);
    }

    private explodeAt(s: State, face: FaceId, at: Vec2, hostId: string | undefined): string[] {
        const victims = this.level.pieces.filter(
            (q) => !s.p[q.id].broken && (q.id === hostId || (q.face === face && this.distToPiece(s, q.id, at, false) <= this.level.bombRadius))
        );
        for (const q of victims) this.forceBreak(s, q.id);
        return victims.map((q) => q.id);
    }

    private forceBreak(s: State, id: string) {
        s.p[id].broken = true;
        s.p[id].joint = false;
        this.hooks.forEach((h, i) => {
            if (h.c.owner === id || h.c.target === id) {
                s.hooks[i] = false;
                s.cut[i] = true;
            }
        });
    }

    /** Breaks every piece that is neither held nor holding anything. */
    private cascade(s: State, broken: string[]) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const p of this.level.pieces) {
                const ps = s.p[p.id];
                if (ps.broken) continue;
                if (this.holders(s, p.id) === 0 && this.holding(s, p.id) === 0) {
                    ps.broken = true;
                    broken.push(p.id);
                    changed = true;
                }
            }
        }
    }
}

function emptyResult(): MoveResult {
    return { moved: 0, blocked: false, freed: false, broken: [], exploded: false };
}

/** True while the sleeve at `pt` still sits on leg a-b (the leg has not slid out, or has slid back in). */
function onLeg(pt: Vec2, a: Vec2, b: Vec2) {
    const len = dist(a, b) || 1;
    const t = ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / len;
    return t >= -2 && t <= len + 2 && distToSeg(pt, a, b) < 3;
}

/** Sleeve position when a connection has no explicit anchor: the target's wire point nearest the owner's rim. */
export function defaultAnchor(owner: Piece, target: Piece, size: number): Vec2 {
    const o = unfold(owner.face, owner, target.face, size);
    if (isRing(target)) {
        const r = target.radius ?? 48;
        const R = owner.radius ?? 48;
        const d = dist(o, target);
        // Where the two circles cross, if they do; otherwise the point facing the owner.
        if (d < r + R && d > Math.abs(r - R) && d > 0) {
            const a = (r * r - R * R + d * d) / (2 * d);
            const base = angleOf(target, o);
            const off = (Math.acos(Math.max(-1, Math.min(1, a / r))) * 180) / Math.PI;
            return polar(target, r, base + off);
        }
        return polar(target, r, angleOf(target, o));
    }
    return closestOnPolyline(o, barPath(target)).point;
}
