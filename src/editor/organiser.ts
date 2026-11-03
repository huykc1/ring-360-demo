// Organiser tab: ordered collections of levels, saved as collections.json plus numbered copies.
import type { Level } from '../core/types';
import { clear, h } from './dom';
import { copyName, type Collection, type Store } from './store';

export class Organiser {
    private cols: Collection[] = [];
    private sel = 0;
    private work: Collection | null = null;
    private copies: string[] = [];
    private left!: HTMLElement;
    private center!: HTMLElement;
    private right!: HTMLElement;
    private dragFrom = -1;

    constructor(
        private store: () => Store,
        private levels: () => Level[],
        private say: (msg: string) => void
    ) {}

    async mount(left: HTMLElement, center: HTMLElement, right: HTMLElement) {
        this.left = left;
        this.center = center;
        this.right = right;
        left.className = 'side left';
        right.className = 'side right';
        left.style.width = '240px';
        right.style.width = '280px';
        this.cols = await this.store().readCollections();
        await this.pick(Math.min(this.sel, Math.max(0, this.cols.length - 1)));
    }

    private get dirty() {
        const saved = this.cols[this.sel];
        return !!this.work && JSON.stringify(this.work) !== JSON.stringify(saved);
    }

    private async pick(i: number) {
        if (this.dirty && !confirm('Discard unsaved changes to this collection?')) return;
        this.sel = i;
        const c = this.cols[i];
        this.work = c ? structuredClone(c) : null;
        this.copies = c ? await this.store().listCollectionCopies(c.name) : [];
        this.render();
    }

    private render() {
        this.renderLeft();
        this.renderCenter();
        this.renderRight();
    }

    private renderLeft() {
        clear(
            this.left,
            h('div', { class: 'side-head' }, h('h3', {}, 'Collections'), h('button', { class: 'icon', title: 'New collection', onClick: () => this.create() }, '+')),
            h(
                'div',
                { class: 'side-scroll' },
                this.cols.map((c, i) =>
                    h(
                        'div',
                        { class: `coll${i === this.sel ? ' active' : ''}`, onClick: () => i !== this.sel && this.pick(i) },
                        h('span', {}, h('span', { class: 'muted' }, `v${c.version} `), h('b', {}, c.name), h('br'), h('span', { class: 'muted' }, `${c.levels.length} levels`)),
                        h('button', { class: 'ghost icon', title: 'Remove from the list (the folder on disk stays)', onClick: (e: Event) => (e.stopPropagation(), this.removeCollection(i)) }, '🗑')
                    )
                ),
                !this.cols.length && h('p', { class: 'muted' }, 'No collections yet. Press + to start one.')
            )
        );
    }

