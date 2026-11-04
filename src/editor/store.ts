// Where the editor keeps its data: a folder on disk (File System Access API, Chrome/Edge) or browser storage.
//
// <root folder>/
//   levels/<id>.json
//   levels/.versions/<id>/v<N>.json   3 latest saved versions
//   drafts/current.json               autosaved draft
//   collections.json
//   collections/<Name>/001_<id>.json  ordered copies per collection
import { normalizeLevel, type Level } from '../core/types';

export interface Collection {
    name: string;
    version: number;
    levels: string[];
}

export interface Store {
    kind: 'folder' | 'browser';
    label: string;
    listLevels(): Promise<Level[]>;
    readLevel(id: string): Promise<Level | null>;
    /** Writes the level file; with `keepVersion` the previous file goes to the version history first. */
    writeLevel(level: Level, keepVersion: boolean): Promise<void>;
    deleteLevel(id: string): Promise<void>;
    renameLevel(oldId: string, level: Level): Promise<void>;
    listVersions(id: string): Promise<Level[]>;
    readDraft(): Promise<Level | null>;
    writeDraft(level: Level | null): Promise<void>;
    readCollections(): Promise<Collection[]>;
    writeCollections(cols: Collection[]): Promise<void>;
    /** Replaces the numbered copies in collections/<name>/; returns the file names written. */
    writeCollectionCopies(name: string, levels: Level[], oldName?: string): Promise<{ copied: number; removed: number }>;
    listCollectionCopies(name: string): Promise<string[]>;
}

const KEEP_VERSIONS = 3;
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const copyName = (index: number, id: string) => `${String(index + 1).padStart(3, '0')}_${id}.json`;

// ---------------- folder ----------------

type Dir = FileSystemDirectoryHandle;

async function dirAt(root: Dir, path: string[], create: boolean): Promise<Dir | null> {
    let d = root;
    for (const part of path) {
        try {
            d = await d.getDirectoryHandle(part, { create });
        } catch {
            return null;
        }
    }
    return d;
}

async function readText(dir: Dir | null, name: string): Promise<string | null> {
    if (!dir) return null;
    try {
        const f = await (await dir.getFileHandle(name)).getFile();
        return await f.text();
    } catch {
        return null;
    }
}

async function writeText(dir: Dir, name: string, text: string) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
}

async function names(dir: Dir | null): Promise<string[]> {
    const out: string[] = [];
    if (!dir) return out;
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (h.kind === 'file') out.push(name);
    }
    return out.sort();
}

async function remove(dir: Dir | null, name: string, recursive = false) {
    if (!dir) return;
    try {
        await dir.removeEntry(name, { recursive });
    } catch {
        /* already gone */
    }
}

/** Where a folder store keeps things, relative to the folder the designer picked. */
interface Layout {
    levels: string[];
    versions: string[];
    drafts: string[];
    /** Folder holding collections.json and collections/. */
    data: string[];
}

const PLAIN: Layout = { levels: ['levels'], versions: ['levels', '.versions'], drafts: ['drafts'], data: [] };
/**
 * The game project itself: levels are the demo's own files in public/levels/; the editor's history,
 * drafts and collections live in editor-data/ so they are not bundled into the game.
 */
const PROJECT: Layout = { levels: ['public', 'levels'], versions: ['editor-data', 'versions'], drafts: ['editor-data', 'drafts'], data: ['editor-data'] };

/** The demo's level list (public/levels/index.json), in play order. */
export interface DemoEntry {
    id: string;
    name: string;
    difficulty: string;
    file: string;
}

export const DEMO_COLLECTION = 'Demo';

export class FolderStore implements Store {
    kind = 'folder' as const;
    private layout: Layout;

    constructor(
        readonly root: Dir,
        readonly isProject = false
    ) {
        this.layout = isProject ? PROJECT : PLAIN;
    }

    /** A folder with public/levels/ is the game project: the editor then works on the demo's levels. */
    static async open(root: Dir) {
        const project = !!(await dirAt(root, ['public', 'levels'], false));
        return new FolderStore(root, project);
    }

    get label() {
        return this.isProject ? `${this.root.name} (project)` : this.root.name;
    }

    private dir(path: string[], create = true) {
        return dirAt(this.root, path, create);
    }

    async listLevels() {
        const dir = await this.dir(this.layout.levels);
        const out: Level[] = [];
        for (const n of await names(dir)) {
            if (!n.endsWith('.json') || n === 'index.json') continue;
            const t = await readText(dir, n);
            try {
                if (t) out.push(normalizeLevel({ ...JSON.parse(t), id: n.replace(/\.json$/, '') }));
            } catch {
                /* skip files that are not levels */
            }
        }
        return out;
    }

