import Phaser from "phaser";

export class MenuScene extends Phaser.Scene {
  private bg?: Phaser.GameObjects.Image;
  private resizeHandler?: () => void;

  constructor() {
    super("MenuScene");
  }

  create() {
    const key = this.textures.exists("menu_bg") ? "menu_bg" : "placeholder";
    const bg = this.add.image(0, 0, key);
    this.bg = bg;
    this.updateBackground();

    this.resizeHandler = () => {
      this.updateBackground();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
  }

  shutdown() {
    if (this.resizeHandler) {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHandler);
      this.resizeHandler = undefined;
    }
  }

  private updateBackground() {
    if (!this.bg) return;
    const width = this.scale.width || this.game.scale.width;
    const height = this.scale.height || this.game.scale.height;
    this.bg.setPosition(width / 2, height / 2);
    this.bg.setDisplaySize(width, height);
  }
}
