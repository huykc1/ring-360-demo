import * as Phaser from 'phaser';
import { loadIndex, shared } from '../game/shared';
import { normalizeLevel } from '../core/types';
import { FONT, MUTED } from './ui';

/** Loads the level list, or in embed mode waits for the editor to send a level. */
export class Boot extends Phaser.Scene {
    constructor() {
        super('Boot');
    }

    async create() {
        if (!shared.embedded) {
            await loadIndex();
            this.scene.start('Menu');
            return;
        }
        const { width, height } = this.scale;
        this.add.text(width / 2, height / 2, 'Waiting for the editor…', { fontFamily: FONT, fontSize: '30px', color: MUTED }).setOrigin(0.5);
        window.addEventListener('message', (e: MessageEvent) => {
            const data = e.data as { type?: string; level?: unknown };
            if (data?.type === 'ring360:play' && data.level) {
                this.game.scene.getScenes(true).forEach((s) => s.scene.stop());
                this.scene.start('Play', { level: normalizeLevel(data.level as never), index: -1 });
            }
        });
        window.parent.postMessage({ type: 'ring360:ready' }, '*');
    }
}
