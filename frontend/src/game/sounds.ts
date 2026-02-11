/**
 * Sound Effects Configuration
 *
 * Add your .mp3 / .ogg / .wav files to:  frontend/public/assets/sfx/
 * Then update the filename here to match.
 *
 * Example: replace "click.mp3" with your actual file name.
 * Leave empty string "" to disable a sound.
 */

export const SFX = {
  // ── UI ──
  buttonClick:    "click.mp3",         // any button press
  modalOpen:      "modal_open.mp3",    // shop, inventory, leaderboard open
  modalClose:     "modal_close.mp3",   // modal close

  // ── Match Flow ──
  matchStart:     "match_start.mp3",   // battle begins
  roundStart:     "round_start.mp3",   // each new round begins
  heroFly:        "hero_fly.mp3",      // hero starts flying
  impact:         "impact.mp3",        // heroes collide (BANG!)
  knock1:         "",                  // hit variation 1 (optional)
  knock2:         "",                  // hit variation 2 (optional)
  knock3:         "",                  // hit variation 3 (optional)
  roundWin:       "round_win.mp3",     // round won
  roundLose:      "round_lose.mp3",    // round lost
  matchWin:       "match_win.mp3",     // entire match won
  matchLose:      "match_lose.mp3",    // entire match lost
  heroDefeated:   "",                  // defeated hero flies to corner (add file)

  // ── Chest & Rewards ──
  chestAppear:    "",                  // chest appears after battle (add file)
  chestOpen:      "chest_open.mp3",    // chest opens
  rewardPop:      "reward_pop.mp3",    // each resource icon flies out
  rewardCollect:  "",                  // collect button pressed (add file)

  // ── Resources & Shop ──
  purchase:       "",                  // buy item from shop (add file)
  equip:          "",                  // equip artifact (add file)
  streakUp:       "",                  // win streak increases (add file)
  streakBreak:    "",                  // win streak broken (add file)

  // ── Ambient ──
  menuLoop:       "menu.mp3",          // menu/prematch background loop
  bubbles:        "",                  // background water ambience loop (add file)
} as const;

export type SfxKey = keyof typeof SFX;

const SFX_BASE = "/assets/sfx/";
const audioCache: Partial<Record<SfxKey, HTMLAudioElement>> = {};
const fadeTimers: Partial<Record<SfxKey, ReturnType<typeof setInterval>>> = {};

let sfxEnabled = true;
let sfxVolume = 0.5;
let menuAudio: HTMLAudioElement | null = null;

function clearFadeTimer(key: SfxKey) {
  const timer = fadeTimers[key];
  if (!timer) return;
  clearInterval(timer);
  delete fadeTimers[key];
}

/** Enable or disable all sound effects */
export function setSfxEnabled(enabled: boolean) {
  sfxEnabled = enabled;
}

/** Set master volume (0.0 — 1.0) */
export function setSfxVolume(vol: number) {
  sfxVolume = Math.max(0, Math.min(1, vol));
}

/**
 * Play a sound effect by key.
 * Does nothing if the file is missing or empty string.
 */
export function playSfx(key: SfxKey, volume?: number) {
  if (!sfxEnabled) return;
  const filename = SFX[key];
  if (!filename) return;

  try {
    clearFadeTimer(key);
    let audio = audioCache[key];
    if (!audio) {
      audio = new Audio(SFX_BASE + filename);
      audioCache[key] = audio;
    }
    audio.volume = volume ?? sfxVolume;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Browser may block autoplay — ignore silently
    });
  } catch {
    // Sound file not found or not supported — ignore
  }
}

/** Start (or resume) looping menu background music. */
export function playMenuLoop(volume = 0.35) {
  if (!sfxEnabled) return;
  const filename = SFX.menuLoop;
  if (!filename) return;
  try {
    if (!menuAudio) {
      menuAudio = new Audio(SFX_BASE + filename);
      menuAudio.loop = true;
      menuAudio.preload = "auto";
    }
    menuAudio.volume = Math.max(0, Math.min(1, volume));
    if (menuAudio.paused) {
      menuAudio.play().catch(() => {
        // Browser may block autoplay until user interaction
      });
    }
  } catch {
    // ignore
  }
}

/** Fade out menu loop quickly and stop playback. */
export function fadeOutMenuLoop(durationMs = 250) {
  if (!menuAudio || menuAudio.paused) return;
  if (durationMs <= 0) {
    menuAudio.pause();
    menuAudio.currentTime = 0;
    return;
  }
  const startVolume = menuAudio.volume;
  const start = performance.now();
  const tick = () => {
    if (!menuAudio) return;
    const p = Math.min(1, (performance.now() - start) / durationMs);
    menuAudio.volume = Math.max(0, startVolume * (1 - p));
    if (p >= 1) {
      menuAudio.pause();
      menuAudio.currentTime = 0;
      menuAudio.volume = startVolume;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Quickly fade out a playing sound, then stop it. */
export function fadeOutSfx(key: SfxKey, durationMs = 220) {
  const audio = audioCache[key];
  if (!audio || audio.paused) return;

  clearFadeTimer(key);

  if (durationMs <= 0) {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = sfxVolume;
    return;
  }

  const stepMs = 16;
  const steps = Math.max(1, Math.floor(durationMs / stepMs));
  const startVolume = audio.volume;
  let currentStep = 0;

  fadeTimers[key] = setInterval(() => {
    currentStep += 1;
    const progress = currentStep / steps;

    if (progress >= 1 || audio.paused) {
      clearFadeTimer(key);
      audio.pause();
      audio.currentTime = 0;
      audio.volume = sfxVolume;
      return;
    }

    audio.volume = Math.max(0, startVolume * (1 - progress));
  }, stepMs);
}

/** Play a random knock sound (knock1, knock2 or knock3) */
export function playRandomKnock(volume?: number) {
  const knocks: SfxKey[] = (["knock1", "knock2", "knock3"] as SfxKey[]).filter(
    (k) => Boolean(SFX[k])
  );
  if (knocks.length === 0) return;
  const pick = knocks[Math.floor(Math.random() * knocks.length)];
  playSfx(pick, volume);
}

/**
 * Preload sounds so they play instantly when needed.
 * Call once after user interaction (e.g. first click).
 */
export function preloadSfx() {
  for (const key of Object.keys(SFX) as SfxKey[]) {
    const filename = SFX[key];
    if (!filename) continue;
    const audio = new Audio(SFX_BASE + filename);
    audio.preload = "auto";
    audioCache[key] = audio;
  }
}
