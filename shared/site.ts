import type { PayPalMode } from "./types.ts";
import { paymentNotice } from "./payments.ts";
import { INFO_PAGES } from "./info.ts";

/** Public brand and metadata. Never pass capability tokens or private bill fields here. */
export const SITE_URL = "https://fourwordpass.com";
export const SITE_NAME = "Four Word Pass";
export const SHARE_IMAGE = `${SITE_URL}/og-image.jpg`;
export const SHARE_IMAGE_ALT = "Four Word Pass. One dollar. Many strangers. One story. Add four words. Pass it on.";
export const BETA_NOTICE = "Sandbox beta: checkout and payouts use PayPal test money. No real money changes hands.";

export const FAQ = [
  { question: "What is Four Word Pass?", answer: "A story written by strangers and carried by a dollar. The dollar moves from person to person through PayPal. Each holder adds four words to the story, then passes it on." },
  { question: "Why four words?", answer: "Enough to matter, few enough that anyone can write them in a minute. You add exactly four content words; small connecting words such as the, a, and, to, and of ride free, so grammar still works. The word counter checks your line before you pass it on." },
  { question: "Does it cost anything to play?", answer: "Joining a story is free: the dollar comes to you. Starting or forking a story is a $2 checkout: $1 travels with the story and $1 supports the platform. During the sandbox beta, checkout and payouts use PayPal test money; no real money changes hands." },
  { question: "What does “released to the wild” mean?", answer: "Instead of naming the next holder, you can release a buck to the wild. It waits on the public Wild page, and the first person to claim it gets the dollar and writes the next four words. If they don't write within 24 hours, it wanders back to the wild." },
  { question: "What if someone passes me a buck I don't want?", answer: "Send it back. Open the link in your email and choose “Not for you? Send it back.” It returns to whoever passed it to you, and they pick someone else. Their words stay in the story, and you won't hear from it again." },
  { question: "Do I need an account or an app?", answer: "No Four Word Pass account or download is required. You read stories in your browser, and a private email link is your key to write. Add a pen name if you want credit, or follow a story by email. Starting a story uses the PayPal sandbox test card shown at checkout, so you don't need a PayPal account either." },
  { question: "Does AI write the story?", answer: "No. People write the story. AI can suggest words, which you take or ignore, and it plays the bill: a personality, a diary, passport stamp art, and reminders. All of it is labeled and kept apart from the story. The only AI words that ever join a story are a labeled closing, written if a bill sits still for 14 days." },
  { question: "Why PayPal?", answer: "Because the dollar is how the story moves. Each pass is a PayPal payout to the next holder, so every hop has a PayPal receipt behind it, and every dollar in and out is public in the open books." },
  { question: "How does a story end?", answer: "When its creator says so: the person who started it writes the finale, up to twelve words. If a bill stops moving for 14 days, it writes its own eulogy instead. Don't like where a story went? Fork it from any earlier hop and take it somewhere else." },
] as const;

export function faqForMode(mode?: PayPalMode | null): {question: string; answer: string}[] {
  return FAQ.map(item => ({...item, answer: item.question === "Does it cost anything to play?"
    ? `Joining a story is free. Starting or forking a story uses a $2 checkout. ${paymentNotice(mode)}`
    : item.question === "Do I need an account or an app?"
      ? `No Four Word Pass account or download is required. A private email link is your key to write. ${mode === "sandbox" ? "Use the test card shown at checkout." : mode === "mock" ? "Demo checkout is simulated; no card is needed." : paymentNotice(mode)}`
      : item.answer}));
}

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
    description: "One dollar. Many strangers. One story. Add four words, pass the buck, and follow its journey. Try the collaborative storytelling game.",
    heading: "Passage of the Buck.",
  },
  "/release": {
    path: "/release",
    title: "Start a story · Release a buck · Four Word Pass",
    description: "Write the first four words. Give your buck a prompt, send it to a friend or the wild, and let strangers write what comes next.",
    heading: "Write the foreword.",
  },
  "/wild": {
    path: "/wild",
    title: "Find a story to join · The wild · Four Word Pass",
    description: "Browse bucks waiting for their next writer. Read a story, claim a buck, add four words, and pass it on. Holders play free.",
    heading: "Bucks nobody named.",
  },
  "/books": {
    path: "/books",
    title: "Open books · Every dollar in and out · Four Word Pass",
    description: "A live public ledger of every PayPal checkout and payout behind Four Word Pass, with statuses straight from PayPal. Emails private, references masked.",
    heading: "Every dollar, in and out.",
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
    ? `“${bill.teaser.slice(0, 130)}” Follow ${bill.serial}, a story by strangers, four words at a time.${bill.isSeed ? " Demo history." : ""}`
    : "A buck waiting for its first chapter. Follow the journey and its story, four words at a time.";
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

export function structuredData(meta: PageMeta, mode: PayPalMode | null = "sandbox") {
  const url = `${SITE_URL}${meta.path}`;
  const graph: Record<string, unknown>[] = [
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, inLanguage: "en", description: PAGES["/"].description },
    { "@type": "WebPage", "@id": `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: "en", isPartOf: { "@id": `${SITE_URL}/#website` }, primaryImageOfPage: { "@type": "ImageObject", url: SHARE_IMAGE, width: 1200, height: 630 } },
    ...(meta.schema ?? []),
  ];
  if (meta.path === "/") {
    graph.push({ "@type": "WebApplication", "@id": `${SITE_URL}/#app`, name: SITE_NAME, url: `${SITE_URL}/`, applicationCategory: "GameApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript for participation", description: PAGES["/"].description, image: SHARE_IMAGE });
    graph.push({ "@type": "FAQPage", "@id": `${SITE_URL}/#faq`, mainEntity: faqForMode(mode).map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) });
  }
  if (meta.path !== "/" && !meta.noindex) graph.push({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: meta.heading, item: url },
  ] });
  return { "@context": "https://schema.org", "@graph": graph };
}

/** Shared by Vite's HTML template, the Worker, and client-side navigation. */
export function renderHead(meta: PageMeta, mode: PayPalMode | null = "sandbox") {
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
    `<script data-seo type="application/ld+json">${safeJson(structuredData(meta, mode))}</script>`,
  ].join("\n");
}
