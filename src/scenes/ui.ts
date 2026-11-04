import * as Phaser from 'phaser';
import { settings } from '../game/settings';

export const ACCENT = 0xe8892b;
export const TEAL = 0x1f9d8f;
export const TEAL_CSS = '#1F9D8F';
export const FONT = 'Arial, Helvetica, sans-serif';

const LIGHT = {
    bg: '#F7F0E6',
    ink: '#3A2E26',
    inkHex: 0x3a2e26,
    muted: '#8A7C6E',
    card: 0xfbf6ee,
    cardEdge: 0xe9dccb,
    shadow: 0xd8c9b3,
    shadowAlpha: 0.55,
    rim: 0xffffff,
    rimAlpha: 0.9,
    track: 0xeadfce,
    switchOff: 0xd9cdbb,
    shade: 0xf4eee4
};

const DARK: typeof LIGHT = {
    bg: '#141B2E',
    ink: '#F5EEE3',
    inkHex: 0xf5eee3,
    muted: '#8FA3C0',
    card: 0x2b3654,
    cardEdge: 0x1d2640,
    shadow: 0x060a16,
    shadowAlpha: 0.6,
    rim: 0x3d4a6c,
    rimAlpha: 0.9,
    track: 0x232d48,
    switchOff: 0x4a577c,
    shade: 0x141b2e
};

/** Current colours. Scenes read them when they build their UI and rebuild when the theme changes. */
export const T = { ...LIGHT };

/** Applies the game theme from settings, page background included. */
export function applyTheme() {
    Object.assign(T, settings.darkGame ? DARK : LIGHT);
    document.body.style.background = T.bg;
    document.documentElement.style.background = T.bg;
}
applyTheme();

/** Soft card: a drop shadow, the face, and a thin rim. */
export function softCard(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, fill = T.card, pressed = false) {
    const dy = pressed ? 3 : 0;
    if (!pressed) g.fillStyle(T.shadow, T.shadowAlpha).fillRoundedRect(x, y + 7, w, h, r);
    g.fillStyle(T.cardEdge, 1).fillRoundedRect(x, y + dy + 2, w, h, r);
    g.fillStyle(fill, 1).fillRoundedRect(x, y + dy, w, h - 3, r);
    g.lineStyle(2, T.rim, T.rimAlpha).strokeRoundedRect(x + 1.5, y + dy + 1.5, w - 3, h - 6, r - 1);
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
    const fill = opts.fill ?? T.card;
    const draw = (pressed: boolean) => {
        g.clear();
        softCard(g, -w / 2, -h / 2, w, h, Math.min(28, h / 2), fill, pressed);
    };
    draw(false);
    const t = scene.add
        .text(0, 0, label, { fontFamily: FONT, fontSize: `${opts.size ?? 34}px`, color: opts.color ?? T.ink, fontStyle: 'bold' })
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
        softCard(bg, -size / 2, -size / 2, size, size, size * 0.3, T.card, pressed);
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
    g.lineStyle(7, T.inkHex, 1);
    g.beginPath();
    g.moveTo(8, -16);
    g.lineTo(-8, 0);
    g.lineTo(8, 16);
    g.strokePath();
}

export function restartArrow(g: Phaser.GameObjects.Graphics) {
    g.lineStyle(6, T.inkHex, 1);
    g.beginPath();
    g.arc(0, 2, 17, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(230), false);
    g.strokePath();
    // Arrowhead at the open end of the arc.
    const a = Phaser.Math.DegToRad(-60);
    const ex = Math.cos(a) * 17;
    const ey = 2 + Math.sin(a) * 17;
    g.fillStyle(T.inkHex, 1).fillTriangle(ex + 9, ey + 1, ex - 6, ey - 8, ex - 3, ey + 10);
}

export function gearIcon(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(T.inkHex, 1);
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const p = (r: number, d: number) => new Phaser.Math.Vector2(Math.cos(a + d) * r, Math.sin(a + d) * r);
        g.fillPoints([p(13, -0.22), p(21, -0.17), p(21, 0.17), p(13, 0.22)], true);
    }
    g.fillCircle(0, 0, 15);
    g.fillStyle(T.card, 1).fillCircle(0, 0, 6.5);
}

/** On/off switch drawn as a pill with a knob; teal when on. */
export function toggle(scene: Phaser.Scene, x: number, y: number, on: boolean, onChange: (on: boolean) => void) {
    const w = 104;
    const h = 56;
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    let state = on;
    const draw = () => {
        g.clear();
        g.fillStyle(state ? TEAL : T.switchOff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        g.fillStyle(0x000000, 0.18).fillCircle(state ? w / 2 - h / 2 : -w / 2 + h / 2, 3, h / 2 - 6);
        g.fillStyle(0xffffff, 1).fillCircle(state ? w / 2 - h / 2 : -w / 2 + h / 2, 0, h / 2 - 6);
    };
    draw();
    c.add(g);
    c.setSize(w, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerup', () => {
        state = !state;
        draw();
        onChange(state);
    });
    return c;
}

/**
 * Settings dialog with three switches: game dark theme, rotate from anywhere, editor dark theme.
 * `onTheme` runs when the game theme changes so the caller can rebuild its UI.
 */
export function openSettings(scene: Phaser.Scene, onTheme: () => void, onClose?: () => void) {
    const { width, height } = scene.scale;
    const layer = scene.add.container(0, 0).setDepth(1000);
    const shade = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.45).setInteractive();
    const panelW = 640;
    const panelH = 560;
    const top = height / 2 - panelH / 2;
    const panel = scene.add.graphics();
    softCard(panel, width / 2 - panelW / 2, top, panelW, panelH, 48);
    const title = scene.add.text(width / 2 - panelW / 2 + 48, top + 64, 'Settings', { fontFamily: FONT, fontSize: '48px', color: T.ink, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const close = () => {
        layer.destroy();
        onClose?.();
    };
    const closeBtn = iconButton(scene, width / 2 + panelW / 2 - 70, top + 64, 76, (g) => {
        g.lineStyle(6, T.inkHex, 1).lineBetween(-12, -12, 12, 12).lineBetween(12, -12, -12, 12);
    }, close);
    layer.add([shade, panel, title, closeBtn]);
    const rows: [string, string, boolean, (on: boolean) => void][] = [
        ['Dark theme', 'Game colours', settings.darkGame, (on) => {
            settings.darkGame = on;
            applyTheme();
            close();
            onTheme();
        }],
        ['Rotate from anywhere', 'OFF: turn the cube only from the button at the bottom', settings.rotateAnywhere, (on) => (settings.rotateAnywhere = on)],
        ['Editor dark theme', 'Level editor colours', settings.darkEditor, (on) => (settings.darkEditor = on)]
    ];
    rows.forEach(([label, hint, on, change], i) => {
        const y = top + 190 + i * 140;
        const l = scene.add.text(width / 2 - panelW / 2 + 48, y - 18, label, { fontFamily: FONT, fontSize: '34px', color: T.ink, fontStyle: 'bold' }).setOrigin(0, 0.5);
        const hText = scene.add
            .text(width / 2 - panelW / 2 + 48, y + 26, hint, { fontFamily: FONT, fontSize: '22px', color: T.muted, wordWrap: { width: panelW - 230 } })
            .setOrigin(0, 0.5);
        const sw = toggle(scene, width / 2 + panelW / 2 - 100, y, on, change);
        layer.add([l, hText, sw]);
        if (i < rows.length - 1) {
            const sep = scene.add.rectangle(width / 2, y + 70, panelW - 96, 2, T.track, 1);
            layer.add(sep);
        }
    });
    return layer;
}

