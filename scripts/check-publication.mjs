import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

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
