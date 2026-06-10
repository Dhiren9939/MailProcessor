import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

cpSync(join(rootDir, "src", "index.js"), join(distDir, "index.js"));
cpSync(join(rootDir, "package.json"), join(distDir, "package.json"));
cpSync(join(rootDir, "package-lock.json"), join(distDir, "package-lock.json"));

execSync(`npm ci --omit=dev --prefix "${distDir}"`, {
    stdio: "inherit",
});
