// Data checks shown in the editor's Level checks list.
import { dist, isRing, ringPoints, barPath, ringGap } from './geom';
import { Puzzle } from './rules';
import { applyMove, legalMoves } from './sim';
import type { Level, Piece, Vec2 } from './types';
import { TUBE_RADIUS } from './types';

export interface Check {
    ok: boolean;
    text: string;
    pieces?: string[];
}

function wirePoints(p: Piece): Vec2[] {
    return isRing(p) ? ringPoints(p, p.radius ?? 48, p.rotation, ringGap(p), 6) : barPath(p);
}

export function checkLevel(level: Level): Check[] {
    const out: Check[] = [];
    const ids = new Set(level.pieces.map((p) => p.id));
    const byId = new Map(level.pieces.map((p) => [p.id, p]));

    if (ids.size !== level.pieces.length) out.push({ ok: false, text: 'Two pieces share an id' });

    const badRefs = level.connections.filter((c) => !ids.has(c.owner) || !ids.has(c.target) || c.owner === c.target);
    const badOwners = level.connections.filter((c) => ids.has(c.owner) && !isRing(byId.get(c.owner)!));
    if (badRefs.length) out.push({ ok: false, text: `${badRefs.length} hook(s) point to a missing piece or to the piece itself` });
    else if (badOwners.length) out.push({ ok: false, text: 'Only rings can hold pieces', pieces: badOwners.map((c) => c.owner) });
    else out.push({ ok: true, text: 'Connections valid' });

    const pz = new Puzzle(level);
    const s0 = pz.initial();

    const offWire = pz.hooks.filter((h) => pz.distToPiece(s0, h.c.target, h.anchor, false) > TUBE_RADIUS);
    if (offWire.length) out.push({ ok: false, text: `${offWire.length} sleeve(s) not on the held piece's wire`, pieces: offWire.map((h) => h.c.target) });

    const inGap = pz.hooks.filter((h, i) => !s0.hooks[i] && h.phi !== undefined);
    if (inGap.length) out.push({ ok: false, text: `${inGap.length} sleeve(s) start inside a ring's gap (they hold nothing)`, pieces: inGap.map((h) => h.c.target) });

    const floating = pz.hooks.filter((h) => {
        const o = byId.get(h.c.owner)!;
        return o.type === 'ring' && Math.abs(((((h.stemRel + 180) % 360) + 360) % 360) - 180) < ringGap(o) / 2;
    });
    if (floating.length) out.push({ ok: false, text: `${floating.length} hook(s) start inside their own ring's gap`, pieces: floating.map((h) => h.c.owner) });

    const bombs: { face: string; at: Vec2 }[] = [
        ...level.fixedBombs.map((b) => ({ face: b.face, at: b as Vec2 })),
        ...level.pieces.filter((p) => p.bomb).map((p) => ({ face: p.face, at: pz.bombPoint(s0, p.id) ?? p }))
    ];
    const heldClosed = level.pieces.filter((p) => p.type === 'closed' && level.connections.some((c) => c.target === p.id));
    const lonelyClosed = heldClosed.filter(
        (p) => !bombs.some((b) => b.face === p.face && dist(b.at, p) <= level.bombRadius + (p.radius ?? 48) * 2.5)
    );
    for (const p of lonelyClosed) out.push({ ok: false, text: `Closed ring ${p.id} is held, no bomb near`, pieces: [p.id] });

    const loose = level.pieces.filter((p) => !level.connections.some((c) => c.owner === p.id || c.target === p.id));
    if (loose.length && level.pieces.length > 1) out.push({ ok: false, text: `${loose.length} piece(s) hold nothing and are not held (they break at once)`, pieces: loose.map((p) => p.id) });

    // Overlaps between pieces that are not hooked together.
    const linked = new Set(level.connections.map((c) => [c.owner, c.target].sort().join('|')));
    const overlaps: string[] = [];
    const wires = new Map(level.pieces.map((p) => [p.id, wirePoints(p)]));
    for (let i = 0; i < level.pieces.length; i++) {
        for (let j = i + 1; j < level.pieces.length; j++) {
            const a = level.pieces[i];
            const b = level.pieces[j];
            // A ring carrying a bomb is meant to cross the piece it will blow up.
            if (a.face !== b.face || a.bomb || b.bomb || linked.has([a.id, b.id].sort().join('|'))) continue;
            if (wires.get(a.id)!.some((pt) => pz.distToPiece(s0, b.id, pt, false) < TUBE_RADIUS * 2 - 2)) overlaps.push(`${a.id}/${b.id}`);
        }
    }
    if (overlaps.length) out.push({ ok: false, text: `Overlapping pieces: ${overlaps.slice(0, 4).join(', ')}${overlaps.length > 4 ? '…' : ''}` });

    const cycle = findCycle(level);
    if (cycle) out.push({ ok: false, text: `Circular holds: ${cycle.join(' → ')}`, pieces: cycle });
    else out.push({ ok: true, text: 'No circular holds' });

    if (level.pieces.length) {
        const movable = new Set(
            legalMoves(pz, s0)
                .filter((m) => applyMove(pz, s0, m))
                .map((m) => m.piece)
        );
        if (movable.size === 0) out.push({ ok: false, text: 'No piece can move at the start' });
        else out.push({ ok: true, text: `${movable.size} piece(s) movable at start` });
    }
    return out;
}

function findCycle(level: Level): string[] | null {
    const edges = new Map<string, string[]>();
    for (const c of level.connections) edges.set(c.owner, [...(edges.get(c.owner) ?? []), c.target]);
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (n: string): string[] | null => {
        state.set(n, 1);
        stack.push(n);
        for (const m of edges.get(n) ?? []) {
            if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
            if (!state.has(m)) {
                const r = visit(m);
                if (r) return r;
            }
        }
        stack.pop();
        state.set(n, 2);
        return null;
    };
    for (const p of level.pieces) {
        if (!state.has(p.id)) {
            const r = visit(p.id);
            if (r) return r;
        }
    }
    return null;
}
