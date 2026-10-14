import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import process from "node:process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

// Only these reviewed product assets may contain binary data. Any byte change
// needs a fresh content/metadata review and an intentional fingerprint update.
const reviewedAssets = new Map([
  [
    "docs/assets/home-desktop.png",
    "8b2d77a4f44c1b2585deccb04e12d8338276e2e84594d51b8671c3512d5d1b67",
  ],
  [
    "docs/assets/home-mobile.png",
    "ae4740c3d64a94363fe7a068b66dee6cc4b77a1276d2040f2b1f9cd4cb5a7c21",
  ],
  [
    "docs/assets/report-desktop.png",
    "1b693568a6915b24ef71d4d8ab13bbf6e21a9ec2e01a3520e4d0a27f6ad637bf",
  ],
  [
    "docs/assets/report-mobile.png",
    "b3656973e695a5be49b1f067095820111efadd6cb57609f1e7d56b8a1152d925",
  ],
  [
    "public/icon.svg",
    "b44dbb2911e0e8935da525a0bd7dabc1869374677c8a629cb06b992531466a9d",
  ],
  [
    "public/social-preview.png",
    "d3b2152d8743eb0c2e9b60f1bb330d06b70ca876a4625d0cfae9bb7e10824441",
  ],
  [
    "public/fonts/manrope-latin.ttf",
    "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6",
  ],
  [
    "public/fonts/OFL.txt",
    "d6a309fcfb963d329a93baf9df66fa5f3c23a4be2b5f67edf24d6cafecde12ac",
  ],
]);

const rootFiles = new Set([
  ".public-files",
  ".gitignore",
  ".nvmrc",
  ".prettierignore",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "vitest.config.mts",
]);
const forbiddenParts = new Set([
  "agents.md",
  "claude.md",
  ".agents",
  ".claude",
  ".codex",
  ".openclaw",
  ".cursor",
  ".vscode",
  ".idea",
  "node_modules",
  "logs",
  "backups",
  "internal",
]);
const internalDocuments = new Set([
  "docs/operations/agent-collaboration.md",
  "docs/operations/governance.md",
  "docs/overnight-progress.md",
]);

function allowed(path) {
  const lower = path.toLowerCase();
  if (lower.split("/").some((part) => forbiddenParts.has(part))) return false;
  if (internalDocuments.has(lower)) return false;
  if (/\.(?:log|pem|key|bak|bundle|sarif)$/i.test(path)) return false;
  if (lower.split("/").some((part) => part.startsWith(".env"))) return false;
  return (
    reviewedAssets.has(path) ||
    rootFiles.has(path) ||
    /^(?:src|tests)\/[\w./-]+\.(?:ts|tsx|css)$/.test(path) ||
    /^scripts\/[\w-]+\.mjs$/.test(path) ||
    /^docs\/[\w/-]+\.md$/.test(path) ||
    /^\.github\/[\w./-]+\.(?:yml|md)$/.test(path)
  );
}

try {
  const entries = git("ls-files", "--stage", "-z")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [metadata, path] = entry.split("\t");
      const [mode, , stage] = metadata.split(" ");
      return { path, mode, stage };
    });
  const manifest = git("show", ":.public-files")
    .trim()
    .split("\n")
    .filter(Boolean);
  const paths = entries.map(({ path }) => path).sort();
  const rejected = [];
  if (
    new Set(manifest).size !== manifest.length ||
    JSON.stringify([...manifest].sort()) !== JSON.stringify(paths)
  ) {
    rejected.push("Publication inventory must match all staged paths exactly.");
  }
  for (const { path, mode, stage } of entries) {
    if (!allowed(path) || mode !== "100644" || stage !== "0") {
      rejected.push(`Prohibited staged path or mode: ${JSON.stringify(path)}`);
      continue;
    }
    if (reviewedAssets.has(path)) {
      const bytes = execFileSync("git", ["show", `:${path}`], {
        maxBuffer: 16 * 1024 * 1024,
      });
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        reviewedAssets.get(path)
      ) {
        rejected.push(`Unreviewed asset content: ${JSON.stringify(path)}`);
      }
      continue;
    }
    const content = git("show", `:${path}`);
    if (
      content.includes("\0") ||
      /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(content)
    ) {
      rejected.push(
        `Binary content or local user path: ${JSON.stringify(path)}`,
      );
    }
  }
  if (rejected.length) throw new Error(rejected.join("\n"));
  console.log(`Publication check passed (${paths.length} staged files).`);
} catch (error) {
  console.error("Publication check failed.", error.message);
  process.exitCode = 1;
}