    async readLevel(id: string) {
        const t = await readText(await this.dir(this.layout.levels), `${id}.json`);
        return t ? normalizeLevel(JSON.parse(t)) : null;
    }

    async writeLevel(level: Level, keepVersion: boolean) {
        const dir = (await this.dir(this.layout.levels))!;
        if (keepVersion) {
            const vdir = (await this.dir([...this.layout.versions, level.id]))!;
            await writeText(vdir, `v${level.version}.json`, json(level));
            const files = (await names(vdir)).sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)));
            for (const old of files.slice(KEEP_VERSIONS)) await remove(vdir, old);
        }
        await writeText(dir, `${level.id}.json`, json(level));
        await this.syncDemoEntry(level.id, level);
    }

    async deleteLevel(id: string) {
        await remove(await this.dir(this.layout.levels), `${id}.json`);
        await this.syncDemoEntry(id, null);
    }

    async renameLevel(oldId: string, level: Level) {
        const index = this.isProject ? await this.readDemoIndex() : null;
        await this.writeLevel(level, false);
        await remove(await this.dir(this.layout.levels), `${oldId}.json`);
        if (index) {
            await this.writeDemoIndex(index.map((e) => (e.id === oldId ? demoEntry(level) : e)));
        }
        const vOld = await this.dir([...this.layout.versions, oldId], false);
        if (vOld) {
            const vNew = (await this.dir([...this.layout.versions, level.id]))!;
            for (const n of await names(vOld)) {
                const t = await readText(vOld, n);
                if (t) await writeText(vNew, n, json({ ...JSON.parse(t), id: level.id }));
            }
            await remove(await this.dir(this.layout.versions, false), oldId, true);
        }
    }

    async listVersions(id: string) {
        const vdir = await this.dir([...this.layout.versions, id], false);
        const out: Level[] = [];
        for (const n of await names(vdir)) {
            const t = await readText(vdir, n);
            if (t) out.push(normalizeLevel(JSON.parse(t)));
        }
        return out.sort((a, b) => b.version - a.version);
    }

    async readDraft() {
        const t = await readText(await this.dir(this.layout.drafts, false), 'current.json');
        return t ? normalizeLevel(JSON.parse(t)) : null;
    }

    async writeDraft(level: Level | null) {
        const dir = (await this.dir(this.layout.drafts))!;
        if (level) await writeText(dir, 'current.json', json(level));
        else await remove(dir, 'current.json');
    }

    async readCollections() {
        const t = await readText(await this.dir(this.layout.data, false), 'collections.json');
        return t ? ((JSON.parse(t) as { collections: Collection[] }).collections ?? []) : [];
    }

    async writeCollections(cols: Collection[]) {
        await writeText((await this.dir(this.layout.data))!, 'collections.json', json({ collections: cols }));
    }

    async writeCollectionCopies(name: string, levels: Level[], oldName?: string) {
        if (oldName && oldName !== name) await remove(await this.dir([...this.layout.data, 'collections'], false), oldName, true);
        const dir = (await this.dir([...this.layout.data, 'collections', name]))!;
        const want = levels.map((l, i) => copyName(i, l.id));
        let removed = 0;
        for (const n of await names(dir)) {
            if (!want.includes(n)) {
                await remove(dir, n);
                removed++;
            }
        }
        for (let i = 0; i < levels.length; i++) await writeText(dir, want[i], json(levels[i]));
        return { copied: levels.length, removed };
    }

    async listCollectionCopies(name: string) {
        return names(await this.dir([...this.layout.data, 'collections', name], false));
    }

    // ---------- the demo's level list (project folders only) ----------

    async readDemoIndex(): Promise<DemoEntry[]> {
        const t = await readText(await this.dir(this.layout.levels), 'index.json');
        return t ? ((JSON.parse(t) as { levels: DemoEntry[] }).levels ?? []) : [];
    }

    async writeDemoIndex(entries: DemoEntry[]) {
        await writeText((await this.dir(this.layout.levels))!, 'index.json', json({ levels: entries }));
    }

    /** Keeps a demo level's name and difficulty in index.json in step with its file; drops deleted ones. */
    private async syncDemoEntry(id: string, level: Level | null) {
        if (!this.isProject) return;
        const index = await this.readDemoIndex();
        const i = index.findIndex((e) => e.id === id);
        if (i < 0) return;
        if (level) index[i] = demoEntry(level);
        else index.splice(i, 1);
        await this.writeDemoIndex(index);
    }
}

