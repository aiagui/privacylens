import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { type AddressPolicy, publicOnlyPolicy } from "./ip-policy.ts";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface EgressLimits {
  maxConnections: number;
  maxTotalBytes: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
}

export type BlockReason =
  "non-public-address" | "unresolvable" | "bad-request" | "limit-exceeded";

export interface BlockedDestination {
  host: string;
  port: number;
  reason: BlockReason;
}

export interface EgressOptions {
  policy?: AddressPolicy;
  /** Injectable for tests; defaults to the operating system resolver. */
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  /** Injectable for tests; defaults to net.connect. */
  connect?: typeof netConnect;
  limits?: Partial<EgressLimits>;
}

export const DEFAULT_EGRESS_LIMITS: EgressLimits = {
  maxConnections: 64,
  maxTotalBytes: 100 * 1024 * 1024,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 20_000,
};

/** Lets the collector tell a filter refusal from a real server answering 403. */
export const BLOCKED_HEADER = "x-privacylens-blocked";

const MAX_RECORDED_BLOCKS = 100;
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function keyOf(host: string, port: number): string {
  return `${host.replace(/^\[|\]$/g, "").toLowerCase()}:${port}`;
}

function defaultResolve(host: string): Promise<ResolvedAddress[]> {
  return lookup(host, { all: true, verbatim: true });
}

/** Splits "host:port" or "[v6]:port"; returns undefined if malformed. */
function parseAuthority(
  value: string,
  defaultPort?: number,
): { host: string; port: number } | undefined {
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d{1,5}))?$/.exec(value);
  if (!match) return undefined;
  const host = (match[1] ?? match[2] ?? "").toLowerCase();
  const port = match[3] ? Number(match[3]) : defaultPort;
  if (!host || port === undefined || port < 1 || port > 65_535)
    return undefined;
  return { host, port };
}

export interface EgressProxy {
  /** Credentials the browser must present; others cannot use the proxy. */
  readonly credentials: { username: string; password: string };
  readonly port: number;
  stats(): {
    allowedConnections: number;
    blockedConnections: number;
    blockedDestinations: BlockedDestination[];
    totalBytes: number;
  };
  wasBlocked(host: string, port: number): boolean;
  /** Why a destination was refused, if it was. */
  blockReason(host: string, port: number): BlockReason | undefined;
  close(): Promise<void>;
}

/**
 * A local forward proxy that is the single egress point for the scanner's
 * browser. It resolves names itself, requires every resolved address to pass
 * the policy, and connects to the exact address it validated, so there is no
 * gap between the check and the connection for DNS rebinding to use. Redirects,
 * subresources, WebSockets and iframes all open new proxied connections and are
 * checked individually.
 *
 * This is the boundary for a scanner running on the user's own machine. It is
 * not the infrastructure isolation that hosted scanning requires.
 */
