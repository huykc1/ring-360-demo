// Level data shared by the game and the level editor (see docs/guide/editor.md).

export const SCHEMA = 'ring360-level';
export const SCHEMA_VERSION = 1;

export type FaceId = 'front' | 'right' | 'back' | 'left' | 'top' | 'bottom';
export const FACES: FaceId[] = ['front', 'right', 'back', 'left', 'top', 'bottom'];

export type PieceType = 'ring' | 'closed' | 'bar' | 'elbow' | 'u' | 'rolling-elbow';
export const PIECE_TYPES: PieceType[] = ['ring', 'closed', 'bar', 'elbow', 'u', 'rolling-elbow'];

export type Difficulty = 'normal' | 'hard' | 'super_hard';
export type Status = 'WIP' | 'PROD' | 'ARCHIVE';

export interface Vec2 {
    x: number;
    y: number;
}

export interface Piece {
    id: string;
    type: PieceType;
    face: FaceId;
    /** Position on its face; the face centre is 0,0 and y points down. */
    x: number;
    y: number;
    color: string;
    /** Ring: direction of the gap centre in degrees. Bars: rotation of `path`. */
    rotation: number;
    /** Rings only. */
    radius?: number;
    /** C rings only: opening width in degrees. */
    gap?: number;
    /** Bars, L, U and screws: points relative to x,y before rotation. A screw's long leg comes first. */
    path?: Vec2[];
    /** A bomb riding on this piece: an angle on a ring, or a position along a bar (local, before rotation). */
    bomb?: { angle?: number; position?: Vec2 };
}

/** `owner` (a ring or closed ring) holds `target` with a hook whose sleeve sits at `anchor`. */
export interface Connection {
    owner: string;
    target: string;
    /** Sleeve position on the target's wire, in the target face's coordinates. */
    anchor?: Vec2;
}

export interface FixedBomb {
    face: FaceId;
    x: number;
    y: number;
}

export interface GeneratorInfo {
    preset: string;
    seed: number;
    params: GeneratorParams;
}

export interface Range {
    min: number;
    max: number;
}

export interface GeneratorParams {
    faces: number;
    edgeHookShare: number;
    rings: Range;
    closed: Range;
    bars: Range;
    screws: Range;
    bombs: Range;
    depth: Range;
    maxOwn: number;
    maxHeld: number;
    colors: number;
    radius: Range;
    gap: Range;
}

export interface Level {
    schema: typeof SCHEMA;
    schemaVersion: number;
    id: string;
    name: string;
    version: number;
    status: Status;
    difficulty: Difficulty;
    category: string;
    cubeSize: number;
    /** Blast radius of every bomb in this level (tunable while testing). */
    bombRadius: number;
    pieces: Piece[];
    connections: Connection[];
    fixedBombs: FixedBomb[];
    instruction?: string;
    generator?: GeneratorInfo;
}

export const COLORS: Record<string, string> = {
    gold: '#EFB227',
    teal: '#1D9E9A',
    coral: '#E8674A',
    violet: '#8B5CD6',
    mint: '#4FCB9A',
    blue: '#3B82D6',
    green: '#5BA832'
};
export const COLOR_NAMES = Object.keys(COLORS);

export const TUBE_RADIUS = 5;

export function emptyLevel(id: string, name = id): Level {
    return {
        schema: SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        version: 0,
        status: 'WIP',
        difficulty: 'normal',
        category: '',
        cubeSize: 400,
        bombRadius: 70,
        pieces: [],
        connections: [],
        fixedBombs: []
    };
}

export function cloneLevel(level: Level): Level {
    return JSON.parse(JSON.stringify(level)) as Level;
}

/** Fills in fields older or hand-written files may lack. */
export function normalizeLevel(raw: Partial<Level> & { id?: string }): Level {
    const base = emptyLevel(raw.id ?? 'level');
    const level = { ...base, ...raw } as Level;
    level.pieces = (raw.pieces ?? []).map((p) => ({ ...p, face: p.face ?? 'front', rotation: p.rotation ?? 0 }));
    level.connections = raw.connections ?? [];
    level.fixedBombs = raw.fixedBombs ?? [];
    return level;
}
