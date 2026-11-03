// Maps face-local 2D coordinates onto the cube. Points past a face edge fold over onto the neighbouring face.
import type { FaceId, Vec2 } from './types';

export type V3 = [number, number, number];

interface Frame {
    n: V3;
    u: V3;
    v: V3;
}

// `v` points "down" on the face, matching the level data's y axis. The axes are chosen so the
// unfolded net (see NET_CELLS) lines up across every edge that touches the front face.
export const FRAMES: Record<FaceId, Frame> = {
    front: { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    right: { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
    back: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
    left: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
    top: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    bottom: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }
};

/** Column and row of each face in the unfolded cross used by the editor's Net view. */
export const NET_CELLS: Record<FaceId, [number, number]> = {
    top: [1, 0],
    left: [0, 1],
    front: [1, 1],
    right: [2, 1],
    back: [3, 1],
    bottom: [1, 2]
};

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 3D point and outward surface normal for a face-local point (folded over edges when needed). */
export function to3D(face: FaceId, x: number, y: number, size: number, lift = 0): { p: V3; n: V3 } {
    const f = FRAMES[face];
    const h = size / 2;
    const cu = Math.max(-h, Math.min(h, x));
    const cv = Math.max(-h, Math.min(h, y));
    const eu = Math.min(h, Math.abs(x) - h);
    const ev = Math.min(h, Math.abs(y) - h);
    let p = add(add([0, 0, 0], f.n, h), f.u, cu);
    p = add(p, f.v, cv);
    let n = f.n;
    if (eu > 0) {
        p = add(p, f.n, -eu);
        n = f.u.map((c) => c * Math.sign(x)) as V3;
    }
    if (ev > 0) {
        p = add(p, f.n, -ev);
        n = f.v.map((c) => c * Math.sign(y)) as V3;
    }
    return { p: add(p, n, lift), n };
}

/** Inverse of to3D for points on `face` or on a face next to it: unfolds them into `face`'s plane. */
export function toLocal(face: FaceId, p: V3, size: number): Vec2 {
    const f = FRAMES[face];
    const h = size / 2;
    let x = dot(p, f.u);
    let y = dot(p, f.v);
    const depth = h - dot(p, f.n);
    if (depth > 0.01) {
        if (Math.abs(x) >= h - 0.01 && Math.abs(x) >= Math.abs(y)) x = Math.sign(x) * (h + depth);
        else if (Math.abs(y) >= h - 0.01) y = Math.sign(y) * (h + depth);
    }
    return { x, y };
}

/** Re-expresses a point given on face `from` in the coordinates of face `to` (unfolding across the shared edge). */
export function unfold(from: FaceId, pt: Vec2, to: FaceId, size: number): Vec2 {
    if (from === to) return { x: pt.x, y: pt.y };
    return toLocal(to, to3D(from, pt.x, pt.y, size).p, size);
}

export function areAdjacent(a: FaceId, b: FaceId): boolean {
    return a !== b && dot(FRAMES[a].n, FRAMES[b].n) === 0;
}
