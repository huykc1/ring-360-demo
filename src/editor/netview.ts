// Editor "Net" view: the six faces unfolded into a cross, drawn on a 2D canvas.
import { NET_CELLS } from '../core/cube';
import { isRing, ringGap, ringPoints } from '../core/geom';
import { Puzzle } from '../core/rules';
import { COLORS, FACES, TUBE_RADIUS, type FaceId, type Level, type Vec2 } from '../core/types';

export class NetView {
    readonly canvas = document.createElement('canvas');
    private ctx = this.canvas.getContext('2d')!;
    private level?: Level;
    private scale = 1;
    private ox = 0;
    private oy = 0;
    private obs: ResizeObserver;
    selected: string | null = null;
    dark = true;

    constructor(readonly container: HTMLElement) {
        Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block' });
        container.appendChild(this.canvas);
        this.obs = new ResizeObserver(() => this.draw());
        this.obs.observe(container);
    }

    dispose() {
        this.obs.disconnect();
        this.canvas.remove();
    }

    setLevel(level: Level) {
        this.level = level;
        this.draw();
    }

    /** Face and face-local point under a client position (also outside faces, for dragging over edges). */
    locate(clientX: number, clientY: number): { face: FaceId; local: Vec2; inside: boolean } | null {
        if (!this.level) return null;
        const r = this.canvas.getBoundingClientRect();
        const S = this.level.cubeSize;
        const gx = (clientX - r.left - this.ox) / this.scale;
        const gy = (clientY - r.top - this.oy) / this.scale;
        let best: { face: FaceId; local: Vec2; inside: boolean; d: number } | null = null;
        for (const f of FACES) {
            const [c, row] = NET_CELLS[f];
            const local = { x: gx - (c * S + S / 2), y: gy - (row * S + S / 2) };
            const d = Math.max(Math.abs(local.x), Math.abs(local.y));
            if (!best || d < best.d) best = { face: f, local, inside: d <= S / 2, d };
        }
        return best;
    }

    /** Piece whose wire is closest to the cursor (within a few pixels). */
    pick(clientX: number, clientY: number): string | null {
        const at = this.locate(clientX, clientY);
        if (!at || !this.level) return null;
        const pz = new Puzzle(this.level);
        const s = pz.initial();
        let best: { id: string; d: number } | null = null;
        for (const p of this.level.pieces) {
            if (p.face !== at.face) continue;
            const d = pz.distToPiece(s, p.id, at.local);
            if (d < 14 / this.scale + TUBE_RADIUS && (!best || d < best.d)) best = { id: p.id, d };
        }
        return best?.id ?? null;
    }

    draw() {
        const c = this.canvas;
        const dpr = Math.min(2, window.devicePixelRatio);
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        c.width = w * dpr;
        c.height = h * dpr;
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.level) return;
        const S = this.level.cubeSize;
        this.scale = Math.min((w - 24) / (4 * S), (h - 24) / (3 * S));
        this.ox = (w - 4 * S * this.scale) / 2;
        this.oy = (h - 3 * S * this.scale) / 2;
        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.scale, this.scale);

        for (const f of FACES) {
            const [col, row] = NET_CELLS[f];
            ctx.fillStyle = '#F3EBDD';
            ctx.strokeStyle = '#CDBFA6';
            ctx.lineWidth = 2 / this.scale;
            ctx.fillRect(col * S, row * S, S, S);
            ctx.strokeRect(col * S, row * S, S, S);
            ctx.fillStyle = '#B5AC9F';
            ctx.font = `${12 / this.scale}px system-ui, sans-serif`;
            ctx.fillText(f, col * S + 8 / this.scale, row * S + 16 / this.scale);
        }

        const pz = new Puzzle(this.level);
        const s = pz.initial();
        for (const p of this.level.pieces) {
            const [col, row] = NET_CELLS[p.face];
            ctx.save();
            ctx.translate(col * S + S / 2, row * S + S / 2);
            const color = COLORS[p.color] ?? p.color;
            const sel = p.id === this.selected;
            const stroke = (pts: Vec2[], width: number, col2: string, closed = false) => {
                ctx.beginPath();
                pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
                if (closed) ctx.closePath();
                ctx.lineWidth = width;
                ctx.strokeStyle = col2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            };
            const wire = isRing(p) ? ringPoints(p, p.radius ?? 48, p.rotation, ringGap(p), 4) : pz.barPts(s, p.id);
            if (sel) stroke(wire, TUBE_RADIUS * 2 + 8, 'rgba(232,137,43,0.55)', ringGap(p) === 0 && isRing(p));
            stroke(wire, TUBE_RADIUS * 2, color, ringGap(p) === 0 && isRing(p));
            for (const st of pz.stems(s, p.id)) {
                stroke([st.from, st.to], TUBE_RADIUS * 1.2, color);
                ctx.fillStyle = shade(color);
                ctx.fillRect(st.to.x - 7, st.to.y - 7, 14, 14);
            }
            if (p.type === 'rolling-elbow') {
                ctx.fillStyle = '#B8BCC4';
                ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
            }
            const b = pz.bombPoint(s, p.id);
            if (b) bomb(ctx, b);
            if (sel || this.level.pieces.length < 40) {
                ctx.fillStyle = 'rgba(42,37,32,0.55)';
                ctx.font = `${11 / this.scale}px system-ui, sans-serif`;
                ctx.fillText(p.id, p.x + 4, p.y + 4);
            }
            ctx.restore();
        }
        for (const fb of this.level.fixedBombs) {
            const [col, row] = NET_CELLS[fb.face];
            ctx.save();
            ctx.translate(col * S + S / 2, row * S + S / 2);
            bomb(ctx, fb);
            ctx.restore();
        }
        ctx.restore();
    }
}

function bomb(ctx: CanvasRenderingContext2D, at: Vec2) {
    ctx.beginPath();
    ctx.arc(at.x, at.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#2C2C2A';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#F09595';
    ctx.stroke();
}

function shade(hex: string) {
    const n = parseInt(hex.replace('#', ''), 16);
    const f = (v: number) => Math.round(v * 0.62);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
