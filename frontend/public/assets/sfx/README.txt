Sound Effects Folder
====================

Place your .mp3 / .ogg / .wav files here.
File names are configured in:  frontend/src/game/sounds.ts

Expected files:
───────────────────────────────────────
UI:
  click.mp3           — button press +
  modal_open.mp3      — open shop/inventory/leaderboard +
  modal_close.mp3     — close modal +

Match Flow:
  match_start.mp3     — battle screen appears +
  round_start.mp3     — each round begins +
  hero_fly.mp3        — hero starts flying +
  impact.mp3          — heroes collide (BANG!) +
  round_win.mp3       — round won +
  round_lose.mp3      — round lost +
  match_win.mp3       — entire match won +
  match_lose.mp3      — entire match lost +
  hero_defeated.mp3   — defeated hero flies to corner

Chest & Rewards:
  chest_appear.mp3    — chest appears after battle
  chest_open.mp3      — chest opens +
  reward_pop.mp3      — resource icon flies out of chest +
  reward_collect.mp3  — collect button pressed

Resources & Shop:
  purchase.mp3        — buy item from shop
  equip.mp3           — equip artifact
  streak_up.mp3       — win streak increases
  streak_break.mp3    — win streak broken

Ambient:
  bubbles.mp3         — background water ambience (loop)
───────────────────────────────────────

To change file names, edit SFX object in sounds.ts.
Set a value to "" to disable that sound.