export function demoEntry(level: Level): DemoEntry {
    return { id: level.id, name: level.name, difficulty: level.difficulty, file: `${level.id}.json` };
}

// ---------------- browser storage ----------------

const P = 'ring360:';
const ls = {
    get<T>(k: string): T | null {
        try {
            const v = localStorage.getItem(P + k);
            return v ? (JSON.parse(v) as T) : null;
        } catch {
            return null;
        }
    },
    set(k: string, v: unknown) {
        try {
            if (v === null) localStorage.removeItem(P + k);
            else localStorage.setItem(P + k, JSON.stringify(v));
        } catch {
            /* storage full or blocked */
        }
    },
    keys(prefix: string) {
        const out: string[] = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i)!;
                if (k.startsWith(P + prefix)) out.push(k.slice(P.length));
            }
        } catch {
            /* blocked */
        }
        return out;
    }
};

export class BrowserStore implements Store {
    kind = 'browser' as const;
    label = 'Browser storage';

    async listLevels() {
        return ls.keys('level:').map((k) => normalizeLevel(ls.get<Level>(k)!));
    }
    async readLevel(id: string) {
        const l = ls.get<Level>(`level:${id}`);
        return l ? normalizeLevel(l) : null;
    }
    async writeLevel(level: Level, keepVersion: boolean) {
        if (keepVersion) {
            const vs = ls.get<Level[]>(`versions:${level.id}`) ?? [];
            ls.set(`versions:${level.id}`, [level, ...vs.filter((v) => v.version !== level.version)].slice(0, KEEP_VERSIONS));
        }
        ls.set(`level:${level.id}`, level);
    }
    async deleteLevel(id: string) {
        ls.set(`level:${id}`, null);
    }
    async renameLevel(oldId: string, level: Level) {
        await this.writeLevel(level, false);
        ls.set(`level:${oldId}`, null);
        const vs = ls.get<Level[]>(`versions:${oldId}`);
        if (vs) {
            ls.set(`versions:${level.id}`, vs.map((v) => ({ ...v, id: level.id })));
            ls.set(`versions:${oldId}`, null);
        }
    }
    async listVersions(id: string) {
        return (ls.get<Level[]>(`versions:${id}`) ?? []).map((l) => normalizeLevel(l));
    }
    async readDraft() {
        const l = ls.get<Level>('draft');
        return l ? normalizeLevel(l) : null;
    }
    async writeDraft(level: Level | null) {
        ls.set('draft', level);
    }
    async readCollections() {
        return ls.get<Collection[]>('collections') ?? [];
    }
    async writeCollections(cols: Collection[]) {
        ls.set('collections', cols);
    }
    async writeCollectionCopies(name: string, levels: Level[], oldName?: string) {
        if (oldName && oldName !== name) ls.set(`copies:${oldName}`, null);
        const before = ls.get<string[]>(`copies:${name}`) ?? [];
        const want = levels.map((l, i) => copyName(i, l.id));
        ls.set(`copies:${name}`, want);
        return { copied: levels.length, removed: before.filter((n) => !want.includes(n)).length };
    }
    async listCollectionCopies(name: string) {
        return ls.get<string[]>(`copies:${name}`) ?? [];
    }
}

// ---------------- remembered folder handle ----------------

function idb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('ring360-editor', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function rememberFolder(handle: Dir | null) {
    try {
        const db = await idb();
        const tx = db.transaction('handles', 'readwrite');
        if (handle) tx.objectStore('handles').put(handle, 'root');
        else tx.objectStore('handles').delete('root');
    } catch {
        /* private mode */
    }
}

export async function recallFolder(): Promise<Dir | null> {
    try {
        const db = await idb();
        return await new Promise((resolve) => {
            const req = db.transaction('handles').objectStore('handles').get('root');
            req.onsuccess = () => resolve((req.result as Dir) ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

type PermissionHandle = Dir & {
    queryPermission(o: { mode: string }): Promise<PermissionState>;
    requestPermission(o: { mode: string }): Promise<PermissionState>;
};

export async function hasPermission(h: Dir, ask: boolean): Promise<boolean> {
    const ph = h as PermissionHandle;
    if ((await ph.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return ask && (await ph.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export const folderSupported = () => 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<Dir> {
    return (window as unknown as { showDirectoryPicker(o: { mode: string }): Promise<Dir> }).showDirectoryPicker({ mode: 'readwrite' });
}
