import Phaser from "phaser";
import { eventBus } from "../eventBus";
import { DEFAULT_TUNING, VisualTuning } from "../tuning";
import { fadeOutSfx, playSfx, playRandomKnock } from "../sounds";

type BattleData = {
  playerLineup: string[];
  opponentLineup: Array<{ id: string; hero: string; upgrades: { piercingLevel: number } }>;
  rounds: Array<{ playerHero: string; opponentHero: string; result: "win" | "lose" }>;
  result: "win" | "lose";
  weatherKey: string;
};

/**
 * Pose guide:
 *  1 = base (idle)
 *  2 = anticipation (ready)
 *  3 = fly (moving)
 *  4 = strike (attack)
 *  5 = win
 *  6 = lose
 */

export class BattleScene extends Phaser.Scene {
  private dataPayload?: BattleData;
  private playerSprites: Phaser.GameObjects.Image[] = [];
  private opponentSprites: Phaser.GameObjects.Image[] = [];
  private tuning: VisualTuning = DEFAULT_TUNING;
  private bg?: Phaser.GameObjects.Image;
  private resizeHandler?: () => void;

  constructor() {
    super("BattleScene");
  }

  init(data: BattleData) {
    this.dataPayload = data;
  }

  /* ───────── helpers ───────── */

  private norm(hero: string): string {
    if (!hero) return hero;
    return hero.charAt(0).toUpperCase() + hero.slice(1).toLowerCase();
  }

  private resolveKey(key: string): string {
    return this.textures.exists(key) ? key : "placeholder";
  }

