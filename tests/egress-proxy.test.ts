import { createServer, type Server } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startEgressProxy,
  type EgressOptions,
  type EgressProxy,
  type ResolvedAddress,
} from "../src/scanner/egress-proxy";

let proxy: EgressProxy | undefined;
const servers: Array<Server | TcpServer> = [];

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((done) => server.close(done))),
  );
});

function auth(p: EgressProxy): string {
  return `Basic ${Buffer.from(`${p.credentials.username}:${p.credentials.password}`).toString("base64")}`;
}

/** Sends one raw request to the proxy and returns everything it answers. */
function raw(p: EgressProxy, request: string): Promise<string> {
  return new Promise((done) => {
    const socket = connect(p.port, "127.0.0.1");
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
    });
    socket.on("close", () => done(data));
    socket.on("error", () => done(data));
    socket.write(request);
    setTimeout(() => socket.destroy(), 1500);
  });
}

const status = (answer: string) => answer.split("\r\n")[0];

/** Resolver: names come from the map, IP literals resolve to themselves. */
function resolver(map: Record<string, string[]>) {
  return async (host: string): Promise<ResolvedAddress[]> => {
    const literal = map[host] ?? (/^[\d.:a-f]+$/i.test(host) ? [host] : []);
    if (literal.length === 0) throw new Error("ENOTFOUND");
    return literal.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  };
}

function trackedConnect() {
  const calls: Array<{ host?: string; port?: number }> = [];
  const connectFn = ((options: { host: string; port: number }) => {
    calls.push({ host: options.host, port: options.port });
    return connect(options);
  }) as unknown as NonNullable<EgressOptions["connect"]>;
  return { calls, connectFn };
}

async function start(options: EgressOptions = {}) {
  proxy = await startEgressProxy(options);
  return proxy;
}

const connectRequest = (p: EgressProxy, authority: string, withAuth = true) =>
  `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${withAuth ? `Proxy-Authorization: ${auth(p)}\r\n` : ""}\r\n`;

describe("egress proxy authentication and request shape", () => {
  it("refuses unauthenticated use with 407", async () => {
    const { calls, connectFn } = trackedConnect();
    const p = await start({
      connect: connectFn,
      resolve: resolver({ "site.test": ["93.184.216.34"] }),
    });
    expect(
      status(await raw(p, connectRequest(p, "site.test:443", false))),
    ).toContain("407");
    expect(
      status(
        await raw(
          p,
          "GET http://site.test/ HTTP/1.1\r\nHost: site.test\r\n\r\n",
        ),
      ),
    ).toContain("407");
    expect(calls).toEqual([]);
  });

  it("rejects origin-form requests aimed at the proxy itself", async () => {
    const p = await start();
    const answer = await raw(
      p,
      `GET /secret HTTP/1.1\r\nHost: 127.0.0.1\r\nProxy-Authorization: ${auth(p)}\r\n\r\n`,
    );
    expect(status(answer)).toContain("400");
  });

  it.each([
    "ftp://site.test/",
    "file:///etc/passwd",
    "http://user:pw@site.test/",
  ])("rejects non-http or credentialed absolute URI %s", async (uri) => {
    const p = await start({
      resolve: resolver({ "site.test": ["93.184.216.34"] }),
    });
    const answer = await raw(
      p,
      `GET ${uri} HTTP/1.1\r\nProxy-Authorization: ${auth(p)}\r\n\r\n`,
    );
    expect(status(answer)).toContain("400");
  });

  it.each(["site.test", "site.test:0", "site.test:70000", ":443", "[::1"])(
    "rejects malformed CONNECT authority %j",
    async (authority) => {
      const { calls, connectFn } = trackedConnect();
      const p = await start({ connect: connectFn });
      expect(status(await raw(p, connectRequest(p, authority)))).toContain(
        "400",
      );
      expect(calls).toEqual([]);
    },
  );
});

