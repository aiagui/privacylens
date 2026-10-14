import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Starts the production build (`next start`) on an ephemeral loopback port and
 * waits until it answers. Returns its origin and a function that stops it.
 */
export async function startProductionServer() {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-8000);
  });
  const stop = async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([stopped, delay(5000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited: ${output}`);
    }
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return { origin, stop };
    } catch {
      /* Wait for the local server. */
    }
    await delay(250);
  }
  await stop();
  throw new Error(`Production server did not start: ${output}`);
}
