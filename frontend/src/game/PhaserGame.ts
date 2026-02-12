import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { BackgroundLoaderScene } from "./scenes/BackgroundLoaderScene";

export class PhaserGame {
  private game: Phaser.Game;
  private rafId = 0;

  constructor(parentId: string) {
    // Use the device's native pixel ratio (cap at 3 for GPU sanity on ultra-high-DPI).
    // This is the single most important setting for sharp rendering on retina screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      backgroundColor: "#0a1026",
      width: window.innerWidth,
      height: window.innerHeight,
      // `resolution` tells Phaser to create the canvas drawing buffer at
      // width*dpr × height*dpr, then CSS-display it at width × height.
      // This is what makes the image crisp on retina / mobile screens.
      resolution: dpr,
      render: {
        antialias: true,
        antialiasGL: true,
        pixelArt: false,
        roundPixels: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: parentId
      },
      scene: [BootScene, MenuScene, BattleScene, BackgroundLoaderScene]
    });

    // Debounced resize via requestAnimationFrame — prevents layout thrashing
    // on rapid resize/orientation events (especially iOS Safari toolbar show/hide).
    const scheduleResize = () => {
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => {
        this.game.scale.resize(window.innerWidth, window.innerHeight);
      });
    };

    window.addEventListener("resize", scheduleResize);

    // iOS Safari needs a short delay after orientationchange to report correct dimensions.
    window.addEventListener("orientationchange", () => {
      setTimeout(scheduleResize, 150);
    });
  }

  showMenu() {
    if (this.game.scene.isActive("BattleScene")) {
      this.game.scene.stop("BattleScene");
    }
    this.game.scene.start("MenuScene");
  }

  startBattle(payload: {
    playerLineup: string[];
    opponentLineup: Array<{ id: string; hero: string; upgrades: { piercingLevel: number } }>;
    rounds: Array<{ playerHero: string; opponentHero: string; result: "win" | "lose" }>;
    result: "win" | "lose";
    weatherKey: string;
  }) {
    if (this.game.scene.isActive("MenuScene")) {
      this.game.scene.stop("MenuScene");
    }
    this.game.scene.start("BattleScene", payload);
  }
}
