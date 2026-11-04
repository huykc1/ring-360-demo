import * as Phaser from 'phaser';
import { FONT, softCard, T, TEAL } from './ui';

export type BoosterKind = 'hammer' | 'rocket';

/** Soft cream booster card with a teal uses-left badge and a label, drawn in code until art assets replace it. */
export class BoosterButton extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Graphics;
    private icon: Phaser.GameObjects.Graphics;
    private badge: Phaser.GameObjects.Graphics;
    private ring: Phaser.GameObjects.Graphics;
    private countText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, x: number, y: number, kind: BoosterKind, onTap: () => void, readonly size = 140) {
        super(scene, x, y);
        const s = size;
        this.ring = scene.add.graphics();
        this.bg = scene.add.graphics();
        this.icon = scene.add.graphics();
        if (kind === 'hammer') drawHammer(this.icon, s * 0.3);
        else drawRocket(this.icon, s * 0.3);
        this.badge = scene.add.graphics();
        this.countText = scene.add
            .text(s / 2 - 12, -s / 2 + 12, '', { fontFamily: FONT, fontSize: '28px', color: '#ffffff', fontStyle: 'bold' })
            .setOrigin(0.5);
        const label = scene.add
            .text(0, s / 2 + 34, kind === 'hammer' ? 'Hammer' : 'Rocket', { fontFamily: FONT, fontSize: '30px', color: T.ink, fontStyle: 'bold' })
            .setOrigin(0.5);
        this.add([this.ring, this.bg, this.icon, this.badge, this.countText, label]);
        this.drawCard(false);
        this.setCount(0);
        this.setSize(s, s);
        this.setInteractive({ useHandCursor: true });
        this.on('pointerdown', () => this.drawCard(true));
        this.on('pointerout', () => this.drawCard(false));
        this.on('pointerup', () => {
            this.drawCard(false);
            onTap();
        });
        scene.add.existing(this);
    }

    /** Uses left: a number in the teal badge, or "+" when none are left. */
    setCount(n: number) {
        const bx = this.size / 2 - 12;
        const by = -this.size / 2 + 12;
        const b = this.badge.clear();
        b.fillStyle(0xffffff, 1).fillCircle(bx, by, 27);
        b.fillStyle(TEAL, 1).fillCircle(bx, by, 23);
        if (n <= 0) b.fillStyle(0xffffff, 1).fillRoundedRect(bx - 11, by - 3, 22, 6, 3).fillRoundedRect(bx - 3, by - 11, 6, 22, 3);
        this.countText.setText(n > 0 ? String(n) : '');
    }

    /** Teal outline while the booster waits for a target. */
    setArmed(on: boolean) {
        const s = this.size;
        this.ring.clear();
        if (on) this.ring.lineStyle(7, TEAL, 1).strokeRoundedRect(-s / 2 - 8, -s / 2 - 8, s + 16, s + 16, 44);
    }

    private drawCard(pressed: boolean) {
        const s = this.size;
        this.bg.clear();
        softCard(this.bg, -s / 2, -s / 2, s, s, 38, T.card, pressed);
        this.icon.y = pressed ? 3 : 0;
    }
}

type Pt = [number, number];

function shape(g: Phaser.GameObjects.Graphics, rot: number) {
    const tr = ([x, y]: Pt) => new Phaser.Math.Vector2(x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot));
    return {
        poly(pts: Pt[], color: number) {
            g.fillStyle(color, 1).fillPoints(pts.map(tr), true);
        },
        rect(x: number, y: number, w: number, h: number, color: number) {
            this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color);
        },
        circle(x: number, y: number, r: number, color: number) {
            const p = tr([x, y]);
            g.fillStyle(color, 1).fillCircle(p.x, p.y, r);
        }
    };
}

function drawHammer(g: Phaser.GameObjects.Graphics, r: number) {
    // Red mallet with a gold star on a yellow handle, tilted like the reference.
    const s = shape(g, -0.65);
    s.rect(-r * 0.13, -r * 0.1, r * 0.26, r * 1.3, 0xf0b62c);
    s.rect(-r * 0.13, -r * 0.1, r * 0.09, r * 1.3, 0xf7cd57);
    s.circle(0, r * 1.2, r * 0.13, 0xf0b62c);
    s.rect(-r * 0.75, -r * 0.8, r * 1.5, r * 0.85, 0xdc4a36);
    s.rect(-r * 0.75, -r * 0.8, r * 1.5, r * 0.25, 0xef6a52);
    s.rect(-r * 0.85, -r * 0.85, r * 0.2, r * 0.95, 0xc23a2a);
    s.rect(r * 0.65, -r * 0.85, r * 0.2, r * 0.95, 0xc23a2a);
    const star: Pt[] = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.1 : r * 0.24;
        star.push([Math.cos(a) * rr, -r * 0.38 + Math.sin(a) * rr]);
    }
    s.poly(star, 0xffd447);
}

function drawRocket(g: Phaser.GameObjects.Graphics, r: number) {
    // White rocket with a red nose and fins, a yellow window and a small flame.
    const s = shape(g, 0.6);
    const w = r * 0.42;
    s.poly([[-r * 0.14, r * 0.75], [r * 0.14, r * 0.75], [0, r * 1.25]], 0xffb340);
    s.poly([[-r * 0.07, r * 0.75], [r * 0.07, r * 0.75], [0, r * 1.05]], 0xffe27a);
    s.poly([[-w, r * 0.2], [-w * 1.9, r * 0.75], [-w * 0.9, r * 0.7]], 0xd8452f);
    s.poly([[w, r * 0.2], [w * 1.9, r * 0.75], [w * 0.9, r * 0.7]], 0xd8452f);
    s.poly([[-w, -r * 0.45], [w, -r * 0.45], [w * 0.9, r * 0.72], [-w * 0.9, r * 0.72]], 0xfdf8f0);
    s.poly([[-w * 0.35, -r * 0.45], [-w * 0.15, -r * 0.45], [-w * 0.2, r * 0.72], [-w * 0.4, r * 0.72]], 0xeae2d4);
    s.poly([[-w, -r * 0.45], [w, -r * 0.45], [w * 0.6, -r * 0.85], [0, -r * 1.1], [-w * 0.6, -r * 0.85]], 0xd8452f);
    s.circle(0, -r * 0.05, r * 0.24, 0xf2c032);
    s.circle(0, -r * 0.05, r * 0.15, 0x6b4a2b);
}
