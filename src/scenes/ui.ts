import * as Phaser from 'phaser';

export const INK = '#2A2520';
export const MUTED = '#7a7166';
export const ACCENT = 0xe8892b;
export const FONT = 'Arial, Helvetica, sans-serif';

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
    const fill = opts.fill ?? 0xffffff;
    const draw = (pressed: boolean) => {
        g.clear();
        g.fillStyle(0x000000, 0.08);
        g.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, 18);
        g.fillStyle(fill, 1);
        g.fillRoundedRect(-w / 2, -h / 2 + (pressed ? 3 : 0), w, h, 18);
        if (fill === 0xffffff) {
            g.lineStyle(2, 0xd2c9bc, 1);
            g.strokeRoundedRect(-w / 2, -h / 2 + (pressed ? 3 : 0), w, h, 18);
        }
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
