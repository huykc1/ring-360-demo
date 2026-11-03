import * as Phaser from 'phaser';

export type BoosterKind = 'hammer' | 'rocket';

/** Square booster card with a green "+" badge, drawn in code until art assets replace it. */
export class BoosterButton extends Phaser.GameObjects.Container {
    private badge: Phaser.GameObjects.Graphics;
    private ring: Phaser.GameObjects.Graphics;
    private countText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, x: number, y: number, kind: BoosterKind, onTap: () => void, readonly size = 136) {
        super(scene, x, y);
        const s = size;
        const card = scene.add.graphics();
        card.fillStyle(0x000000, 0.14).fillRoundedRect(-s / 2, -s / 2 + 8, s, s, 30);
        card.fillStyle(0xeaf3ff, 1).fillRoundedRect(-s / 2, -s / 2, s, s, 30);
        card.fillStyle(0x2f8ff0, 1).fillRoundedRect(-s / 2 + 9, -s / 2 + 9, s - 18, s - 18, 23);
        card.fillStyle(0x5fb4ff, 1).fillRoundedRect(-s / 2 + 9, -s / 2 + 9, s - 18, (s - 18) * 0.45, { tl: 23, tr: 23, bl: 6, br: 6 });
        const icon = scene.add.graphics();
        if (kind === 'hammer') drawHammer(icon, s * 0.34);
        else drawRocket(icon, s * 0.34);
        this.ring = scene.add.graphics();
        this.badge = scene.add.graphics();
        this.countText = scene.add
            .text(s / 2 - 6, s / 2 - 6, '', { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold' })
            .setOrigin(0.5);
        this.add([this.ring, card, icon, this.badge, this.countText]);
        this.setCount(0);
        this.setSize(s, s);
        this.setInteractive({ useHandCursor: true });
        this.on('pointerdown', () => this.setScale(0.93));
        this.on('pointerout', () => this.setScale(1));
        this.on('pointerup', () => {
            this.setScale(1);
            onTap();
        });
        scene.add.existing(this);
    }

    /** Uses left: a number in the badge, or "+" when none are left. */
    setCount(n: number) {
        const bx = this.size / 2 - 6;
        const by = this.size / 2 - 6;
        const b = this.badge.clear();
        b.fillStyle(0xffffff, 1).fillCircle(bx, by, 28);
        b.fillStyle(0x2fb24a, 1).fillCircle(bx, by, 23);
        if (n <= 0) b.fillStyle(0xffffff, 1).fillRoundedRect(bx - 13, by - 4, 26, 8, 3).fillRoundedRect(bx - 4, by - 13, 8, 26, 3);
        this.countText.setText(n > 0 ? String(n) : '');
    }

    /** Glowing outline while the booster waits for a target. */
    setArmed(on: boolean) {
        const s = this.size;
        this.ring.clear();
        if (on) this.ring.lineStyle(8, 0xffc23d, 1).strokeRoundedRect(-s / 2 - 8, -s / 2 - 8, s + 16, s + 16, 36);
    }
}

function drawHammer(g: Phaser.GameObjects.Graphics, r: number) {
    // Tilted mallet: gold handle, red head with gold rims and a star.
    const rot = (x: number, y: number, a = -0.6) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as const;
    const poly = (pts: [number, number][], color: number) => {
        g.fillStyle(color, 1).fillPoints(pts.map(([x, y]) => new Phaser.Math.Vector2(...rot(x, y))), true);
    };
    const rect = (x: number, y: number, w: number, h: number, color: number) =>
        poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color);
    rect(-r * 0.13, -r * 0.05, r * 0.26, r * 1.25, 0xc98a1a);
    rect(-r * 0.13, r * 0.95, r * 0.26, r * 0.3, 0xe8b23a);
    rect(-r * 0.7, -r * 0.75, r * 1.4, r * 0.95, 0xd8322b);
    rect(-r * 0.7, -r * 0.75, r * 1.4, r * 0.28, 0xf0584e);
    rect(-r * 0.82, -r * 0.82, r * 0.22, r * 1.09, 0xf2c032);
    rect(r * 0.6, -r * 0.82, r * 0.22, r * 1.09, 0xf2c032);
    const star: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.12 : r * 0.28;
        star.push([Math.cos(a) * rr, -r * 0.28 + Math.sin(a) * rr]);
    }
    poly(star, 0xffd84a);
}

function drawRocket(g: Phaser.GameObjects.Graphics, r: number) {
    const a = 0.55;
    const rot = (x: number, y: number) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as const;
    const poly = (pts: [number, number][], color: number) => {
        g.fillStyle(color, 1).fillPoints(pts.map(([x, y]) => new Phaser.Math.Vector2(...rot(x, y))), true);
    };
    const w = r * 0.42;
    // Fins, body stripes, nose cone, fuse.
    poly([[-w, r * 0.45], [-w * 1.8, r * 0.95], [-w, r * 0.85]], 0xd8322b);
    poly([[w, r * 0.45], [w * 1.8, r * 0.95], [w, r * 0.85]], 0xd8322b);
    for (let i = 0; i < 5; i++) {
        const y0 = -r * 0.45 + i * r * 0.27;
        poly([[-w, y0], [w, y0], [w, y0 + r * 0.27], [-w, y0 + r * 0.27]], i % 2 ? 0xffffff : 0xe03a32);
    }
    poly([[-w * 1.05, -r * 0.45], [w * 1.05, -r * 0.45], [0, -r * 1.15]], 0xd8322b);
    poly([[-w * 1.1, -r * 0.5], [w * 1.1, -r * 0.5], [w * 1.1, -r * 0.4], [-w * 1.1, -r * 0.4]], 0xf2c032);
    poly([[-w * 1.1, r * 0.88], [w * 1.1, r * 0.88], [w * 1.1, r * 0.98], [-w * 1.1, r * 0.98]], 0xf2c032);
    poly([[-r * 0.06, r * 0.98], [r * 0.06, r * 0.98], [r * 0.14, r * 1.3], [r * 0.02, r * 1.3]], 0xe08a3a);
}