    private renderCenter() {
        const w = this.work;
        if (!w) return clear(this.center, h('div', { class: 'connect' }, h('p', { class: 'muted' }, 'Create a collection to order levels for play.')));
        const byId = new Map(this.levels().map((l) => [l.id, l]));
        const rows = w.levels.map((id, i) => {
            const lv = byId.get(id);
            const faces = lv ? new Set(lv.pieces.map((p) => p.face)).size : 0;
            const copied = this.copies.includes(copyName(i, id)) && !this.dirty;
            const row = h(
                'div',
                { class: 'org-row', draggable: 'true' },
                h('span', { class: 'grip', title: 'Drag to reorder' }, '⋮⋮'),
                h('span', { class: 'muted', style: { fontFamily: 'ui-monospace, Menlo, monospace' } }, String(i + 1).padStart(2, '0')),
                h(
                    'span',
                    { class: 'grow' },
                    h('b', {}, lv?.name ?? id),
                    h('br'),
                    lv
                        ? h('span', { class: 'muted' }, `${lv.pieces.length} pcs · ${faces} face${faces === 1 ? '' : 's'} `, h('span', { class: 'tag' }, lv.difficulty), ' ')
                        : h('span', { style: { color: 'var(--bad)' } }, 'missing level '),
                    h('span', { class: `copy-state${copied ? '' : ' pending'}` }, copied ? 'copy in folder' : 'not copied yet: Save')
                ),
                h('button', { class: 'icon', title: 'Move up', disabled: i === 0, onClick: () => this.move(i, i - 1) }, '↑'),
                h('button', { class: 'icon', title: 'Move down', disabled: i === w.levels.length - 1, onClick: () => this.move(i, i + 1) }, '↓'),
                h('button', { class: 'icon', title: 'Remove from collection', style: { color: 'var(--bad)' }, onClick: () => (w.levels.splice(i, 1), this.render()) }, '×')
            );
            row.addEventListener('dragstart', () => (this.dragFrom = i));
            row.addEventListener('dragover', (e) => (e.preventDefault(), row.classList.add('dragover')));
            row.addEventListener('dragleave', () => row.classList.remove('dragover'));
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('dragover');
                if (this.dragFrom >= 0) this.move(this.dragFrom, i);
                this.dragFrom = -1;
            });
            return row;
        });
        clear(
            this.center,
            h('div', { class: 'row', style: { padding: '10px', borderBottom: '1px solid var(--line)' } }, h('b', { class: 'grow', style: { fontSize: '15px' } }, w.name), h('span', { class: 'pill' }, `${w.levels.length} levels`)),
            h('div', { style: { overflow: 'auto', flex: '1' } }, rows, !rows.length && h('p', { class: 'muted', style: { padding: '10px' } }, 'Empty: use Add level on the right.'))
        );
    }

    private renderRight() {
        const w = this.work;
        if (!w) return clear(this.right, h('div', { class: 'side-head' }, h('h3', {}, 'Settings')));
        const name = h('input', { value: w.name });
        name.addEventListener('input', () => {
            w.name = name.value.replace(/[\\/:*?"<>|]/g, '').trim() || w.name;
            this.renderCenter();
        });
        const version = h('input', { type: 'number', value: w.version });
        version.addEventListener('input', () => (w.version = Number(version.value) || 1));
        clear(
            this.right,
            h('div', { class: 'side-head' }, h('h3', {}, 'Settings')),
            h(
                'div',
                { class: 'side-scroll' },
                h('label', {}, h('div', { class: 'cap' }, 'Name'), name),
                h('div', { style: { height: '8px' } }),
                h('label', {}, h('div', { class: 'cap' }, 'Version'), version),
                h('div', { style: { height: '12px' } }),
                h('button', { style: { width: '100%' }, onClick: () => this.addDialog() }, '+ Add level'),
                h('div', { style: { height: '8px' } }),
                h('button', { class: 'primary', style: { width: '100%' }, onClick: () => this.save() }, 'Save collection'),
                h('p', { class: 'muted' }, `Save writes collections.json and numbered copies in collections/${w.name}/. Changes are only written when you press Save.`)
            )
        );
    }

    private move(from: number, to: number) {
        const w = this.work!;
        if (to < 0 || to >= w.levels.length || from === to) return;
        const [id] = w.levels.splice(from, 1);
        w.levels.splice(to, 0, id);
        this.render();
    }

    private async create() {
        if (this.dirty && !confirm('Discard unsaved changes to this collection?')) return;
        let n = this.cols.length + 1;
        while (this.cols.some((c) => c.name === `Collection ${n}`)) n++;
        this.cols.push({ name: `Collection ${n}`, version: 1, levels: [] });
        await this.store().writeCollections(this.cols);
        this.work = null;
        await this.pick(this.cols.length - 1);
    }

    private async removeCollection(i: number) {
        if (!confirm(`Remove “${this.cols[i].name}” from the list? Its folder on disk is kept.`)) return;
        this.cols.splice(i, 1);
        await this.store().writeCollections(this.cols);
        this.work = null;
        await this.pick(Math.max(0, Math.min(this.sel, this.cols.length - 1)));
    }

    private async save() {
        const w = this.work!;
        const old = this.cols[this.sel];
        if (this.cols.some((c, i) => i !== this.sel && c.name === w.name)) return this.say(`A collection named “${w.name}” already exists`);
        const byId = new Map(this.levels().map((l) => [l.id, l]));
        const levels = w.levels.map((id) => byId.get(id)).filter((l): l is Level => !!l);
        const before = new Set(this.copies);
        const res = await this.store().writeCollectionCopies(w.name, levels, old?.name);
        const renumbered = levels.filter((l, i) => !before.has(copyName(i, l.id)) && [...before].some((n) => n.endsWith(`_${l.id}.json`))).length;
        this.cols[this.sel] = structuredClone(w);
        await this.store().writeCollections(this.cols);
        this.copies = await this.store().listCollectionCopies(w.name);
        this.say(`Saved ${w.name}: ${res.copied} copied, ${renumbered} renumbered, ${res.removed} removed`);
        this.render();
    }

    /** "Add level" dialog: levels not yet in the collection, with search, ticks, Add all and Add selected. */
    private addDialog() {
        const w = this.work!;
        const ticked = new Set<string>();
        let query = '';
        const back = h('div', { class: 'modal-back' });
        const close = () => back.remove();
        back.addEventListener('pointerdown', (e) => e.target === back && close());
        const body = h('div', { class: 'modal-body' });
        const foot = h('div', { class: 'modal-foot' });
        const available = () => this.levels().filter((l) => !w.levels.includes(l.id));
        const listed = () => available().filter((l) => !query || l.name.toLowerCase().includes(query));
        const add = (ids: string[]) => {
            w.levels.push(...ids);
            close();
            this.render();
        };
        const draw = () => {
            const all = available();
            if (!all.length) {
                clear(body, h('p', { class: 'muted' }, 'All levels are already in this collection.'));
                clear(foot);
                return;
            }
            const rows = listed();
            clear(
                body,
                search,
                h('div', { style: { height: '8px' } }),
                rows.map((l) => {
                    const faces = new Set(l.pieces.map((p) => p.face)).size;
                    const on = ticked.has(l.id);
                    return h(
                        'div',
                        { class: `pick-row${on ? ' checked' : ''}`, onClick: () => (on ? ticked.delete(l.id) : ticked.add(l.id), draw()) },
                        h('input', { type: 'checkbox', checked: on, tabindex: '-1' }),
                        h('span', { class: 'grow' }, h('b', {}, l.name), ' ', h('span', { class: 'muted' }, `${l.pieces.length} pcs · ${faces} face${faces === 1 ? '' : 's'}`)),
                        h('span', { class: 'tag' }, l.difficulty)
                    );
                }),
                !rows.length && h('p', { class: 'muted' }, 'No level name matches the search.')
            );
            const selected = rows.filter((l) => ticked.has(l.id)).map((l) => l.id);
            clear(
                foot,
                h('span', { class: 'muted grow' }, `${selected.length} of ${rows.length} selected`),
                h('button', { disabled: !rows.length, onClick: () => add(rows.map((l) => l.id)) }, 'Add all levels'),
                h('button', { class: 'primary', disabled: !selected.length, onClick: () => add(selected) }, 'Add selected levels')
            );
        };
        const search = h('input', { placeholder: 'Search level name' });
        search.addEventListener('input', () => {
            query = search.value.toLowerCase();
            draw();
            search.focus();
        });
        back.append(
            h(
                'div',
                { class: 'modal' },
                h('div', { class: 'modal-head' }, `Add levels to ${w.name}`, h('button', { class: 'icon', title: 'Close', onClick: close }, '✕')),
                body,
                foot
            )
        );
        document.body.append(back);
        draw();
        search.focus();
    }
}
