import type { TechnologyFinding } from "./types";

/**
 * Bump whenever any signature below changes. tests/signatures.test.ts pins a
 * content hash so an edit without a version bump fails CI.
 */
export const SIGNATURE_SET_VERSION = "2026-10-14.2";

export interface SignatureSource {
  url: string;
  /** Date the page was fetched and found to mention the matched string. */
  verifiedOn: string;
  supports: string;
}

export interface Signature {
  id: string;
  name: string;
  category: TechnologyFinding["category"];
  /** Registrable domains; subdomains match. */
  domains: string[];
  /**
   * Required for attribution when the domain also serves ordinary pages.
   * Absent only when the whole domain is dedicated to the vendor's tooling.
   */
  path?: RegExp;
  /**
   * The only paths on this vendor's hosts that count as a collection request.
   * Without it a signature can never produce `observed`, only `inferred`.
   */
  collection?: RegExp;
  /** True only if a fetched vendor source supports the `collection` pattern. */
  collectionSourced: boolean;
  /** Human-readable identification criteria; what a match does and does not show. */
  criteria: string;
  sources: SignatureSource[];
  /** Criteria not yet backed by a fetched source. Must be non-empty if `sources` is. */
  unverified: string[];
  examples: {
    /** Must be classified `observed` when requested as a non-script resource. */
    observed: string[];
    /** Attributed to the vendor but not shown to send data. */
    inferred: string[];
    /** Must not be attributed to this vendor. */
    negative: string[];
  };
}

const CHECKED = "2026-10-14";

