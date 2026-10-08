import { INFO_PAGES } from "./info.ts";

/** Public brand and metadata. Never pass capability tokens or private bill fields here. */
export const SITE_URL = "https://fourwordpass.com";
export const SITE_NAME = "Four Word Pass";
export const SHARE_IMAGE = `${SITE_URL}/og-image.jpg`;
export const SHARE_IMAGE_ALT = "Four Word Pass. One dollar. Many strangers. One story. Add four words. Pass it on. Sandbox beta.";
export const BETA_NOTICE = "Sandbox beta: checkout and payouts use PayPal test money. No real money changes hands.";

export const FAQ = [
  { question: "What is Four Word Pass?", answer: "A collaborative storytelling game carried by a dollar. Each holder adds four words, then passes the buck to someone else. Follow the story, its map, its diary, and its passport stamps as it grows." },
  { question: "Which four words count?", answer: "You add exactly four content words. Small connecting words such as the, a, and, to, and of ride free. The word counter checks your line before you pass it on." },
  { question: "Does it cost anything to play?", answer: "Holders play free. Releasing or forking a buck is a $2 checkout: $1 travels with the story and $1 supports the platform. During the sandbox beta, checkout and payouts use PayPal test money; no real money changes hands." },
  { question: "Do I need an account or an app?", answer: "No Four Word Pass account or download is required. You read stories in your browser and use a private email link to contribute. Sandbox checkout requires a PayPal sandbox buyer account." },
  { question: "Does AI write the story?", answer: "People choose the story's four-word contributions. AI can offer suggestions and gives each bill a personality, diary, and illustrated passport stamps. If a bill stops moving for 14 days, it writes a labeled AI eulogy and a short closing." },
  { question: "What happens when a buck gets stuck?", answer: "A bill claimed from the wild returns there if its holder does not contribute within 24 hours. Bills send reminders as they wait. After 14 days without moving, the bill's journey ends with its eulogy." },
] as const;

export type PageMeta = {
  path: string;
  title: string;
  description: string;
  heading: string;
  noindex?: boolean;
  type?: "website" | "article";
  published?: string;
  modified?: string;
  schema?: Record<string, unknown>[];
};

export const PAGES: Record<string, PageMeta> = {
  "/": {
    path: "/",
    title: "Four Word Pass · A story by strangers, four words at a time",
    description: "One dollar. Many strangers. One story. Add four words, pass the buck, and follow its journey. Try the collaborative storytelling game in PayPal sandbox beta.",
    heading: "Passage of the Buck.",
  },
  "/release": {
    path: "/release",
    title: "Start a story · Release a buck · Four Word Pass",
    description: "Write the first four words. Give your buck a prompt, send it to a friend or the wild, and let strangers write what comes next. PayPal sandbox beta.",
    heading: "Write the foreword.",
  },
  "/wild": {
    path: "/wild",
    title: "Find a story to join · The wild · Four Word Pass",
    description: "Browse bucks waiting for their next writer. Read a story, claim a buck, add four words, and pass it on. Holders play free. PayPal sandbox beta.",
    heading: "Bucks nobody named.",
  },
  ...Object.fromEntries(Object.values(INFO_PAGES).map(({ path, title, heading, description }) => [path, { path, title, heading, description }])),
};

export function pageMeta(path: string): PageMeta {
  if (PAGES[path]) return PAGES[path];
  if (/^\/f\/[^/]+$/.test(path)) return {
    path, title: "Email preferences · Four Word Pass", description: "Manage your private email updates from Four Word Pass.", heading: "Your emails from this buck", noindex: true,
  };
  return { path, title: "Page not found · Four Word Pass", description: "This page got passed along. Find a story on Four Word Pass.", heading: "This page got passed along.", noindex: true };
}

export type StoryMeta = {
  serial: string;
  name: string;
  hopCount: number;
  teaser: string;
  createdAt: number;
  modifiedAt?: number;
  isSeed: boolean;
};

