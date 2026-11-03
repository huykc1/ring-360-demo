// Tiny DOM helpers for the editor.
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        else if (k === 'class') el.className = String(v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'value') (el as HTMLInputElement).value = String(v);
        else if (k === 'checked') (el as HTMLInputElement).checked = !!v;
        else if (k === 'disabled') (el as HTMLButtonElement).disabled = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export function clear(el: HTMLElement, ...children: (Child | Child[])[]) {
    el.replaceChildren();
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
}

/** Debounces calls per key. */
const timers = new Map<string, number>();
export function later(key: string, ms: number, fn: () => void) {
    clearTimeout(timers.get(key));
    timers.set(key, window.setTimeout(fn, ms));
}

export const ui = {
    get<T>(key: string, fallback: T): T {
        try {
            const v = localStorage.getItem(`ring360-ui:${key}`);
            return v === null ? fallback : (JSON.parse(v) as T);
        } catch {
            return fallback;
        }
    },
    set(key: string, v: unknown) {
        try {
            localStorage.setItem(`ring360-ui:${key}`, JSON.stringify(v));
        } catch {
            /* blocked */
        }
    }
};

export function logo() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 14');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M8 0L16 14H11L8 8L5 14H0Z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return h('span', { class: 'logo' }, svg, 'ATHENA');
}
