// 2D geometry on one cube face.
import type { Piece, Vec2 } from './types';

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
/** Angle difference folded into [-180, 180). */
export const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const polar = (c: Vec2, r: number, angleDeg: number): Vec2 => ({
    x: c.x + r * Math.cos(rad(angleDeg)),
    y: c.y + r * Math.sin(rad(angleDeg))
});
export const angleOf = (c: Vec2, p: Vec2) => deg(Math.atan2(p.y - c.y, p.x - c.x));

export function rotate(p: Vec2, angleDeg: number): Vec2 {
    const c = Math.cos(rad(angleDeg));
    const s = Math.sin(rad(angleDeg));
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export const isRing = (p: Piece) => p.type === 'ring' || p.type === 'closed';
export const ringGap = (p: Piece) => (p.type === 'ring' ? (p.gap ?? 110) : 0);

/** Default shapes for bars created without an explicit path. */
export function defaultPath(type: Piece['type']): Vec2[] {
    switch (type) {
        case 'elbow':
            return [{ x: -40, y: -40 }, { x: -40, y: 40 }, { x: 40, y: 40 }];
        case 'u':
            return [{ x: 40, y: -40 }, { x: -40, y: -40 }, { x: -40, y: 40 }, { x: 40, y: 40 }];
        case 'rolling-elbow':
            return [{ x: -60, y: 0 }, { x: 60, y: 0 }, { x: 60, y: -30 }];
        default:
            return [{ x: -50, y: 0 }, { x: 50, y: 0 }];
    }
}

/**
 * World path of a bar-like piece. `offset` slides it along `dir`; `flipped` mirrors a screw's head
 * (every point after the long leg) across the long leg's line.
 */
export function barPath(p: Piece, offset = 0, dir: Vec2 = { x: 0, y: 0 }, flipped = false): Vec2[] {
    const local = p.path && p.path.length >= 2 ? p.path : defaultPath(p.type);
    let pts = local.map((q) => rotate(q, p.rotation));
    if (flipped && pts.length > 2) {
        const a = pts[0];
        const b = pts[1];
        const len = dist(a, b) || 1;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        pts = pts.map((q, i) => {
            if (i < 2) return q;
            const t = (q.x - a.x) * ux + (q.y - a.y) * uy;
            const fx = a.x + ux * t;
            const fy = a.y + uy * t;
            return { x: 2 * fx - q.x, y: 2 * fy - q.y };
        });
    }
    return pts.map((q) => ({ x: q.x + p.x + dir.x * offset, y: q.y + p.y + dir.y * offset }));
}

/** Points along a ring's wire, from one end of the C to the other (full circle when closed). */
export function ringPoints(c: Vec2, r: number, rotation: number, gap: number, stepDeg = 5): Vec2[] {
    const start = rotation + gap / 2;
    const span = 360 - gap;
    const n = Math.max(2, Math.ceil(span / stepDeg));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) pts.push(polar(c, r, start + (span * i) / n));
    if (gap === 0) pts.pop();
    return pts;
}

export function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function distToPolyline(p: Vec2, pts: Vec2[]): number {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSeg(p, pts[i], pts[i + 1]));
    return best;
}

export function distToArc(p: Vec2, c: Vec2, r: number, rotation: number, gap: number): number {
    if (gap > 0 && Math.abs(wrap(angleOf(c, p) - rotation)) < gap / 2) {
        return Math.min(dist(p, polar(c, r, rotation + gap / 2)), dist(p, polar(c, r, rotation - gap / 2)));
    }
    return Math.abs(dist(p, c) - r);
}

/** Closest point on a polyline and which segment it lies on. */
export function closestOnPolyline(p: Vec2, pts: Vec2[]): { point: Vec2; seg: number; t: number } {
    let best = { point: pts[0], seg: 0, t: 0, d: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = dist(p, q);
        if (d < best.d) best = { point: q, seg: i, t: t * Math.sqrt(l2), d };
    }
    return { point: best.point, seg: best.seg, t: best.t };
}