export function billMeta(bill: StoryMeta): PageMeta {
  const path = `/b/${bill.serial.toUpperCase()}`;
  const description = bill.teaser
    ? `“${bill.teaser.slice(0, 130)}” Follow ${bill.serial}, a story by strangers, four words at a time. Sandbox beta.${bill.isSeed ? " Demo history." : ""}`
    : "A buck waiting for its first chapter. Follow the journey and its story, four words at a time. PayPal sandbox beta.";
  return {
    path, title: `${bill.name} · ${bill.serial} · Four Word Pass`, description,
    heading: bill.name, type: "article", noindex: bill.isSeed || bill.hopCount === 0,
    published: new Date(bill.createdAt).toISOString(),
    modified: new Date(bill.modifiedAt ?? bill.createdAt).toISOString(),
    schema: [{
      "@type": "CreativeWork", "@id": `${SITE_URL}${path}#story`, url: `${SITE_URL}${path}`,
      name: bill.name, description, inLanguage: "en", genre: "Collaborative fiction",
      dateCreated: new Date(bill.createdAt).toISOString(),
      dateModified: new Date(bill.modifiedAt ?? bill.createdAt).toISOString(),
      isPartOf: { "@id": `${SITE_URL}/#website` },
    }],
  };
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function structuredData(meta: PageMeta) {
  const url = `${SITE_URL}${meta.path}`;
  const graph: Record<string, unknown>[] = [
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, inLanguage: "en", description: PAGES["/"].description },
    { "@type": "WebPage", "@id": `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: "en", isPartOf: { "@id": `${SITE_URL}/#website` }, primaryImageOfPage: { "@type": "ImageObject", url: SHARE_IMAGE, width: 1200, height: 630 } },
    ...(meta.schema ?? []),
  ];
  if (meta.path === "/") {
    graph.push({ "@type": "WebApplication", "@id": `${SITE_URL}/#app`, name: SITE_NAME, url: `${SITE_URL}/`, applicationCategory: "GameApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript for participation", description: PAGES["/"].description, image: SHARE_IMAGE });
    graph.push({ "@type": "FAQPage", "@id": `${SITE_URL}/#faq`, mainEntity: FAQ.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) });
  }
  if (meta.path !== "/" && !meta.noindex) graph.push({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: meta.heading, item: url },
  ] });
  return { "@context": "https://schema.org", "@graph": graph };
}

/** Shared by Vite's HTML template, the Worker, and client-side navigation. */
export function renderHead(meta: PageMeta) {
  const tag = (key: string, value: string, property = false) => `<meta data-seo ${property ? "property" : "name"}="${key}" content="${escapeHtml(value)}">`;
  return [
    `<title data-seo>${escapeHtml(meta.title)}</title>`,
    tag("description", meta.description),
    tag("robots", meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"),
    `<link data-seo rel="canonical" href="${escapeHtml(`${SITE_URL}${meta.path}`)}">`,
    tag("og:site_name", SITE_NAME, true), tag("og:locale", "en_US", true),
    tag("og:type", meta.type ?? "website", true), tag("og:title", meta.title, true),
    tag("og:description", meta.description, true), tag("og:url", `${SITE_URL}${meta.path}`, true),
    tag("og:image", SHARE_IMAGE, true), tag("og:image:secure_url", SHARE_IMAGE, true),
    tag("og:image:type", "image/jpeg", true), tag("og:image:width", "1200", true), tag("og:image:height", "630", true), tag("og:image:alt", SHARE_IMAGE_ALT, true),
    tag("twitter:card", "summary_large_image"), tag("twitter:title", meta.title), tag("twitter:description", meta.description), tag("twitter:image", SHARE_IMAGE), tag("twitter:image:alt", SHARE_IMAGE_ALT),
    ...(meta.published ? [tag("article:published_time", meta.published, true)] : []),
    ...(meta.modified ? [tag("article:modified_time", meta.modified, true)] : []),
    `<script data-seo type="application/ld+json">${safeJson(structuredData(meta))}</script>`,
  ].join("\n");
}