export const signatures: Signature[] = [
  {
    id: "google-analytics",
    name: "Google Analytics",
    category: "analytics",
    domains: ["google-analytics.com", "analytics.google.com"],
    path: /(?:^|\/)(?:[gjr]\/collect|collect|analytics\.js)\/?$/i,
    collection: /(?:^|\/)(?:[gjr]\/collect|collect)\/?$/i,
    collectionSourced: false,
    criteria:
      "Request to a Google Analytics host whose path ends in a collect endpoint or analytics.js.",
    sources: [
      {
        url: "https://developers.google.com/analytics/devguides/collection/protocol/v1/devguide",
        verifiedOn: CHECKED,
        supports: "/collect endpoint",
      },
      {
        url: "https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events",
        verifiedOn: CHECKED,
        supports: "/mp/collect endpoint",
      },
    ],
    unverified: [
      "/g/collect, /j/collect, /r/collect browser paths",
      "analytics.google.com host",
      "analytics.js",
    ],
    examples: {
      observed: [
        "https://www.google-analytics.com/g/collect?v=2",
        "https://analytics.google.com/g/collect?v=2",
      ],
      inferred: ["https://www.google-analytics.com/analytics.js"],
      negative: [
        "https://www.google-analytics.com/collectibles",
        "https://www.google-analytics.com/",
      ],
    },
  },
  {
    id: "google-tag-manager",
    name: "Google Tag Manager",
    category: "tag-manager",
    domains: ["googletagmanager.com"],
    collectionSourced: false,
    criteria:
      "Any request to googletagmanager.com, which hosts only Google tag loaders. Loading the tag manager does not show which tags it runs.",
    sources: [
      {
        url: "https://developers.google.com/tag-platform/tag-manager/web",
        verifiedOn: CHECKED,
        supports: "googletagmanager.com hosts the container script",
      },
    ],
    unverified: [
      "Domain is dedicated to tag loading (not independently sourced)",
    ],
    examples: {
      observed: [],
      inferred: [
        "https://www.googletagmanager.com/gtag/js?id=G-X",
        "https://www.googletagmanager.com/events",
      ],
      negative: ["https://googletagmanager.com.example/gtag/js"],
    },
  },
  {
    id: "google-ads",
    name: "Google Ads",
    category: "advertising",
    domains: ["googleadservices.com", "doubleclick.net"],
    collectionSourced: false,
    criteria:
      "Any request to googleadservices.com or doubleclick.net. A request shows a connection to an advertising host, not what was sent.",
    sources: [],
    unverified: ["Both domains are advertising hosts; no vendor page fetched"],
    examples: {
      observed: [],
      inferred: [
        "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/",
      ],
      negative: ["https://notdoubleclick.net/x"],
    },
  },
  {
    id: "meta-pixel",
    name: "Meta Pixel",
    category: "advertising",
    domains: ["facebook.com", "facebook.net"],
    path: /^\/(?:tr\/?$|(?:.*\/)?fbevents\.js$)/i,
    collection: /^\/tr\/?$/i,
    collectionSourced: false,
    criteria:
      "facebook.com/tr at the path root, or an fbevents.js script. Other facebook.com pages are not attributed.",
    sources: [],
    unverified: [
      "/tr endpoint",
      "fbevents.js (Meta docs page fetched did not mention it)",
    ],
    examples: {
      observed: ["https://www.facebook.com/tr?id=1"],
      inferred: ["https://connect.facebook.net/en_US/fbevents.js"],
      negative: [
        "https://www.facebook.com/trending",
        "https://www.facebook.com/groups/tr",
      ],
    },
  },
  {
    id: "tiktok-pixel",
    name: "TikTok Pixel",
    category: "advertising",
    domains: ["tiktok.com"],
    path: /(?:^|\/)pixel(?:\/|$)/i,
    collection: /^(?!.*\.js$).*(?:^|\/)pixel(?:\/|$)/i,
    collectionSourced: false,
    criteria:
      "A tiktok.com request whose path contains a pixel segment. Ordinary tiktok.com pages and tiktokcdn.com content are not attributed.",
    sources: [],
    unverified: ["pixel path shapes (TikTok page fetched did not state them)"],
    examples: {
      observed: ["https://analytics.tiktok.com/api/v2/pixel"],
      inferred: ["https://analytics.tiktok.com/i18n/pixel/events.js"],
      negative: [
        "https://www.tiktok.com/@someone/video/1",
        "https://www.tiktok.com/events/foo",
      ],
    },
  },
  {
    id: "linkedin-insight",
    name: "LinkedIn Insight Tag",
    category: "advertising",
    domains: ["licdn.com", "linkedin.com"],
    path: /^\/(?:(?:collect|px)\/?$|(?:.*\/)?insight(?:\.min)?\.js$)/i,
    collection: /^\/(?:collect|px)\/?$/i,
    collectionSourced: false,
    criteria:
      "linkedin.com/collect or /px at the path root, or an insight.js script. Profile and CDN image paths are not attributed.",
    sources: [],
    unverified: ["collect and px endpoints", "insight.js file name"],
    examples: {
      observed: ["https://px.ads.linkedin.com/collect?pid=1"],
      inferred: ["https://snap.licdn.com/li.lms-analytics/insight.min.js"],
      negative: [
        "https://www.linkedin.com/in/px",
        "https://static.licdn.com/insights/x.png",
      ],
    },
  },
  {
    id: "microsoft-clarity",
    name: "Microsoft Clarity",
    category: "session-replay",
    domains: ["clarity.ms"],
    collection: /^\/collect\/?$/i,
    collectionSourced: false,
    criteria:
      "Any request to clarity.ms. A request does not show that a session recording was captured or what it contained.",
    sources: [
      {
        url: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup",
        verifiedOn: CHECKED,
        supports: "clarity.ms hosts the tracking script",
      },
    ],
    unverified: ["Collection hosts other than the script host"],
    examples: {
      observed: ["https://c.clarity.ms/collect"],
      inferred: ["https://www.clarity.ms/tag/abc"],
      negative: ["https://clarity.ms.example/collect"],
    },
  },
  {
    id: "plausible",
    name: "Plausible Analytics",
    category: "analytics",
    domains: ["plausible.io"],
    path: /^\/(?:api\/event|js\/)/i,
    collection: /^\/api\/event\/?$/i,
    collectionSourced: true,
    criteria:
      "plausible.io /api/event or /js/ paths. The plausible.io website itself is not attributed. Self-hosted instances are not recognized.",
    sources: [
      {
        url: "https://plausible.io/docs/events-api",
        verifiedOn: CHECKED,
        supports: "/api/event endpoint",
      },
    ],
    unverified: ["/js/ script path"],
    examples: {
      observed: ["https://plausible.io/api/event"],
      inferred: ["https://plausible.io/js/script.js"],
      negative: ["https://plausible.io/docs", "https://plausible.io/"],
    },
  },
  {
    id: "matomo",
    name: "Matomo",
    category: "analytics",
    domains: [],
    path: /(?:^|\/)(?:matomo|piwik)\.(?:js|php)\/?$/i,
    collection: /(?:^|\/)(?:matomo|piwik)\.php\/?$/i,
    collectionSourced: true,
    criteria:
      "Any host serving matomo/piwik .js or .php at the end of the path. File names can be reused by unrelated software.",
    sources: [
      {
        url: "https://developer.matomo.org/api-reference/tracking-api",
        verifiedOn: CHECKED,
        supports: "matomo.php tracking endpoint",
      },
    ],
    unverified: ["matomo.js and piwik.* legacy names"],
    examples: {
      observed: ["https://stats.example.org/matomo.php?idsite=1"],
      inferred: ["https://stats.example.org/piwik.js"],
      negative: ["https://stats.example.org/matomo-guide"],
    },
  },
];
