// Player settings, kept in this browser. The game and the editor are served from the same site, so the
// editor theme switch here and the one in the editor's header share one stored value.

const KEY = (k: string) => `ring360-ui:${k}`;

function read<T>(k: string, fallback: T): T {
    try {
        const v = localStorage.getItem(KEY(k));
        return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
        return fallback;
    }
}

function write(k: string, v: unknown) {
    try {
        localStorage.setItem(KEY(k), JSON.stringify(v));
    } catch {
        /* storage blocked: the setting lasts for this visit only */
    }
}

export const settings = {
    /** Dark theme in the game. */
    get darkGame() {
        return read<string>('gameTheme', 'light') === 'dark';
    },
    set darkGame(on: boolean) {
        write('gameTheme', on ? 'dark' : 'light');
    },
    /** ON: drag anywhere empty to turn the cube. OFF: only drags that start on the rotate pad turn it. */
    get rotateAnywhere() {
        return read('rotateAnywhere', true);
    },
    set rotateAnywhere(on: boolean) {
        write('rotateAnywhere', on);
    },
    /** Dark theme in the level editor (same value as the editor's own switch). */
    get darkEditor() {
        return read<string>('theme', 'dark') === 'dark';
    },
    set darkEditor(on: boolean) {
        write('theme', on ? 'dark' : 'light');
    }
};
