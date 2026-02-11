import Phaser from "phaser";
import { ASSET_PATHS } from "../assets";
import { eventBus } from "../eventBus";

/**
 * Phase 1 — Critical assets only.
 * Loads placeholder + menu background, shows a small progress bar,
 * then immediately starts MenuScene + launches BackgroundLoaderScene
 * so remaining assets load while the player is on the menu.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    this.cameras.main.setBackgroundColor("#0a1026");

    const { width, height } = this.scale;
    const progressBox = this.add.graphics();
    const progressBar = this.add.graphics();
    const boxWidth = Math.max(300, width * 0.35);
    const boxHeight = 20;
    const boxX = (width - boxWidth) / 2;
    const boxY = height * 0.7;
    progressBox.fillStyle(0x111827, 0.8);
    progressBox.fillRect(boxX, boxY, boxWidth, boxHeight);

    this.load.on("progress", (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x38bdf8, 1);
      progressBar.fillRect(boxX + 2, boxY + 2, (boxWidth - 4) * value, boxHeight - 4);
    });

    this.load.on("complete", () => {
      progressBar.destroy();
      progressBox.destroy();
    });

    // Only critical assets — everything else loads in BackgroundLoaderScene
    this.load.image("placeholder", ASSET_PATHS.placeholder);
    this.load.image("menu_bg", ASSET_PATHS.menuBackground);
  }

  create() {
    // Menu is ready immediately
    eventBus.emit("phaser:ready");
    this.scene.start("MenuScene");

    // Launch background asset loader in parallel (doesn't block MenuScene)
    this.scene.launch("BackgroundLoaderScene");
  }
}
