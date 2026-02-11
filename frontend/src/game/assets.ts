import { HeroType, WEATHER } from "@shared/types";

export const ASSET_PATHS = {
  placeholder: "/assets/ui/Block%20sq.avif",
  menuBackground: "/assets/ui/menu_background.avif",
  winBanner: "/assets/ui/Block%20sq.avif",
  loseBanner: "/assets/ui/Block%20sq.avif",
  hudTop: "/assets/ui/Block%20sq.avif",
  hudBar: "/assets/ui/Block%20sq.avif",
  heroAvatarFrame: "/assets/ui/Block%20sq.avif",
  buttonStart: "/assets/ui/button_start.avif",
  buttonMenu: "/assets/ui/Block%20sq.avif",
  modalGeneric: "/assets/ui/Block%20sq.avif",
  modalReward: "/assets/ui/Block%20sq.avif",
  iconBack: "/assets/ui/Close.avif",
  iconChest: "/assets/ui/icon_chest.avif",
  iconHome: "/assets/ui/Close.avif",
  iconSound: "/assets/ui/Close.avif",
  iconSettings: "/assets/ui/Close.avif"
};

export const HERO_POSES: Record<HeroType, string[]> = {
  Shark: [
    "/assets/heroes/shark/shark_pose_base.avif",
    "/assets/heroes/shark/shark_pose_anticipation.avif",
    "/assets/heroes/shark/shark_pose_fly.avif",
    "/assets/heroes/shark/shark_pose_strike.avif",
    "/assets/heroes/shark/shark_pose_win.avif",
    "/assets/heroes/shark/shark_pose_lose.avif"
  ],
  Whale: [
    "/assets/heroes/whale/whale_pose_base.avif",
    "/assets/heroes/whale/whale_pose_anticipation.avif",
    "/assets/heroes/whale/whale_pose_fly.avif",
    "/assets/heroes/whale/whale_pose_strike.avif",
    "/assets/heroes/whale/whale_pose_win.avif",
    "/assets/heroes/whale/whale_pose_lose.avif"
  ],
  Shrimp: [
    "/assets/heroes/shrimp/shrimp_pose_base.avif",
    "/assets/heroes/shrimp/shrimp_pose_anticipation.avif",
    "/assets/heroes/shrimp/shrimp_pose_fly.avif",
    "/assets/heroes/shrimp/shrimp_pose_strike.avif",
    "/assets/heroes/shrimp/shrimp_pose_win.avif",
    "/assets/heroes/shrimp/shrimp_pose_lose.avif"
  ]
};

export const WEATHER_BACKGROUNDS: Record<string, string> = WEATHER.reduce(
  (acc, weather) => {
    const filename = (() => {
      switch (weather.id) {
        case "SunlitShallows":
          return "SUNLIT SHALLOWS.avif";
        case "CoralBloom":
          return "CORAL BLOOM.avif";
        case "AbyssalGlow":
          return "ABYSSAL GLOW.avif";
        case "DeepWater":
          return "DEEP WATER.avif";
        case "CrimsonTide":
          return "Crimson Tide.avif";
        case "MoonTide":
          return "MOON TIDE.avif";
        default:
          return "SUNLIT SHALLOWS.avif";
      }
    })();
    acc[weather.backgroundKey] = encodeURI(`/assets/weather/${filename}`);
    return acc;
  },
  {} as Record<string, string>
);
