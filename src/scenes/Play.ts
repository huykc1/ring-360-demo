import * as Phaser from 'phaser';
import { loadLevel, shared } from '../game/shared';
import { angleOf, wrap } from '../core/geom';
import { Puzzle, type MoveResult, type State } from '../core/rules';
import type { Level, Vec2 } from '../core/types';
import { button, FONT, INK, MUTED } from './ui';
import { RotatePad } from './RotatePad';
import { BoosterButton } from './BoosterButton';

const HAMMERS = 3;
const ROCKETS = 2;
const ROCKET_PIECES = 3;

type Drag =
    | { kind: 'orbit'; x: number; y: number }
    | { kind: 'rotate'; id: string; last: number; moved: number }
    | { kind: 'slide'; id: string; dir: Vec2; last: Vec2; moved: number; canFlip: boolean }
    | { kind: 'tap'; id: string; x: number; y: number };

/** One level on the cube, with the HUD from the spec: Back, Restart, level name, pieces left. */
export class Play extends Phaser.Scene {
    private level!: Level;
    private index = -1;
    private puzzle!: Puzzle;
    private state!: State;
    private drag: Drag | null = null;
    private piecesText!: Phaser.GameObjects.Text;
    private toast!: Phaser.GameObjects.Text;
    private winLayer?: Phaser.GameObjects.Container;
    private pinch?: number;
    private pad!: RotatePad;
    private hammerBtn!: BoosterButton;
    private rocketBtn!: BoosterButton;
    /** Uses left this attempt (prototype values; restart refills them). */
    private hammers = HAMMERS;
    private rockets = ROCKETS;
    /** The hammer is waiting for the player to tap a piece. */
    private armed = false;
    private lastSpark = 0;

    constructor() {
        super('Play');
    }

    init(data: { level: Level; index: number }) {
        this.level = data.level;
        this.index = data.index;
        this.drag = null;
        this.winLayer = undefined;
        this.hammers = HAMMERS;
        this.rockets = ROCKETS;
        this.armed = false;
    }

