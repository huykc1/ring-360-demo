import * as Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Menu } from './scenes/Menu';
import { Play } from './scenes/Play';
import { shared } from './game/shared';
import { CubeView } from './view/CubeView';

// The cube is drawn by Three.js in #cube-layer; Phaser draws the HUD on a transparent canvas above it
// and receives all input. The layer is kept on top of the Phaser canvas's rectangle.
const layer = document.getElementById('cube-layer')!;
shared.view = new CubeView(layer);

// Portrait phone: 390x844 points rendered at 2x for crisp text.
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    title: 'Ring 360',
    transparent: true,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: 'game-container',
        width: 780,
        height: 1688
    },
    scene: [Boot, Menu, Play]
};

const game = new Phaser.Game(config);

function syncLayer() {
    const r = game.canvas?.getBoundingClientRect();
    if (!r) return;
    Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}
game.events.once('ready', syncLayer);
game.scale.on('resize', () => requestAnimationFrame(syncLayer));
window.addEventListener('resize', () => requestAnimationFrame(syncLayer));
setInterval(syncLayer, 1000);

if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;

export default game;