export async function startEgressProxy(
  options: EgressOptions = {},
): Promise<EgressProxy> {
  const policy = options.policy ?? publicOnlyPolicy;
  const resolve = options.resolve ?? defaultResolve;
  const connectFn = options.connect ?? netConnect;
  const limits: EgressLimits = { ...DEFAULT_EGRESS_LIMITS, ...options.limits };
  const credentials = {
    username: "privacylens",
    password: randomBytes(24).toString("hex"),
  };
  const expectedAuth = `Basic ${Buffer.from(
    `${credentials.username}:${credentials.password}`,
  ).toString("base64")}`;

  const sockets = new Set<Socket>();
  const blocked: BlockedDestination[] = [];
  const blockedKeys = new Map<string, BlockReason>();
  let allowed = 0;
  let blockedCount = 0;
  let totalBytes = 0;

  function recordBlock(host: string, port: number, reason: BlockReason) {
    blockedCount += 1;
    blockedKeys.set(`${host}:${port}`, reason);
    if (blocked.length < MAX_RECORDED_BLOCKS)
      blocked.push({ host, port, reason });
  }

  function track(socket: Socket) {
    sockets.add(socket);
    socket.setTimeout(limits.idleTimeoutMs, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > limits.maxTotalBytes) {
        for (const open of sockets) open.destroy();
      }
    });
  }

  /** Returns a connected socket to a validated address, or a block reason. */
  async function open(
    host: string,
    port: number,
  ): Promise<{ socket: Socket } | { reason: BlockReason }> {
    if (sockets.size >= limits.maxConnections)
      return { reason: "limit-exceeded" };
    let addresses: ResolvedAddress[];
    try {
      addresses = await resolve(host);
    } catch {
      return { reason: "unresolvable" };
    }
    if (addresses.length === 0) return { reason: "unresolvable" };
    // One non-public answer taints the name: refuse rather than choose.
    if (addresses.some(({ address }) => !policy.allowAddress(address, port)))
      return { reason: "non-public-address" };
    for (const { address } of addresses) {
      try {
        const socket = await new Promise<Socket>((done, fail) => {
          const attempt = connectFn({ host: address, port });
          const timer = setTimeout(() => {
            attempt.destroy();
            fail(new Error("connect timeout"));
          }, limits.connectTimeoutMs);
          attempt.once("connect", () => {
            clearTimeout(timer);
            done(attempt);
          });
          attempt.once("error", (error) => {
            clearTimeout(timer);
            fail(error);
          });
        });
        return { socket };
      } catch {
        // Try the next validated address.
      }
    }
    return { reason: "unresolvable" };
  }

  function authorized(header: string | string[] | undefined): boolean {
    return typeof header === "string" && header === expectedAuth;
  }

  const server: Server = createServer();

  // HTTPS, WebSockets and anything tunnelled: CONNECT host:port.
  server.on(
    "connect",
    async (req: IncomingMessage, client: Socket, head: Buffer) => {
      track(client);
      const deny = (
        status: string,
        host = "",
        port = 0,
        reason?: BlockReason,
      ) => {
        if (reason) recordBlock(host, port, reason);
        client.end(
          `HTTP/1.1 ${status}\r\n${BLOCKED_HEADER}: 1\r\nConnection: close\r\n\r\n`,
        );
      };
      if (!authorized(req.headers["proxy-authorization"])) {
        client.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="privacylens"\r\nConnection: close\r\n\r\n',
        );
        return;
      }
      const target = parseAuthority(req.url ?? "");
      if (!target) return deny("400 Bad Request", "", 0, "bad-request");
      const result = await open(target.host, target.port);
      if ("reason" in result)
        return deny("403 Forbidden", target.host, target.port, result.reason);
      allowed += 1;
      const upstream = result.socket;
      track(upstream);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      upstream.on("close", () => client.destroy());
      client.on("close", () => upstream.destroy());
    },
  );

  // Plain http:// requests arrive with an absolute URI.
  server.on("request", async (req: IncomingMessage, res: ServerResponse) => {
    const fail = (code: number, host = "", port = 0, reason?: BlockReason) => {
      if (reason) recordBlock(host, port, reason);
      res.writeHead(code, { Connection: "close", [BLOCKED_HEADER]: "1" }).end();
    };
    if (!authorized(req.headers["proxy-authorization"])) {
      res
        .writeHead(407, { "Proxy-Authenticate": 'Basic realm="privacylens"' })
        .end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return fail(400, "", 0, "bad-request");
    }
    if (url.protocol !== "http:" || url.username || url.password)
      return fail(400, "", 0, "bad-request");
    const authority = parseAuthority(url.host, 80);
    if (!authority) return fail(400, "", 0, "bad-request");
    const result = await open(authority.host, authority.port);
    if ("reason" in result)
      return fail(403, authority.host, authority.port, result.reason);
    const socket = result.socket;
    track(socket);
    allowed += 1;
    const headers = { ...req.headers };
    for (const name of HOP_BY_HOP) delete headers[name];
    const upstream = httpRequest({
      createConnection: () => socket,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
    });
    upstream.on("response", (response) => {
      const out = { ...response.headers };
      for (const name of HOP_BY_HOP) delete out[name];
      res.writeHead(response.statusCode ?? 502, out);
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { Connection: "close" });
      res.end();
    });
    req.pipe(upstream);
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Egress proxy failed to bind a loopback port");

  return {
    credentials,
    port: address.port,
    stats: () => ({
      allowedConnections: allowed,
      blockedConnections: blockedCount,
      blockedDestinations: [...blocked],
      totalBytes,
    }),
    wasBlocked: (host, port) => blockedKeys.has(keyOf(host, port)),
    blockReason: (host, port) => blockedKeys.get(keyOf(host, port)),
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
