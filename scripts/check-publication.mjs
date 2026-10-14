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
    "0dc205d9521c579dde843e23eb88d24a7bea54165d70c2a1849880290869c15b",
  ],
  [
    "docs/assets/home-mobile.png",
    "a1920323424516ab27f4d38e44cc01119624d1a4d9961f1b139d31aaa63febae",
  ],
  [
    "docs/assets/report-desktop.png",
    "f0859d78e1ebfe406e69efa665b3c82307f791c6043e5d9d6a06aae5615fea04",
  ],
  [
    "docs/assets/report-mobile.png",
    "8fa965ed9f38380be4cfcc8a5cd5369f1f844a1364efc163a130fc6101cd7e50",
  ],
  [
    "docs/assets/import-empty-desktop.png",
    "4e18bdcc72252e5744cfc475d21e0278ae8606ad80cfb7d1fa3b01c281a3d9da",
  ],
  [
    "docs/assets/import-report-desktop.png",
    "7cb0bbadc77bcc375bf33d76dba4e6580a5fc2673c96a46f19bb0c9c1285a8e7",
  ],
  [
    "docs/assets/import-report-mobile.png",
    "88653d9868f955cc8c8d8817a0c4509fddd5b0b37532ba2ca64e6dd38908de18",
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
