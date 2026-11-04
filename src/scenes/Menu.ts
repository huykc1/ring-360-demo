import * as Phaser from 'phaser';
import { loadIndex, loadLevel, shared } from '../game/shared';
import { normalizeLevel, type Level } from '../core/types';
import { button, FONT, gearIcon, iconButton, openSettings, T } from './ui';

const DIFF_COLOR: Record<string, number> = { normal: 0x4fcb9a, hard: 0xefb227, super_hard: 0xe8674a };

/** Level select. */
export class Menu extends Phaser.Scene {
    private list?: Phaser.GameObjects.Container;
    private listTop = 330;
    private scroll = 0;

    constructor() {
        super('Menu');
    }

    async create() {
        const { width, height } = this.scale;
        shared.view?.container.style.setProperty('visibility', 'hidden');
        this.add.text(width / 2, 150, 'Ring 360', { fontFamily: FONT, fontSize: '84px', color: T.ink, fontStyle: 'bold' }).setOrigin(0.5);
        this.add.text(width / 2, 230, 'Untangle the rings on every face of the cube', { fontFamily: FONT, fontSize: '28px', color: T.muted }).setOrigin(0.5);
        this.add.text(width - 24, height - 30, __APP_VERSION__, { fontFamily: FONT, fontSize: '22px', color: T.muted }).setOrigin(1, 0.5);

        button(this, width / 2, height - 110, 420, 84, 'Open level file…', () => this.openFile(), { size: 30 });
        iconButton(this, width - 80, 80, 88, gearIcon, () => openSettings(this, () => this.scene.restart()));

        const levels = shared.levels.length ? shared.levels : await loadIndex();
        this.list = this.add.container(0, this.listTop);
        const cardH = 120;
        levels.forEach((lv, i) => {
            const y = i * (cardH + 18) + cardH / 2;
            const card = button(this, width / 2, y, 660, cardH, '', async () => {
                if (this.dragged) return;
                const level = await loadLevel(lv);
                this.scene.start('Play', { level, index: i });
            });
            const label = card.getData('label') as Phaser.GameObjects.Text;
            label.setText(`${String(i + 1).padStart(2, '0')}   ${lv.name}`).setFontSize(34).setX(-300).setOrigin(0, 0.5);
            const dot = this.add.circle(280, 0, 14, DIFF_COLOR[lv.difficulty] ?? 0xcccccc);
            const diff = this.add.text(256, 0, lv.difficulty.replace('_', ' '), { fontFamily: FONT, fontSize: '24px', color: T.muted }).setOrigin(1, 0.5);
            card.add([dot, diff]);
            this.list!.add(card);
        });
        if (!levels.length) {
            this.add.text(width / 2, 500, 'No bundled levels yet', { fontFamily: FONT, fontSize: '30px', color: T.muted }).setOrigin(0.5);
        }

        // Drag to scroll the list.
        const maxScroll = Math.max(0, levels.length * (cardH + 18) - (height - 220 - this.listTop));
        let startY = 0;
        let startScroll = 0;
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            startY = p.y;
            startScroll = this.scroll;
            this.dragged = false;
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (!p.isDown) return;
            if (Math.abs(p.y - startY) > 12) this.dragged = true;
            this.scroll = Phaser.Math.Clamp(startScroll - (p.y - startY), 0, maxScroll);
            this.list!.y = this.listTop - this.scroll;
        });
        this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
            this.scroll = Phaser.Math.Clamp(this.scroll + dy, 0, maxScroll);
            this.list!.y = this.listTop - this.scroll;
        });
    }

    private dragged = false;

    private openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const level: Level = normalizeLevel(JSON.parse(await file.text()));
                this.scene.start('Play', { level, index: -1 });
            } catch {
                window.alert('That file is not a Ring 360 level.');
            }
        };
        input.click();
    }
}
