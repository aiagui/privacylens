import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  ppid: number;
  rssKb: number;
  args: string;
}

/** True where `ps` is available (macOS, Linux). Windows has no watchdog. */
export const processTreeSupported = process.platform !== "win32";

export async function listProcesses(): Promise<ProcessInfo[]> {
  if (!processTreeSupported) return [];
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,rss=,args="], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const rows: ProcessInfo[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match)
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKb: Number(match[3]),
        args: match[4] ?? "",
      });
  }
  return rows;
}

/** The processes whose command line carries `marker`, plus all descendants. */
export function treeOf(marker: string, all: ProcessInfo[]): ProcessInfo[] {
  const roots = all.filter((proc) => proc.args.includes(marker));
  const known = new Set(roots.map((proc) => proc.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const proc of all) {
      if (!known.has(proc.pid) && known.has(proc.ppid)) {
        known.add(proc.pid);
        grew = true;
      }
    }
  }
  return all.filter((proc) => known.has(proc.pid));
}

export async function browserTree(marker: string): Promise<ProcessInfo[]> {
  return treeOf(marker, await listProcesses());
}

export function totalRssBytes(tree: ProcessInfo[]): number {
  return tree.reduce((sum, proc) => sum + proc.rssKb * 1024, 0);
}

/** Force-kills every process in the tree; ignores ones that already exited. */
export function killTree(tree: ProcessInfo[]): void {
  for (const proc of tree) {
    if (proc.pid === process.pid) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
