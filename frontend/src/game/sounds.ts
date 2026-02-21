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
let menuAudioCtx: AudioContext | null = null;
let menuBuffer: AudioBuffer | null = null;
let menuLoopRange: { start: number; end: number } | null = null;
let menuGain: GainNode | null = null;
let menuSource: AudioBufferSourceNode | null = null;
let menuFadeRaf: number | null = null;
let menuTargetVolume = 0.35;

function clearFadeTimer(key: SfxKey) {
  const timer = fadeTimers[key];
  if (!timer) return;
  clearInterval(timer);
  delete fadeTimers[key];
}

function stopMenuWebAudio() {
  if (menuFadeRaf != null) {
    cancelAnimationFrame(menuFadeRaf);
    menuFadeRaf = null;
  }
  if (menuSource) {
    try {
      menuSource.stop();
    } catch {
      // ignore
    }
    menuSource.disconnect();
    menuSource = null;
  }
}

function getOrCreateAudioContext() {
  if (typeof window === "undefined" || (window.AudioContext == null && (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext == null)) {
    return null;
  }
  if (!menuAudioCtx) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    menuAudioCtx = new Ctx();
  }
  return menuAudioCtx;
}

function computeLoopRange(buffer: AudioBuffer) {
  const sampleRate = buffer.sampleRate;
  const maxTrimSec = 2;
  const threshold = 0.0008;
  const channelData = buffer.getChannelData(0);
  const maxTrimSamples = Math.min(channelData.length - 1, Math.floor(maxTrimSec * sampleRate));

  let startTrim = 0;
  while (startTrim < maxTrimSamples && Math.abs(channelData[startTrim]) < threshold) {
    startTrim += 1;
  }

  let endTrim = 0;
  while (endTrim < maxTrimSamples && Math.abs(channelData[channelData.length - 1 - endTrim]) < threshold) {
    endTrim += 1;
  }

  const start = startTrim / sampleRate;
  const end = Math.max(start + 0.05, buffer.duration - endTrim / sampleRate);
  return { start, end };
}

async function ensureMenuBuffer() {
  if (menuBuffer) return menuBuffer;
  const ctx = getOrCreateAudioContext();
  if (!ctx) return null;
  const res = await fetch(SFX_BASE + SFX.menuLoop);
  const arr = await res.arrayBuffer();
  menuBuffer = await ctx.decodeAudioData(arr.slice(0));
  menuLoopRange = computeLoopRange(menuBuffer);
  return menuBuffer;
}

async function startMenuWebAudioLoop(volume: number) {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const buffer = await ensureMenuBuffer();
  if (!buffer) return false;

  stopMenuWebAudio();
  menuTargetVolume = Math.max(0, Math.min(1, volume));

  if (!menuGain) {
    menuGain = ctx.createGain();
    menuGain.connect(ctx.destination);
  }
  menuGain.gain.setValueAtTime(menuTargetVolume, ctx.currentTime);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  if (menuLoopRange) {
    source.loopStart = menuLoopRange.start;
    source.loopEnd = menuLoopRange.end;
  }
  source.connect(menuGain);
  source.onended = () => {
    if (menuSource === source) {
      menuSource = null;
    }
  };
  source.start(0, menuLoopRange?.start ?? 0);
  menuSource = source;
  return true;
}

/** Enable or disable all sound effects */
export function setSfxEnabled(enabled: boolean) {
  sfxEnabled = enabled;
  if (!enabled) {
    stopMenuWebAudio();
    for (const key of Object.keys(SFX) as SfxKey[]) {
      clearFadeTimer(key);
      const audio = audioCache[key];
      if (!audio) continue;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = sfxVolume;
    }
    if (menuAudio) {
      menuAudio.pause();
      menuAudio.currentTime = 0;
    }
  }
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
  menuTargetVolume = Math.max(0, Math.min(1, volume));

  // Prefer WebAudio for a tighter seamless loop.
  const ctx = getOrCreateAudioContext();
  if (ctx) {
    if (menuSource && menuGain) {
      menuGain.gain.setValueAtTime(menuTargetVolume, ctx.currentTime);
      return;
    }
    void startMenuWebAudioLoop(menuTargetVolume).catch(() => {
      // Fall back to HTMLAudio below if WebAudio fails.
    });
    return;
  }

  try {
    if (!menuAudio) {
      menuAudio = new Audio(SFX_BASE + filename);
      menuAudio.loop = true;
      menuAudio.preload = "auto";
    }
    menuAudio.volume = menuTargetVolume;
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
  if (menuSource && menuGain && menuAudioCtx) {
    if (menuFadeRaf != null) {
      cancelAnimationFrame(menuFadeRaf);
      menuFadeRaf = null;
    }
    if (durationMs <= 0) {
      stopMenuWebAudio();
      return;
    }
    const startAt = performance.now();
    const startVolume = menuGain.gain.value;
    const tick = () => {
      if (!menuGain) return;
      const p = Math.min(1, (performance.now() - startAt) / durationMs);
      menuGain.gain.setValueAtTime(Math.max(0, startVolume * (1 - p)), menuAudioCtx!.currentTime);
      if (p >= 1) {
        stopMenuWebAudio();
        if (menuGain && menuAudioCtx) {
          menuGain.gain.setValueAtTime(menuTargetVolume, menuAudioCtx.currentTime);
        }
        return;
      }
      menuFadeRaf = requestAnimationFrame(tick);
    };
    menuFadeRaf = requestAnimationFrame(tick);
    return;
  }

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
