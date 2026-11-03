// Simplified solver: breadth-first search over "macro moves" (turn a ring or slide a bar until something
// is released, it bumps into a piece, or a bomb goes off).
import { Puzzle, type State } from './rules';
import type { Level } from './types';

export interface Move {
    piece: string;
    kind: 'rotate' | 'slide' | 'flip';
    sign: 1 | -1;
}

export interface SimResult {
    solvable: boolean;
    minMoves: number | null;
    /** Reachable positions with no way forward and pieces left. */
    deadEnds: number;
    /** Pieces that can move in the starting position. */
    openingMoves: number;
    explored: number;
    /** True when the search hit its limit before finishing. */
    truncated: boolean;
    solution: Move[];
    /** False when the move count comes from a greedy search (an upper bound, not the minimum). */
    exact: boolean;
}

export function key(s: State): string {
    const parts: string[] = [];
    for (const id in s.p) {
        const p = s.p[id];
        parts.push(p.broken ? 'x' : `${Math.round(((p.rot % 360) + 360) % 360)},${Math.round(p.dx)},${Math.round(p.dy)},${p.flipped ? 1 : 0}`);
    }
    return parts.join('|') + '#' + s.hooks.map((h) => (h ? 1 : 0)).join('');
}

export function legalMoves(pz: Puzzle, s: State): Move[] {
    const out: Move[] = [];
    for (const p of pz.level.pieces) {
        const m = pz.mobility(s, p.id);
        if (m.kind === 'rotate') out.push({ piece: p.id, kind: 'rotate', sign: 1 }, { piece: p.id, kind: 'rotate', sign: -1 });
        if (m.kind === 'slide') out.push({ piece: p.id, kind: 'slide', sign: 1 }, { piece: p.id, kind: 'slide', sign: -1 });
        if (m.kind === 'flip' || (m.kind === 'slide' && m.canFlip)) out.push({ piece: p.id, kind: 'flip', sign: 1 });
    }
    return out;
}

/** Applies a macro move to a copy of `s`; returns null when nothing changes. */
export function applyMove(pz: Puzzle, s: State, mv: Move): State | null {
    const n = pz.clone(s);
    let r;
    if (mv.kind === 'rotate') r = pz.rotate(n, mv.piece, 360 * mv.sign, true);
    else if (mv.kind === 'slide') r = pz.slide(n, mv.piece, 500 * mv.sign, true);
    else r = pz.flip(n, mv.piece);
    if (r.moved === 0) return null;
    // A full turn with nothing released changes nothing that matters.
    if (mv.kind === 'rotate' && !r.blocked && !r.released.length && !r.exploded) return null;
    return n;
}

export function simulate(level: Level): SimResult {
    const pz = new Puzzle(level);
    const start = pz.initial();
    const openingMoves = new Set(legalMoves(pz, start).filter((m) => applyMove(pz, start, m)).map((m) => m.piece)).size;
    const bfs = breadthFirst(pz, start, BFS_NODES);
    if (bfs.solvable || !bfs.truncated) return { ...bfs, openingMoves, exact: true };
    // Too many orderings for an exhaustive search: look for any solution, greedy moves first.
    const dfs = depthFirst(pz, start, DFS_NODES);
    return { ...dfs, openingMoves, exact: false };
}

const BFS_NODES = 1500;
const DFS_NODES = 2500;

type Partial = Omit<SimResult, 'openingMoves' | 'exact'>;

function breadthFirst(pz: Puzzle, start: State, limit: number): Partial {
    const seen = new Map<string, { prev: string | null; move: Move | null }>();
    const startKey = key(start);
    seen.set(startKey, { prev: null, move: null });
    let frontier: { k: string; s: State }[] = [{ k: startKey, s: start }];
    let deadEnds = 0;
    let truncated = false;
    let winKey: string | null = pz.isWon(start) ? startKey : null;
    while (frontier.length && !winKey && !truncated) {
        const next: { k: string; s: State }[] = [];
        for (const { k, s } of frontier) {
            let any = false;
            for (const mv of legalMoves(pz, s)) {
                const n = applyMove(pz, s, mv);
                if (!n) continue;
                any = true;
                const nk = key(n);
                if (seen.has(nk)) continue;
                seen.set(nk, { prev: k, move: mv });
                if (pz.isWon(n)) {
                    winKey = nk;
                    break;
                }
                next.push({ k: nk, s: n });
            }
            if (!any) deadEnds++;
            if (winKey) break;
            if (seen.size > limit) {
                truncated = true;
                break;
            }
        }
        frontier = next;
    }
    const solution: Move[] = [];
    for (let k = winKey; k; ) {
        const e = seen.get(k)!;
        if (e.move) solution.unshift(e.move);
        k = e.prev;
    }
    return { solvable: winKey !== null, minMoves: winKey ? solution.length : null, deadEnds, explored: seen.size, truncated: truncated && !winKey, solution };
}

function depthFirst(pz: Puzzle, start: State, limit: number): Partial {
    const seen = new Set<string>([key(start)]);
    let deadEnds = 0;
    const path: Move[] = [];
    let found: Move[] | null = null;
    const visit = (s: State): boolean => {
        if (pz.isWon(s)) {
            found = [...path];
            return true;
        }
        if (seen.size > limit) return false;
        const children: { mv: Move; n: State; score: number }[] = [];
        for (const mv of legalMoves(pz, s)) {
            const n = applyMove(pz, s, mv);
            if (!n) continue;
            children.push({ mv, n, score: pz.remaining(s) - pz.remaining(n) + n.hooks.filter((h) => !h).length * 0.01 });
        }
        if (!children.length) deadEnds++;
        children.sort((a, b) => b.score - a.score);
        for (const c of children) {
            const k = key(c.n);
            if (seen.has(k)) continue;
            seen.add(k);
            path.push(c.mv);
            if (visit(c.n)) return true;
            path.pop();
        }
        return false;
    };
    visit(start);
    const sol = found as Move[] | null;
    return {
        solvable: sol !== null,
        minMoves: sol ? sol.length : null,
        deadEnds,
        explored: seen.size,
        truncated: sol === null && seen.size > limit,
        solution: sol ?? []
    };
}
