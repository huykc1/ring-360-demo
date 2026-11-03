import * as Phaser from 'phaser';

export const INK = '#3A2E26';
export const MUTED = '#8A7C6E';
export const ACCENT = 0xe8892b;
export const TEAL = 0x1f9d8f;
export const TEAL_CSS = '#1F9D8F';
export const CREAM = 0xfbf6ee;
export const FONT = 'Arial, Helvetica, sans-serif';

/** Soft cream card: a warm drop shadow, the face, and a thin light rim. */
export function softCard(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, fill = CREAM, pressed = false) {
    const dy = pressed ? 3 : 0;
    if (!pressed) g.fillStyle(0xd8c9b3, 0.55).fillRoundedRect(x, y + 7, w, h, r);
    g.fillStyle(0xe9dccb, 1).fillRoundedRect(x, y + dy + 2, w, h, r);
    g.fillStyle(fill, 1).fillRoundedRect(x, y + dy, w, h - 3, r);
    g.lineStyle(2, 0xffffff, 0.9).strokeRoundedRect(x + 1.5, y + dy + 1.5, w - 3, h - 6, r - 1);
}

/** Rounded button made of a Graphics background and a label; returns the container. */
export function button(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    opts: { fill?: number; color?: string; size?: number } = {}
) {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    const fill = opts.fill ?? CREAM;
    const draw = (pressed: boolean) => {
        g.clear();
        softCard(g, -w / 2, -h / 2, w, h, Math.min(28, h / 2), fill, pressed);
    };
    draw(false);
    const t = scene.add
        .text(0, 0, label, { fontFamily: FONT, fontSize: `${opts.size ?? 34}px`, color: opts.color ?? INK, fontStyle: 'bold' })
        .setOrigin(0.5);
    c.add([g, t]);
    c.setSize(w, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => draw(true));
    c.on('pointerout', () => draw(false));
    c.on('pointerup', () => {
        draw(false);
        onClick();
    });
    c.setData('label', t);
    return c;
}

/** Square soft button with a drawn icon (back chevron, restart arrow...). */
export function iconButton(scene: Phaser.Scene, x: number, y: number, size: number, icon: (g: Phaser.GameObjects.Graphics) => void, onClick: () => void) {
    const c = scene.add.container(x, y);
    const bg = scene.add.graphics();
    const ic = scene.add.graphics();
    const draw = (pressed: boolean) => {
        bg.clear();
        softCard(bg, -size / 2, -size / 2, size, size, size * 0.3, CREAM, pressed);
        ic.y = pressed ? 3 : 0;
    };
    draw(false);
    icon(ic);
    c.add([bg, ic]);
    c.setSize(size, size);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => draw(true));
    c.on('pointerout', () => draw(false));
    c.on('pointerup', () => {
        draw(false);
        onClick();
    });
    return c;
}

export function chevronLeft(g: Phaser.GameObjects.Graphics) {
    g.lineStyle(7, 0x3a2e26, 1);
    g.beginPath();
    g.moveTo(8, -16);
    g.lineTo(-8, 0);
    g.lineTo(8, 16);
    g.strokePath();
}

export function restartArrow(g: Phaser.GameObjects.Graphics) {
    g.lineStyle(6, 0x3a2e26, 1);
    g.beginPath();
    g.arc(0, 2, 17, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(230), false);
    g.strokePath();
    // Arrowhead at the open end of the arc.
    const a = Phaser.Math.DegToRad(-60);
    const ex = Math.cos(a) * 17;
    const ey = 2 + Math.sin(a) * 17;
    g.fillStyle(0x3a2e26, 1).fillTriangle(ex + 9, ey + 1, ex - 6, ey - 8, ex - 3, ey + 10);
}
