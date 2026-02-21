import type { Tier } from "./economy";
export type { Tier } from "./economy";

export function getBuildAssetUrl(folderName: string, tier: Tier, assetBaseName?: string): string {
  const fileBaseName = assetBaseName ?? folderName;
  const encodedFolder = encodeURIComponent(folderName);
  const encodedFile = encodeURIComponent(`${fileBaseName} ${tier}.png`);
  return `/assets/Builds/${encodedFolder}/${encodedFile}`;
}
