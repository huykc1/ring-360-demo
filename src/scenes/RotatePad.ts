import * as Phaser from 'phaser';

/**
 * Globe with arrows at the bottom of the play screen: an anchor that tells players where to drag to turn
 * the cube. Dragging anywhere empty still works; this only gives the thumb a home. Drawn in code until an
 * art asset replaces it.
 */
export class RotatePad extends Phaser.GameObjects.Container {
    private globe: Phaser.GameObjects.Graphics;
    private phase = 0;

    constructor(scene: Phaser.Scene, x: number, y: number, readonly radius = 72) {
        super(scene, x, y);
        const R = radius;
        const bezel = scene.add.graphics();
        bezel.fillStyle(0x000000, 0.1).fillCircle(0, 6, R + 18);
        bezel.fillStyle(0xf4f4f6, 1).fillCircle(0, 0, R + 16);
        bezel.lineStyle(3, 0xd9d9e0, 1).strokeCircle(0, 0, R + 16);
        bezel.fillStyle(0xc9ced8, 1).fillCircle(0, 0, R + 4);
        this.globe = scene.add.graphics();
        const arrows = scene.add.graphics();
        drawArrows(arrows, R);
        this.add([bezel, this.globe, arrows]);
        this.drawGlobe();
        this.setSize((R + 18) * 2, (R + 18) * 2);
        this.setInteractive(new Phaser.Geom.Circle(R + 18, R + 18, R + 18), Phaser.Geom.Circle.Contains);
        scene.add.existing(this);
        // A slow breathing pulse so the pad reads as touchable.
        scene.tweens.add({ targets: this, scale: 1.04, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    /** Turns the globe's meridians with the cube while the player orbits. */
    spin(dx: number) {
        this.phase += dx * 0.012;
        this.drawGlobe();
    }

    press(down: boolean) {
        this.scene.tweens.killTweensOf(this);
        this.setScale(down ? 0.93 : 1);
        if (!down) this.scene.tweens.add({ targets: this, scale: 1.04, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    private drawGlobe() {
        const g = this.globe;
        const R = this.radius;
        g.clear();
        g.fillStyle(0x1f78d6, 1).fillCircle(0, 0, R);
        g.fillStyle(0x4fb0ff, 0.55).fillCircle(-R * 0.12, -R * 0.12, R * 0.82);
        g.lineStyle(2, 0xbfe3ff, 0.7);
        // Latitudes.
        for (const k of [-0.6, -0.3, 0, 0.3, 0.6]) {
            const y = R * k;
            const w = Math.sqrt(R * R - y * y);
            g.lineBetween(-w, y, w, y);
        }
        // Meridians, shifted by `phase` so the globe seems to turn.
        for (let i = 0; i < 4; i++) {
            const w = Math.abs(Math.cos(this.phase + (i * Math.PI) / 4)) * R;
            if (w > 2) g.strokeEllipse(0, 0, w * 2, R * 2);
        }
        g.fillStyle(0xffffff, 0.35).fillEllipse(-R * 0.35, -R * 0.45, R * 0.75, R * 0.4);
    }
}

function drawArrows(g: Phaser.GameObjects.Graphics, R: number) {
    const curve = (fn: (t: number) => [number, number]) => {
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
            const [x, y] = fn((i / 24) * Math.PI);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
        }
        g.strokePath();
    };
    const head = (x: number, y: number, ang: number) => {
        const s = R * 0.2;
        const a = (d: number) => [x + Math.cos(ang + d) * s, y + Math.sin(ang + d) * s] as const;
        const [x1, y1] = a(Math.PI * 0.82);
        const [x2, y2] = a(-Math.PI * 0.82);
        g.fillTriangle(x + Math.cos(ang) * s * 0.35, y + Math.sin(ang) * s * 0.35, x1, y1, x2, y2);
    };
    const reach = R * 1.08;
    for (const [color, width] of [[0x0d4f9c, 11], [0xffffff, 7]] as const) {
        g.lineStyle(width, color, color === 0xffffff ? 1 : 0.35);
        g.fillStyle(color, color === 0xffffff ? 1 : 0.35);
        curve((t) => [-reach * Math.cos(t), R * 0.16 * Math.sin(t)]);
        curve((t) => [R * 0.18 * Math.sin(t), -reach * Math.cos(t)]);
        head(-reach, 0, Math.PI);
        head(reach, 0, 0);
        head(0, -reach, -Math.PI / 2);
        head(0, reach, Math.PI / 2);
    }
}