  private pose(sprite: Phaser.GameObjects.Image, hero: string, p: number) {
    sprite.setTexture(this.resolveKey(`${this.norm(hero)}_pose_${p}`));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => this.time.delayedCall(ms, r));
  }

  private getViewportScale() {
    const w = this.scale.width || this.game.scale.width;
    const h = this.scale.height || this.game.scale.height;
    const base = Math.min(w, h);
    return Phaser.Math.Clamp(base / 900, 0.78, 1.08);
  }

  /** Show BANG text + smoke clouds at a given position */
  private showImpact(x: number, y: number) {
    const s = this.getViewportScale();
    const bangSize = Math.round(72 * s);
    const stroke = Math.max(4, Math.round(8 * s));

    // ── BANG text ──
    const bang = this.add.text(x, y, "BANG!", {
      fontFamily: '"Montserrat", sans-serif',
      fontSize: `${bangSize}px`,
      fontStyle: "bold",
      color: "#ffe040",
      stroke: "#a83200",
      strokeThickness: stroke,
      shadow: { offsetX: 3, offsetY: 3, color: "rgba(0,0,0,0.5)", blur: 6, fill: true }
    });
    bang.setOrigin(0.5, 0.5);
    bang.setScale(0.2);
    bang.setAlpha(1);
    bang.setDepth(100);

    this.tweens.add({
      targets: bang,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 600,
      ease: "Power2",
      onComplete: () => bang.destroy()
    });

    // ── Smoke clouds ──
    const smokeCount = Math.max(6, Math.round(8 * s));
    for (let i = 0; i < smokeCount; i++) {
      const angle = (Math.PI * 2 * i) / smokeCount + (Math.random() - 0.5) * 0.5;
      const dist = (80 + Math.random() * 100) * s;
      const size = (20 + Math.random() * 30) * s;

      const cloud = this.add.circle(x, y, size, 0xcccccc, 0.7);
      cloud.setDepth(99);

      this.tweens.add({
        targets: cloud,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        scaleX: 1.8 + Math.random(),
        scaleY: 1.8 + Math.random(),
        alpha: 0,
        duration: 400 + Math.random() * 300,
        ease: "Power2",
        onComplete: () => cloud.destroy()
      });
    }

    // ── Extra small sparks ──
    const sparkCount = Math.max(4, Math.round(6 * s));
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (60 + Math.random() * 80) * s;
      const sz = (4 + Math.random() * 6) * s;

      const spark = this.add.circle(x, y, sz, 0xffee88, 0.9);
      spark.setDepth(101);

      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 300 + Math.random() * 200,
        ease: "Power3",
        onComplete: () => spark.destroy()
      });
    }
  }

  /** Emit a small burst of golden stars above the round winner */
  private showWinStars(x: number, y: number) {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const star = this.add.star(
        x + Phaser.Math.Between(-14, 14),
        y - Phaser.Math.Between(30, 55),
        5,
        3.5,
        7.5,
        0xffd166,
        0.95
      );
      star.setDepth(104);
      star.setStrokeStyle(1, 0xfff2b3, 0.9);
      star.setAngle(Phaser.Math.Between(-35, 35));

      this.tweens.add({
        targets: star,
        x: star.x + Phaser.Math.Between(-40, 40),
        y: star.y - Phaser.Math.Between(30, 80),
        angle: star.angle + Phaser.Math.Between(-120, 120),
        scaleX: Phaser.Math.FloatBetween(0.4, 0.85),
        scaleY: Phaser.Math.FloatBetween(0.4, 0.85),
        alpha: 0,
        duration: Phaser.Math.Between(520, 820),
        ease: "Cubic.easeOut",
        onComplete: () => star.destroy()
      });
    }
  }

  /** Simple tween — no pose changes */
  private moveTo(
    sprite: Phaser.GameObjects.Image,
    to: { x: number; y: number },
    duration: number,
    ease = "Power2"
  ): Promise<void> {
    return new Promise((r) =>
      this.tweens.add({ targets: sprite, x: to.x, y: to.y, duration, ease, onComplete: () => r() })
    );
  }

  /** Tween arbitrary props */
  private tweenProps(
    target: Phaser.GameObjects.Image,
    props: Record<string, number>,
    duration: number,
    ease = "Power2"
  ): Promise<void> {
    return new Promise((r) =>
      this.tweens.add({ targets: target, ...props, duration, ease, onComplete: () => r() })
    );
  }

  /**
   * Fly from current position to `to`.
   * During flight the sprite is in pose 3 (fly).
   * At 75 % of the path it switches to pose 4 (strike).
   * Does NOT set end pose — caller does that.
   */
  private flyTo(
    sprite: Phaser.GameObjects.Image,
    hero: string,
    to: { x: number; y: number },
    duration: number
  ): Promise<void> {
    this.pose(sprite, hero, 3); // fly immediately
    let strikeSet = false;
    return new Promise((r) =>
      this.tweens.add({
        targets: sprite,
        x: to.x,
        y: to.y,
        duration,
        ease: "Power2",
        onUpdate: (_tw: Phaser.Tweens.Tween) => {
          const progress = _tw.progress;
          if (!strikeSet && progress >= 0.75) {
            strikeSet = true;
            this.pose(sprite, hero, 4);
          }
        },
        onComplete: () => r()
      })
    );
  }

  /* ───────── layout ───────── */

  private getLayout() {
    const w = this.scale.width || this.game.scale.width;
    const h = this.scale.height || this.game.scale.height;
    const s = this.getViewportScale();
    const compactLandscape = h < 560;
    return {
      width: w,
      height: h,
      groundY: compactLandscape ? h * 0.64 : h * 0.68,
      // starting (home) positions
      playerHomeX: compactLandscape ? w * 0.24 : w * 0.2,
      opponentHomeX: compactLandscape ? w * 0.76 : w * 0.8,
      // clash positions (near center)
      playerClashX: w * 0.44,
      opponentClashX: w * 0.56,
      // corners for losers
      playerCornerX: w * 0.06,
      opponentCornerX: w * 0.94,
      cornerY: compactLandscape ? h * 0.8 : h * 0.85,
      heroHeight: this.tuning.heroHeight * s * 0.8,
      offscreenX: Math.round(220 * s),
      defeatedStackStep: Math.round(54 * s)
    };
  }

  /* ───────── create ───────── */

  create() {
    if (!this.dataPayload) return;
    const { playerLineup, opponentLineup, rounds } = this.dataPayload;
    const weatherKey = this.dataPayload.weatherKey;

    // Background
    const bgKey = this.textures.exists(weatherKey) ? weatherKey : "placeholder";
    this.bg = this.add.image(0, 0, bgKey);
    this.updateBackground();

    const layout = this.getLayout();

    const scaleToHeight = (sprite: Phaser.GameObjects.Image, h: number) => {
      sprite.setScale(h / (sprite.height || 1));
    };

    // Create ALL sprites but keep them invisible + off-screen
    this.playerSprites = playerLineup.map((hero) => {
      const sprite = this.add.image(-layout.offscreenX, layout.groundY, this.resolveKey(`${this.norm(hero)}_pose_1`));
      sprite.setFlipX(true);
      scaleToHeight(sprite, layout.heroHeight);
      sprite.setAlpha(0);
      return sprite;
    });

    this.opponentSprites = opponentLineup.map((opp) => {
      const sprite = this.add.image(layout.width + layout.offscreenX, layout.groundY, this.resolveKey(`${this.norm(opp.hero)}_pose_1`));
      scaleToHeight(sprite, layout.heroHeight);
      sprite.setAlpha(0);
      return sprite;
    });

    /* ── main battle loop ── */
    const runBattle = async () => {
      playSfx("matchStart");
      let pIdx = 0; // current player hero index
      let oIdx = 0; // current opponent hero index
      let pLosses = 0; // how many player heroes lost (for stacking offset)
      let oLosses = 0; // how many opponent heroes lost

      for (let r = 0; r < rounds.length; r++) {
        if (pIdx >= playerLineup.length || oIdx >= opponentLineup.length) break;
        playSfx("roundStart");

        const round = rounds[r];
        const pHero = this.norm(playerLineup[pIdx]);
        const oHero = this.norm(opponentLineup[oIdx]?.hero || "Shark");
        const pSpr = this.playerSprites[pIdx];
        const oSpr = this.opponentSprites[oIdx];

        /* ─ 1) Bring fighters to home positions ─ */
        if (r === 0) {
          // First round — just place them at home
          pSpr.setPosition(layout.playerHomeX, layout.groundY);
          pSpr.setAlpha(1);
          this.pose(pSpr, pHero, 1);

          oSpr.setPosition(layout.opponentHomeX, layout.groundY);
          oSpr.setAlpha(1);
          this.pose(oSpr, oHero, 1);
        }
        // (For later rounds the new hero was already flown in at the end of the previous round)

        /* ─ 2) Pause in base pose ─ */
        await this.wait(200);

        /* ─ 3) Anticipation pose ─ */
        this.pose(pSpr, pHero, 2);
        this.pose(oSpr, oHero, 2);
        await this.wait(250);

        /* ─ 4) Fly to clash point (pose 3 → 4 at 75 %) ─ */
        playSfx("heroFly");
        await Promise.all([
          this.flyTo(pSpr, pHero, { x: layout.playerClashX, y: layout.groundY }, 600),
          this.flyTo(oSpr, oHero, { x: layout.opponentClashX, y: layout.groundY }, 600)
        ]);

        /* ─ 4.5) Impact effect! ─ */
        const impactX = (layout.playerClashX + layout.opponentClashX) / 2;
        this.showImpact(impactX, layout.groundY);
        playSfx("impact");
        playRandomKnock();

        /* ─ 5) Result pose ─ */
        const pWins = round.result === "win";
        this.pose(pSpr, pHero, pWins ? 5 : 6);
        this.pose(oSpr, oHero, pWins ? 6 : 5);
        playSfx(pWins ? "roundWin" : "roundLose");
        const winner = pWins ? pSpr : oSpr;
        this.showWinStars(winner.x, winner.y);

        /* ─ 6) Hold result ─ */
        await this.wait(375);

        /* ─ 7) Loser flies to THEIR corner, winner returns home ─ */
        if (pWins) {
          // Opponent lost → flies to opponent (right) corner in lose pose
          playSfx("heroDefeated");
          const sc = oSpr.scaleX;
          const oCornerX = layout.opponentCornerX - oLosses * layout.defeatedStackStep;
          await Promise.all([
            this.tweenProps(oSpr, { scaleX: sc * 0.7, scaleY: sc * 0.7 }, 600),
            this.moveTo(oSpr, { x: oCornerX, y: layout.cornerY }, 700)
          ]);
          oLosses++;
          oIdx++;

          // Winner returns home in base pose
          this.pose(pSpr, pHero, 1);
          await this.moveTo(pSpr, { x: layout.playerHomeX, y: layout.groundY }, 400);

          // Next opponent enters from off-screen (if any)
          if (oIdx < opponentLineup.length) {
            const nHero = this.norm(opponentLineup[oIdx].hero);
            const nSpr = this.opponentSprites[oIdx];
            nSpr.setPosition(layout.width + layout.offscreenX, layout.groundY);
            nSpr.setAlpha(1);
            this.pose(nSpr, nHero, 1);
            await this.moveTo(nSpr, { x: layout.opponentHomeX, y: layout.groundY }, 500);
          }
        } else {
          // Player lost → flies to player (left) corner in lose pose
          playSfx("heroDefeated");
          const sc = pSpr.scaleX;
          const pCornerX = layout.playerCornerX + pLosses * layout.defeatedStackStep;
          await Promise.all([
            this.tweenProps(pSpr, { scaleX: sc * 0.7, scaleY: sc * 0.7 }, 600),
            this.moveTo(pSpr, { x: pCornerX, y: layout.cornerY }, 700)
          ]);
          pLosses++;
          pIdx++;

          // Winner returns home in base pose
          this.pose(oSpr, oHero, 1);
          await this.moveTo(oSpr, { x: layout.opponentHomeX, y: layout.groundY }, 400);

          // Next player enters from off-screen (if any)
          if (pIdx < playerLineup.length) {
            const nHero = this.norm(playerLineup[pIdx]);
            const nSpr = this.playerSprites[pIdx];
            nSpr.setPosition(-layout.offscreenX, layout.groundY);
            nSpr.setAlpha(1);
            this.pose(nSpr, nHero, 1);
            await this.moveTo(nSpr, { x: layout.playerHomeX, y: layout.groundY }, 500);
          }
        }
      }
      fadeOutSfx("matchStart", 220);

      /* ─ Final winner jump ─ */
      playSfx(this.dataPayload!.result === "win" ? "matchWin" : "matchLose");
      const finalWinnerIdx = this.dataPayload!.result === "win" ? pIdx : oIdx;
      const finalWinner =
        this.dataPayload!.result === "win"
          ? this.playerSprites[Math.min(finalWinnerIdx, this.playerSprites.length - 1)]
          : this.opponentSprites[Math.min(finalWinnerIdx, this.opponentSprites.length - 1)];

      if (finalWinner) {
        this.tweens.add({
          targets: finalWinner,
          y: finalWinner.y - 20,
          duration: 200,
          yoyo: true,
          repeat: 1,
          ease: "Sine.easeOut"
        });
      }

      this.time.delayedCall(900, () => {
        eventBus.emit("battle:complete");
      });
    };

    runBattle().catch(() => null);

    // Resize
    this.resizeHandler = () => this.updateBackground();
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
    const l = this.getLayout();
    this.bg.setPosition(l.width / 2, l.height / 2);
    this.bg.setDisplaySize(l.width, l.height);
  }
}