describe("egress proxy address policy", () => {
  it.each([
    "127.0.0.1:80",
    "10.0.0.1:443",
    "192.168.0.10:8080",
    "169.254.169.254:80",
    "100.64.0.1:80",
    "0.0.0.0:80",
    "[::1]:80",
    "[fd00:ec2::254]:80",
    "[fe80::1]:80",
    "[::ffff:127.0.0.1]:80",
    "[::ffff:7f00:1]:80",
    "[64:ff9b::7f00:1]:80",
    "[fe80::1%25eth0]:80",
  ])(
    "refuses a CONNECT to private literal %s and never opens a socket",
    async (authority) => {
      const { calls, connectFn } = trackedConnect();
      const p = await start({ connect: connectFn });
      expect(status(await raw(p, connectRequest(p, authority)))).toContain(
        "403",
      );
      expect(calls).toEqual([]);
      expect(p.stats().blockedConnections).toBe(1);
    },
  );

  it("refuses plain-HTTP absolute-URI requests to private addresses", async () => {
    const { calls, connectFn } = trackedConnect();
    const p = await start({ connect: connectFn });
    for (const uri of [
      "http://127.0.0.1:1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]) {
      const answer = await raw(
        p,
        `GET ${uri} HTTP/1.1\r\nHost: ${new URL(uri).host}\r\nProxy-Authorization: ${auth(p)}\r\n\r\n`,
      );
      expect(status(answer), uri).toContain("403");
    }
    expect(calls).toEqual([]);
  });

  it("refuses a name that resolves to a private address", async () => {
    const { calls, connectFn } = trackedConnect();
    const p = await start({
      connect: connectFn,
      resolve: resolver({ "internal.test": ["10.1.2.3"] }),
    });
    expect(
      status(await raw(p, connectRequest(p, "internal.test:443"))),
    ).toContain("403");
    expect(calls).toEqual([]);
  });

  it("refuses a name when any answer is non-public, even if another is public", async () => {
    const { calls, connectFn } = trackedConnect();
    const p = await start({
      connect: connectFn,
      resolve: resolver({ "mixed.test": ["93.184.216.34", "127.0.0.1"] }),
    });
    expect(status(await raw(p, connectRequest(p, "mixed.test:443")))).toContain(
      "403",
    );
    expect(calls).toEqual([]);
  });

  it("refuses unresolvable names", async () => {
    const p = await start({ resolve: resolver({}) });
    expect(
      status(await raw(p, connectRequest(p, "nowhere.test:443"))),
    ).toContain("403");
    expect(p.stats().blockedDestinations[0]).toEqual({
      host: "nowhere.test",
      port: 443,
      reason: "unresolvable",
    });
  });

  it("defeats DNS rebinding by connecting to the exact address it validated", async () => {
    const { calls, connectFn } = trackedConnect();
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    const resolve = vi.fn(async () =>
      (answers.shift() ?? ["127.0.0.1"]).map((address) => ({
        address,
        family: 4,
      })),
    );
    // Public policy would let 93.184.216.34 through but there is nothing to
    // connect to; fail the dial so only the arguments are inspected.
    const failingConnect = ((options: { host: string; port: number }) => {
      calls.push({ host: options.host, port: options.port });
      return connect({ host: "127.0.0.1", port: 1 });
    }) as unknown as NonNullable<EgressOptions["connect"]>;
    void connectFn;
    const p = await start({ connect: failingConnect, resolve });
    await raw(p, connectRequest(p, "rebind.test:80"));
    // The dial used the validated IP literal, never the hostname.
    expect(calls).toEqual([{ host: "93.184.216.34", port: 80 }]);
    // The next resolution flips to loopback and is refused outright.
    expect(status(await raw(p, connectRequest(p, "rebind.test:80")))).toContain(
      "403",
    );
    expect(calls).toHaveLength(1);
  });

  it("records only host, port and reason for blocked destinations", async () => {
    const p = await start();
    await raw(p, connectRequest(p, "127.0.0.1:8080"));
    expect(p.stats().blockedDestinations).toEqual([
      { host: "127.0.0.1", port: 8080, reason: "non-public-address" },
    ]);
    expect(p.wasBlocked("127.0.0.1", 8080)).toBe(true);
    expect(p.wasBlocked("127.0.0.1", 9)).toBe(false);
  });
});

describe("egress proxy forwarding", () => {
  it("tunnels bytes for an address the policy allows", async () => {
    const echo = createTcpServer((socket: Socket) =>
      socket.on("data", (d) => socket.write(d)),
    );
    servers.push(echo);
    await new Promise<void>((done) => echo.listen(0, "127.0.0.1", done));
    const port = (echo.address() as { port: number }).port;
    const p = await start({
      policy: {
        allowAddress: (address, p2) => address === "127.0.0.1" && p2 === port,
      },
      resolve: resolver({ "allowed.test": ["127.0.0.1"] }),
    });
    const answer = await new Promise<string>((done) => {
      const socket = connect(p.port, "127.0.0.1");
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        data += chunk;
        if (data.includes("hello-through-tunnel")) {
          socket.destroy();
          done(data);
        }
      });
      socket.write(connectRequest(p, `allowed.test:${port}`));
      socket.once("data", () => socket.write("hello-through-tunnel"));
      setTimeout(() => {
        socket.destroy();
        done(data);
      }, 2000);
    });
    expect(answer).toContain("200 Connection Established");
    expect(answer).toContain("hello-through-tunnel");
    expect(p.stats().allowedConnections).toBe(1);
  });

  it("forwards plain HTTP to an allowed address with the original Host header", async () => {
    let seenHost = "";
    const origin = createServer((req, res) => {
      seenHost = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
    servers.push(origin);
    await new Promise<void>((done) => origin.listen(0, "127.0.0.1", done));
    const port = (origin.address() as { port: number }).port;
    const p = await start({
      policy: {
        allowAddress: (address, p2) => address === "127.0.0.1" && p2 === port,
      },
      resolve: resolver({ "site.test": ["127.0.0.1"] }),
    });
    const answer = await raw(
      p,
      `GET http://site.test:${port}/page HTTP/1.1\r\nHost: site.test:${port}\r\nProxy-Authorization: ${auth(p)}\r\nConnection: close\r\n\r\n`,
    );
    expect(status(answer)).toContain("200");
    expect(answer).toContain("ok");
    expect(seenHost).toBe(`site.test:${port}`);
  });

  it("enforces the concurrent connection limit", async () => {
    const hold = createTcpServer(() => undefined);
    servers.push(hold);
    await new Promise<void>((done) => hold.listen(0, "127.0.0.1", done));
    const port = (hold.address() as { port: number }).port;
    const p = await start({
      policy: { allowAddress: () => true },
      resolve: resolver({ "slow.test": ["127.0.0.1"] }),
      limits: { maxConnections: 4 },
    });
    const held: Socket[] = [];
    for (let i = 0; i < 4; i += 1) {
      const socket = connect(p.port, "127.0.0.1");
      socket.write(connectRequest(p, `slow.test:${port}`));
      held.push(socket);
    }
    await new Promise((done) => setTimeout(done, 300));
    const answer = await raw(p, connectRequest(p, `slow.test:${port}`));
    expect(status(answer)).toContain("403");
    expect(p.stats().blockedDestinations.at(-1)?.reason).toBe("limit-exceeded");
    for (const socket of held) socket.destroy();
  });

  it("cuts connections once the total byte budget is exceeded", async () => {
    const flood = createTcpServer((socket: Socket) => {
      const timer = setInterval(() => socket.write(Buffer.alloc(8192)), 5);
      socket.on("close", () => clearInterval(timer));
      socket.on("error", () => undefined);
    });
    servers.push(flood);
    await new Promise<void>((done) => flood.listen(0, "127.0.0.1", done));
    const port = (flood.address() as { port: number }).port;
    const p = await start({
      policy: { allowAddress: () => true },
      resolve: resolver({ "flood.test": ["127.0.0.1"] }),
      limits: { maxTotalBytes: 64 * 1024 },
    });
    const closed = await new Promise<boolean>((done) => {
      const socket = connect(p.port, "127.0.0.1");
      socket.on("close", () => done(true));
      socket.on("data", () => undefined);
      socket.write(connectRequest(p, `flood.test:${port}`));
      setTimeout(() => done(false), 4000);
    });
    expect(closed).toBe(true);
    expect(p.stats().totalBytes).toBeGreaterThan(64 * 1024);
  }, 10_000);
});
