// Imports levels from a 2D Ring Tangle layout bank ({ level_layouts_attributes: [{ client_data }] }).
// Each 2D level is placed on the front face, scaled down if it does not fit.
import { rotate } from './geom';
import { emptyLevel, PIECE_TYPES, type Level, type Piece, type PieceType, type Vec2 } from './types';

interface Raw2DPiece {
    id: string;
    type: string;
    x: number;
    y: number;
    color: string;
    rotation?: number;
    radius?: number;
    gap?: number;
    path?: Vec2[];
    length?: number;
    height?: number;
    bomb?: { angle?: number; position?: Vec2 };
}

interface Raw2DLevel {
    id: number | string;
    title?: string;
    pieces: Raw2DPiece[];
    connections?: { owner: string; target: string; anchor?: Vec2 }[];
    difficulty?: string;
    instruction?: string;
    fixedBombs?: Vec2[];
}

export function isLayoutBank(data: unknown): data is { level_layouts_attributes: { client_data: Raw2DLevel }[] } {
    return !!data && Array.isArray((data as { level_layouts_attributes?: unknown }).level_layouts_attributes);
}

function shapePath(p: Raw2DPiece): Vec2[] | undefined {
    if (p.path && p.path.length >= 2) return p.path;
    const L = p.length ?? 100;
    const H = p.height ?? 60;
    if (p.type === 'u') return [{ x: L / 2, y: -H / 2 }, { x: -L / 2, y: -H / 2 }, { x: -L / 2, y: H / 2 }, { x: L / 2, y: H / 2 }];
    if (p.type === 'elbow') return [{ x: -L / 2, y: -H / 2 }, { x: -L / 2, y: H / 2 }, { x: L / 2, y: H / 2 }];
    if (p.type === 'bar') return [{ x: -L / 2, y: 0 }, { x: L / 2, y: 0 }];
    return undefined;
}

export function convert2D(raw: Raw2DLevel, cubeSize = 400): Level {
    const lv = emptyLevel(`l2d_${raw.id}`, raw.title || `Level ${raw.id}`);
    lv.category = '2D import';
    lv.difficulty = raw.difficulty === 'hard' || raw.difficulty === 'super_hard' ? raw.difficulty : 'normal';
    if (raw.instruction) lv.instruction = raw.instruction;

    // Centre the layout and scale it to fit one face.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of raw.pieces) {
        const r = p.radius ?? 0;
        xs.push(p.x - r - 20, p.x + r + 20);
        ys.push(p.y - r - 20, p.y + r + 20);
        for (const q of shapePath(p) ?? []) {
            const w = rotate(q, p.rotation ?? 0);
            xs.push(p.x + w.x, p.x + w.x);
            ys.push(p.y + w.y, p.y + w.y);
        }
    }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const k = Math.min(1, (cubeSize * 0.94) / span);
    const tx = (v: number) => Math.round((v - cx) * k * 10) / 10;
    const ty = (v: number) => Math.round((v - cy) * k * 10) / 10;
    const byId = new Map(raw.pieces.map((p) => [p.id, p]));

    lv.pieces = raw.pieces
        .filter((p) => (PIECE_TYPES as string[]).includes(p.type))
        .map((p) => {
            const out: Piece = { id: p.id, type: p.type as PieceType, face: 'front', x: tx(p.x), y: ty(p.y), color: p.color, rotation: p.rotation ?? 0 };
            if (p.type === 'ring' || p.type === 'closed') {
                out.radius = Math.round((p.radius ?? 48) * k * 10) / 10;
                if (p.type === 'ring') out.gap = p.gap ?? 110;
            } else {
                out.path = shapePath(p)?.map((q) => ({ x: q.x * k, y: q.y * k }));
            }
            if (p.bomb) out.bomb = p.bomb.position ? { position: { x: p.bomb.position.x * k, y: p.bomb.position.y * k } } : { angle: p.bomb.angle ?? 0 };
            return out;
        });
    lv.connections = (raw.connections ?? [])
        .filter((c) => byId.has(c.owner) && byId.has(c.target))
        .map((c) => {
            const t = byId.get(c.target)!;
            if (!c.anchor) return { owner: c.owner, target: c.target };
            // 2D anchors are relative to the target before its rotation.
            const w = rotate(c.anchor, t.rotation ?? 0);
            return { owner: c.owner, target: c.target, anchor: { x: tx(t.x + w.x), y: ty(t.y + w.y) } };
        });
    lv.fixedBombs = (raw.fixedBombs ?? []).map((b) => ({ face: 'front', x: tx(b.x), y: ty(b.y) }));
    return lv;
}