    create() {
        const { width, height } = this.scale;
        const view = shared.view!;
        view.container.style.setProperty('visibility', 'visible');
        this.puzzle = new Puzzle(this.level);
        this.state = this.puzzle.initial();
        view.setLevel(this.level, this.puzzle, this.state);
        view.resetView();

        button(this, 110, 90, 170, 84, '← Back', () => this.back(), { size: 30 });
        button(this, width - 70, 90, 96, 84, '↻', () => this.restart(), { size: 44 });
        this.add.text(width / 2, 70, this.level.name, { fontFamily: FONT, fontSize: '34px', color: INK, fontStyle: 'bold' }).setOrigin(0.5);
        this.piecesText = this.add.text(width / 2, 112, '', { fontFamily: FONT, fontSize: '26px', color: MUTED }).setOrigin(0.5);
        this.add
            .text(width / 2, height - 52, 'Drag here or on the background to turn the cube · drag a ring to twist it', { fontFamily: FONT, fontSize: '22px', color: MUTED })
            .setOrigin(0.5);
        this.pad = new RotatePad(this, width / 2, height - 190);
        this.hammerBtn = new BoosterButton(this, width / 2 - 230, height - 190, 'hammer', () => this.toggleHammer());
        this.rocketBtn = new BoosterButton(this, width / 2 + 230, height - 190, 'rocket', () => this.fireRocket());
        this.hammerBtn.setCount(this.hammers);
        this.rocketBtn.setCount(this.rockets);
        this.pad.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (this.winLayer) return;
            this.drag = { kind: 'orbit', x: p.x, y: p.y };
            this.pad.press(true);
        });
        if (this.level.instruction) {
            this.add.text(width / 2, 170, this.level.instruction, { fontFamily: FONT, fontSize: '26px', color: INK, wordWrap: { width: width - 120 } }).setOrigin(0.5, 0);
        }
        this.toast = this.add.text(width / 2, height - 330, '', { fontFamily: FONT, fontSize: '28px', color: '#9A520C' }).setOrigin(0.5).setAlpha(0);
        this.updateHud();

        this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: unknown[]) => this.onDown(p, over));
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
        this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
        this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => view.zoom(dy > 0 ? 1.08 : 1 / 1.08));
        this.input.addPointer(1);
        this.events.once('shutdown', () => this.input.removeAllListeners());
    }

    /** Converts a Phaser pointer to page coordinates for the 3D view. */
    private client(p: Phaser.Input.Pointer): Vec2 {
        const r = this.game.canvas.getBoundingClientRect();
        return { x: r.left + (p.x / this.scale.width) * r.width, y: r.top + (p.y / this.scale.height) * r.height };
    }

    private onDown(p: Phaser.Input.Pointer, over: unknown[]) {
        if (over.length || this.winLayer) return;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (p1.isDown && p2.isDown) {
            this.pinch = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
            this.drag = null;
            return;
        }
        const view = shared.view!;
        const c = this.client(p);
        const hit = view.pick(c.x, c.y);
        if (this.armed && hit.pieceId) {
            this.useHammer(hit.pieceId);
            return;
        }
        if (!hit.pieceId) {
            this.drag = { kind: 'orbit', x: p.x, y: p.y };
            return;
        }
        const id = hit.pieceId;
        const piece = this.puzzle.byId.get(id)!;
        const m = this.puzzle.mobility(this.state, id);
        const at = view.facePoint(piece.face, c.x, c.y);
        if (m.kind === 'rotate' && at) this.drag = { kind: 'rotate', id, last: angleOf(piece, at), moved: 0 };
        else if (m.kind === 'slide' && at) this.drag = { kind: 'slide', id, dir: m.dir, last: at, moved: 0, canFlip: m.canFlip };
        else if (m.kind === 'flip') this.drag = { kind: 'tap', id, x: p.x, y: p.y };
        else {
            this.drag = { kind: 'orbit', x: p.x, y: p.y };
            if (m.kind === 'none') {
                view.flash(id);
                this.say(m.reason === 'holds another piece' ? 'Free the pieces it holds first' : 'This piece is stuck');
            }
        }
    }

    private onMove(p: Phaser.Input.Pointer) {
        const view = shared.view!;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (p1.isDown && p2.isDown && this.pinch) {
            const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
            view.zoom(this.pinch / d);
            this.pinch = d;
            return;
        }
        const d = this.drag;
        if (!d || !p.isDown) return;
        if (d.kind === 'orbit') {
            view.orbit(p.x - d.x, p.y - d.y);
            this.pad.spin(p.x - d.x);
            d.x = p.x;
            d.y = p.y;
            return;
        }
        const c = this.client(p);
        const piece = this.puzzle.byId.get(d.id)!;
        const at = view.facePoint(piece.face, c.x, c.y);
        if (!at) return;
        if (d.kind === 'rotate') {
            const a = angleOf(piece, at);
            const delta = wrap(a - d.last);
            d.last = a;
            if (Math.abs(delta) < 0.2) return;
            this.apply(this.puzzle.rotate(this.state, d.id, delta), d.id);
            d.moved += Math.abs(delta);
        } else if (d.kind === 'slide') {
            const amount = (at.x - d.last.x) * d.dir.x + (at.y - d.last.y) * d.dir.y;
            d.last = at;
            if (Math.abs(amount) < 0.3) return;
            this.apply(this.puzzle.slide(this.state, d.id, amount), d.id);
            d.moved += Math.abs(amount);
        }
    }

    private onUp(p: Phaser.Input.Pointer) {
        const d = this.drag;
        this.drag = null;
        this.pinch = undefined;
        if (d?.kind === 'orbit') this.pad.press(false);
        if (!d) return;
        const tapped = (d.kind === 'tap' && Math.hypot(p.x - d.x, p.y - d.y) < 20) || (d.kind === 'slide' && d.canFlip && d.moved < 3);
        if (tapped && 'id' in d) this.apply(this.puzzle.flip(this.state, d.id), d.id);
    }

    private apply(r: MoveResult, id: string) {
        const view = shared.view!;
        // Bumping into another piece: sparks at the contact, the blocker glows red. Throttled while dragging.
        if (r.blocked && r.hit && this.time.now - this.lastSpark > 180) {
            this.lastSpark = this.time.now;
            view.sparkAt(r.hit.face, r.hit.at);
            view.flash(r.hit.other, 3, 380);
            view.flash(id, 2.5, 240);
        }
        if (r.moved > 0) view.updatePiece(id);
        if (r.exploded) this.boom(id);
        if (r.broken.length) view.breakPieces(r.broken);
        if (r.exploded) this.time.delayedCall(300, () => view.rebuildAll());
        if (r.broken.length || r.exploded) {
            this.drag = null;
            this.updateHud();
            if (this.puzzle.isWon(this.state)) this.time.delayedCall(450, () => this.win());
        }
    }

    // ---------- boosters ----------

    private toggleHammer() {
        if (this.winLayer) return;
        if (this.hammers <= 0) return this.say('No hammers left (no shop in this prototype)');
        this.armed = !this.armed;
        this.hammerBtn.setArmed(this.armed);
        if (this.armed) this.say('Tap a piece to smash it');
    }

    private useHammer(id: string) {
        this.armed = false;
        this.hammerBtn.setArmed(false);
        this.hammers--;
        this.hammerBtn.setCount(this.hammers);
        this.boom(id);
        this.apply(this.puzzle.smash(this.state, [id]), id);
    }

    /** Breaks the pieces nearest the middle of the face turned towards the player. */
    private fireRocket() {
        if (this.winLayer) return;
        if (this.rockets <= 0) return this.say('No rockets left (no shop in this prototype)');
        const face = shared.view!.frontFace();
        const targets = this.level.pieces
            .filter((p) => p.face === face && !this.state.p[p.id].broken)
            .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
            .slice(0, ROCKET_PIECES);
        if (!targets.length) return this.say('Nothing to hit on this side: turn the cube');
        this.rockets--;
        this.rocketBtn.setCount(this.rockets);
        targets.forEach((p, i) => this.time.delayedCall(i * 90, () => this.boom(p.id)));
        this.apply(this.puzzle.smash(this.state, targets.map((p) => p.id)), targets[0].id);
    }

    private boom(id: string) {
        const piece = this.puzzle.byId.get(id)!;
        const view = shared.view!;
        const s = view.project(piece.face, piece);
        const r = this.game.canvas.getBoundingClientRect();
        const x = (s.x / r.width) * this.scale.width;
        const y = (s.y / r.height) * this.scale.height;
        const ring = this.add.circle(x, y, 30, 0xff7a3c, 0.55);
        this.tweens.add({ targets: ring, scale: 6, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
        this.cameras.main.shake(180, 0.006);
    }

    private updateHud() {
        this.piecesText.setText(`${this.puzzle.remaining(this.state)} / ${this.level.pieces.length} pieces left`);
    }

    private say(msg: string) {
        this.toast.setText(msg).setAlpha(1);
        this.tweens.killTweensOf(this.toast);
        this.tweens.add({ targets: this.toast, alpha: 0, delay: 1100, duration: 400 });
    }

    private restart() {
        this.scene.restart({ level: this.level, index: this.index });
    }

    private back() {
        if (shared.embedded) window.parent.postMessage({ type: 'ring360:back' }, '*');
        else this.scene.start('Menu');
    }

    private win() {
        const { width, height } = this.scale;
        const layer = this.add.container(0, 0);
        const shade = this.add.rectangle(width / 2, height / 2, width, height, 0xf4eee4, 0.75).setInteractive();
        const panel = this.add.graphics();
        panel.fillStyle(0xffffff, 1).fillRoundedRect(width / 2 - 280, height / 2 - 200, 560, 400, 28);
        const title = this.add.text(width / 2, height / 2 - 110, 'Level cleared!', { fontFamily: FONT, fontSize: '56px', color: INK, fontStyle: 'bold' }).setOrigin(0.5);
        layer.add([shade, panel, title]);
        const next = shared.levels[this.index + 1];
        if (!shared.embedded && next && this.index >= 0) {
            layer.add(
                button(this, width / 2, height / 2 + 10, 380, 90, 'Next level', async () => this.scene.start('Play', { level: await loadLevel(next), index: this.index + 1 }), {
                    fill: 0xe8892b,
                    color: '#1c1209'
                })
            );
        }
        layer.add(button(this, width / 2, height / 2 + 120, 380, 90, shared.embedded ? 'Play again' : 'Levels', () => (shared.embedded ? this.restart() : this.scene.start('Menu'))));
        this.winLayer = layer;
    }
}
