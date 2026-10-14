import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const checker = fileURLToPath(
  new URL("../scripts/check-publication.mjs", import.meta.url),
);
let repository: string;

beforeEach(() => {
  repository = mkdtempSync(join(tmpdir(), "privacylens-publication-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repository });
});
afterEach(() => rmSync(repository, { recursive: true, force: true }));

function write(path: string, tracked = true) {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, "Synthetic test content.\n");
  if (tracked) {
    execFileSync("git", ["add", "--force", "--", path], { cwd: repository });
    const paths = execFileSync("git", ["ls-files"], {
      cwd: repository,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    writeFileSync(
      join(repository, ".public-files"),
      [...new Set([...paths, ".public-files"])].sort().join("\n") + "\n",
    );
    execFileSync("git", ["add", ".public-files"], { cwd: repository });
  }
}
function check() {
  return spawnSync(process.execPath, [checker], {
    cwd: repository,
    encoding: "utf8",
  });
}

describe("publication policy", () => {
  it("allows product source, technical docs and public configuration", () => {
    for (const path of [
      "src/app/page.tsx",
      "docs/security/threat-model.md",
      "next.config.ts",
      "README.md",
    ])
      write(path);
    expect(check().status).toBe(0);
  });

  it("rejects forced tracking of nested instructions, private configuration and internal documents", () => {
    const paths = [
      "AGENTS.md",
      "nested/ClAuDe.Md",
      ".claude/settings.local.json",
      "nested/.codex/config.toml",
      ".openclaw/workspace.json",
      ".agents/context.json",
      "docs/operations/agent-collaboration.md",
      "docs/operations/governance.md",
      "docs/overnight-progress.md",
      ".env.local",
      "logs/scan.log",
      "backup.bundle",
      "nested/.cursor/rules.md",
    ];
    writeFileSync(join(repository, ".gitignore"), "AGENTS.md\n.claude/\n");
    for (const path of paths) write(path);
    const result = check();
    expect(result.status).toBe(1);
    for (const path of paths)
      expect(result.stderr).toContain(JSON.stringify(path));
  });

  it("rejects a file added without an inventory update", () => {
    write("README.md");
    writeFileSync(join(repository, "LICENSE"), "Synthetic license");
    execFileSync("git", ["add", "LICENSE"], { cwd: repository });
    expect(check().status).toBe(1);
  });

  it("inspects staged contents even when the working file is cleaned", () => {
    write("README.md");
    const localPath = ["", "Users", "someone", "private"].join("/");
    writeFileSync(join(repository, "README.md"), localPath);
    execFileSync("git", ["add", "README.md"], { cwd: repository });
    writeFileSync(join(repository, "README.md"), "Clean working file");
    expect(check().status).toBe(1);
  });

  it("rejects a tracked symlink", () => {
    write("README.md");
    execFileSync(
      "git",
      [
        "update-index",
        "--cacheinfo",
        "120000",
        execFileSync("git", ["hash-object", "README.md"], {
          cwd: repository,
          encoding: "utf8",
        }).trim(),
        "README.md",
      ],
      { cwd: repository },
    );
    expect(check().status).toBe(1);
  });

  it("allows local-only instruction files without publishing them", () => {
    write("README.md");
    write("AGENTS.md", false);
    write(".claude/settings.local.json", false);
    expect(check().status).toBe(0);
  });
});
