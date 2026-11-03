// State shared by the Phaser scenes: the 3D view under the HUD and the bundled level list.
import type { CubeView } from '../view/CubeView';
import { normalizeLevel, type Level } from '../core/types';

export interface LevelEntry {
    id: string;
    name: string;
    difficulty: string;
    file: string;
}

export const shared = {
    view: null as CubeView | null,
    levels: [] as LevelEntry[],
    /** Set when the editor embeds the game for a play test. */
    embedded: new URLSearchParams(location.search).has('embed')
};

export async function loadIndex(): Promise<LevelEntry[]> {
    try {
        const res = await fetch('levels/index.json', { cache: 'no-cache' });
        const data = (await res.json()) as { levels: LevelEntry[] };
        shared.levels = data.levels;
    } catch {
        shared.levels = [];
    }
    return shared.levels;
}

export async function loadLevel(entry: LevelEntry): Promise<Level> {
    const res = await fetch(`levels/${entry.file}`, { cache: 'no-cache' });
    return normalizeLevel(await res.json());
}
