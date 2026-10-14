import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // Beyond framing and plugins: pages may only load their own images,
            // fonts and connections, and may not submit forms or embed frames or
            // media. Scripts and styles are not restricted here because the
            // framework needs inline ones. This is a safety net behind the
            // rule that imported report values are only ever rendered as text.
            value: [
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "media-src 'none'",
              "frame-src 'none'",
              "worker-src 'none'",
              "form-action 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
