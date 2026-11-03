import * as Phaser from 'phaser';
import { TEAL } from './ui';

/**
 * Teal disc with a small cube and orbit arrows in the middle of the bottom panel: an anchor that tells
 * players where to drag to turn the cube. Dragging anywhere empty still works. The little cube turns
 * with the real one. Drawn in code until an art asset replaces it.
 */
export class RotatePad extends Phaser.GameObjects.Container {
    private cube: Phaser.GameObjects.Graphics;
    private front: Phaser.GameObjects.Graphics;
    private yaw = 0.6;

    constructor(scene: Phaser.Scene, x: number, y: number, readonly radius = 92) {
        super(scene, x, y);
        const R = radius;
        const disc = scene.add.graphics();
        disc.fillStyle(0x0e5f56, 0.25).fillCircle(0, 8, R + 2);
        disc.fillStyle(0x16857a, 1).fillCircle(0, 0, R);
        disc.fillStyle(TEAL, 1).fillCircle(0, -3, R - 5);
        disc.fillStyle(0x3fbcae, 0.35).fillEllipse(-R * 0.18, -R * 0.42, R * 1.1, R * 0.55);
        const back = scene.add.graphics();
        drawOrbits(back, R, 'back');
        this.cube = scene.add.graphics();
        this.front = scene.add.graphics();
        drawOrbits(this.front, R, 'front');
        this.add([disc, back, this.cube, this.front]);
        this.drawCube();
        this.setSize((R + 6) * 2, (R + 6) * 2);
        this.setInteractive(new Phaser.Geom.Circle(R + 6, R + 6, R + 6), Phaser.Geom.Circle.Contains);
        scene.add.existing(this);
        this.breathe();
    }

    /** Turns the little cube with the real one while the player orbits. */
    spin(dx: number) {
        this.yaw += dx * 0.012;
        this.drawCube();
    }

    press(down: boolean) {
        this.scene.tweens.killTweensOf(this);
        this.setScale(down ? 0.94 : 1);
        if (!down) this.breathe();
    }

    private breathe() {
        this.scene.tweens.add({ targets: this, scale: 1.03, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    /** A cream cube seen slightly from above, turned by `yaw`. */
    private drawCube() {
        const g = this.cube.clear();
        const s = this.radius * 0.36;
        const tilt = 0.5;
        const corners = [0, 1, 2, 3].map((k) => {
            const a = this.yaw + Math.PI / 4 + (k * Math.PI) / 2;
            return { x: Math.cos(a) * s * 1.2, y: Math.sin(a) * s * 1.2 * tilt };
        });
        const top = corners.map((c) => new Phaser.Math.Vector2(c.x, c.y - s * 0.75));
        const bottom = corners.map((c) => new Phaser.Math.Vector2(c.x, c.y + s * 0.85));
        // Side faces whose bottom edge is in front (larger y) are visible.
        const sides = [0, 1, 2, 3]
            .map((k) => ({ k, depth: corners[k].y + corners[(k + 1) % 4].y }))
            .filter((f) => f.depth > 0)
            .sort((a, b) => a.depth - b.depth);
        for (const { k } of sides) {
            const n = (k + 1) % 4;
            const shade = corners[k].x + corners[n].x < 0 ? 0xf3e7d4 : 0xdccab0;
            g.fillStyle(shade, 1).fillPoints([top[k], top[n], bottom[n], bottom[k]], true);
        }
        g.fillStyle(0xfdf8ef, 1).fillPoints(top, true);
        g.lineStyle(2, 0xc9b596, 0.6).strokePoints([...top, top[0]], false);
    }
}

/** Horizontal and vertical orbit arrows; the back half is drawn behind the cube, the front half over it. */
function drawOrbits(g: Phaser.GameObjects.Graphics, R: number, half: 'back' | 'front') {
    const rx = R * 0.78;
    const ry = R * 0.24;
    const arc = (fn: (t: number) => [number, number], from: number, to: number) => {
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
            const [x, y] = fn(from + ((to - from) * i) / 24);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
        }
        g.strokePath();
    };
    const head = (x: number, y: number, ang: number) => {
        const s = R * 0.16;
        const p = (d: number) => [x + Math.cos(ang + d) * s, y + Math.sin(ang + d) * s] as const;
        const [x1, y1] = p(Math.PI * 0.8);
        const [x2, y2] = p(-Math.PI * 0.8);
        g.fillTriangle(x + Math.cos(ang) * s * 0.3, y + Math.sin(ang) * s * 0.3, x1, y1, x2, y2);
    };
    g.lineStyle(6, 0xfdf6e8, half === 'back' ? 0.75 : 1);
    g.fillStyle(0xfdf6e8, 1);
    const horiz = (t: number): [number, number] => [Math.cos(t) * rx, Math.sin(t) * ry + R * 0.04];
    const vert = (t: number): [number, number] => [Math.sin(t) * ry, -Math.cos(t) * rx];
    if (half === 'back') {
        arc(horiz, Math.PI, Math.PI * 2);
        arc(vert, Math.PI, Math.PI * 2);
    } else {
        arc(horiz, 0.12, Math.PI - 0.12);
        arc(vert, 0.12, Math.PI - 0.12);
        head(rx, R * 0.04, Math.PI / 2 + 0.25);
        head(-rx, R * 0.04, -Math.PI / 2 - 0.25);
        head(0, -rx, 0.25);
        head(0, rx, Math.PI - 0.25);
    }
}
