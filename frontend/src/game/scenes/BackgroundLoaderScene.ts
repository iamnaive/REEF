import Phaser from "phaser";
import { ASSET_PATHS, HERO_POSES, WEATHER_BACKGROUNDS } from "../assets";
import { HEROES } from "@shared/types";
import { eventBus } from "../eventBus";

/**
 * Runs in parallel with MenuScene.
 * Loads all battle-related assets (hero poses, weather backgrounds,
 * banners, UI icons) in the background so the player can interact
 * with the menu / prematch immediately.
 *
 * Emits:
 *   "phaser:bg-progress" (value: number 0-1) — loading progress
 *   "phaser:assets-ready"                    — all assets loaded
 */
export class BackgroundLoaderScene extends Phaser.Scene {
  constructor() {
    super("BackgroundLoaderScene");
  }

  preload() {
    // HUD / UI elements used in Phaser scenes
    this.loadIfMissing("hud_top", ASSET_PATHS.hudTop);
    this.loadIfMissing("hud_bar", ASSET_PATHS.hudBar);
    this.loadIfMissing("hero_avatar_frame", ASSET_PATHS.heroAvatarFrame);
    this.loadIfMissing("button_start", ASSET_PATHS.buttonStart);
    this.loadIfMissing("button_menu", ASSET_PATHS.buttonMenu);
    this.loadIfMissing("modal_generic", ASSET_PATHS.modalGeneric);
    this.loadIfMissing("modal_reward", ASSET_PATHS.modalReward);
    this.loadIfMissing("icon_back", ASSET_PATHS.iconBack);
    this.loadIfMissing("icon_chest", ASSET_PATHS.iconChest);
    this.loadIfMissing("icon_home", ASSET_PATHS.iconHome);
    this.loadIfMissing("icon_sound", ASSET_PATHS.iconSound);
    this.loadIfMissing("icon_settings", ASSET_PATHS.iconSettings);

    // Weather backgrounds
    for (const [key, path] of Object.entries(WEATHER_BACKGROUNDS)) {
      this.loadIfMissing(key, path);
    }

    // Hero poses (6 poses × 3 heroes = 18 images)
    for (const hero of HEROES) {
      const poses = HERO_POSES[hero];
      poses.forEach((posePath, index) => {
        const key = `${hero}_pose_${index + 1}`;
        this.loadIfMissing(key, posePath);
      });
    }

    // Report progress to React
    this.load.on("progress", (value: number) => {
      eventBus.emit("phaser:bg-progress", value);
    });
  }

  create() {
    eventBus.emit("phaser:assets-ready");
    // This scene's job is done — stop it so it doesn't consume resources
    this.scene.stop();
  }

  /** Only queue a load if the texture isn't already cached */
  private loadIfMissing(key: string, path: string) {
    if (!this.textures.exists(key)) {
      this.load.image(key, path);
    }
  }
}
