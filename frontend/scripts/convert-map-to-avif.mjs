import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");

const inputPath = path.resolve(frontendRoot, "public/assets/ui/t desktop base map.png");
const outputPath = path.resolve(frontendRoot, "public/assets/ui/base-map.avif");

async function run() {
  await sharp(inputPath).avif({ quality: 82 }).toFile(outputPath);
  console.log(`Converted map to AVIF: ${outputPath}`);
}

run().catch((error) => {
  console.error("Failed to convert map PNG to AVIF.");
  console.error(error);
  process.exitCode = 1;
});
