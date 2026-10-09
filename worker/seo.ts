import { BETA_NOTICE, FAQ, PAGES, SITE_NAME, SITE_URL, billMeta, escapeHtml, pageMeta, renderHead, type PageMeta } from "../shared/site";
import { getBillBySerial, personalityOf } from "./db";
import { INFO_LINKS, INFO_PAGES, infoHtml } from "../shared/info";

type LinkBill = { serial: string; personality: string; is_seed: number };

/** Useful public HTML before JavaScript loads; React replaces it on startup. */
function publicHtml(meta: PageMeta, content: string) {
  return `<div style="max-width:68rem;margin:auto;padding:2rem 1rem;font-family:Georgia,serif;color:#17402f">
    <header><a href="/">${SITE_NAME}</a><nav aria-label="Main navigation" style="margin:1rem 0"><a href="/wild">The wild</a> · <a href="/release">Release a buck</a></nav></header>
    <main><h1>${escapeHtml(meta.heading)}</h1>${content}<p>${BETA_NOTICE}</p></main>
    <footer><a href="/">Home</a> · <a href="/wild">Find a story</a> · ${INFO_LINKS.map(({ path, label }) => `<a href="${path}">${label}</a>`).join(" · ")}</footer></div>`;
}

function billLinks(bills: LinkBill[]) {
  return `<ul>${bills.map((bill) => `<li><a href="/b/${encodeURIComponent(bill.serial)}">${escapeHtml(personalityOf(bill).name)} · ${escapeHtml(bill.serial)}</a>${bill.is_seed ? " · Demo history" : ""}</li>`).join("")}</ul>`;
}

export async function servePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (path !== trimmed && (PAGES[trimmed] || /^\/b\/[^/]+$/.test(trimmed))) return new Response(null, {
    status: 301, headers: { Location: `${trimmed}${url.search}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });
  let meta = pageMeta(path);
  let status = PAGES[path] || /^\/f\/[^/]+$/.test(path) ? 200 : 404;
  let content = `<p>${escapeHtml(meta.description)}</p><a href="/wild">Browse the wild</a>`;
  const match = path.match(/^\/b\/([^/]+)$/);
  if (match) {
    const bill = await getBillBySerial(env, match[1]);
    if (bill) {
      const canonicalPath = `/b/${bill.serial}`;
      if (path !== canonicalPath) return new Response(null, { status: 301, headers: { Location: `${canonicalPath}${url.search}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
      const { results: hops } = await env.DB.prepare("SELECT words, confirmed_at FROM hops WHERE bill_id = ? AND status = 'confirmed' ORDER BY idx ASC LIMIT 5000")
        .bind(bill.id).all<{ words: string; confirmed_at: number | null }>();
      const modifiedAt = Math.max(bill.created_at, bill.ended_at ?? 0, ...hops.map((h) => h.confirmed_at ?? 0));
      const name = personalityOf(bill).name;
      meta = billMeta({ serial: bill.serial, name, hopCount: bill.hop_count, teaser: hops.slice(-6).map((h) => h.words).join(" "), createdAt: bill.created_at, modifiedAt, isSeed: !!bill.is_seed });
      status = 200;
      content = `<article class="h-entry"><h2 class="p-name">${escapeHtml(name)}</h2>
        <p>${escapeHtml(bill.serial)} · ${bill.hop_count} hops${bill.is_seed ? " · Demo history (simulated)" : ""}</p>
        <a class="u-url" href="${SITE_URL}${meta.path}">Story permalink</a> · <time class="dt-published" datetime="${meta.published}">${new Date(bill.created_at).toISOString().slice(0, 10)}</time>
        <div class="e-content"><h3>The Story</h3><p>${hops.map((h) => escapeHtml(h.words)).join(" ") || "Waiting for its first four words."}</p>
        ${bill.finale_text ? `<h3>${bill.finale_by === "bill" ? "AI closing" : "The Finale"}</h3><p>${escapeHtml(bill.finale_text)}</p>` : ""}
        ${bill.eulogy ? `<h3>The Eulogy (AI)</h3><p>${escapeHtml(bill.eulogy)}</p>` : ""}</div>
        <p>Enable JavaScript to explore the map, diary, and passport or contribute to this story.</p></article>`;
    } else {
      meta = { ...meta, title: "Bill not found · Four Word Pass", heading: "No bill by that serial.", description: "Check the serial number or find another story in the wild.", noindex: true };
      content = `<p>${meta.description}</p><a href="/wild">Browse the wild</a>`;
    }
  } else if (path === "/" || path === "/wild") {
    const { results: bills } = await env.DB.prepare(path === "/wild"
      ? "SELECT serial, personality, is_seed FROM bills WHERE status = 'wild' ORDER BY follower_count DESC, wild_since DESC LIMIT 60"
      : "SELECT serial, personality, is_seed FROM bills ORDER BY featured DESC, created_at DESC LIMIT 12").all<LinkBill>();
    content = path === "/"
      ? `<p>Pass the buck. Write a story. Four words at a time.</p><p>A dollar travels from person to person through PayPal. Each holder adds exactly four words to the story it carries, then passes it on.</p>
         <p><a href="/release">Start a story · $2</a> · <a href="/wild">Join a story · free</a></p>
         <h2>How the buck moves</h2><ol><li>Write the foreword: release a buck and write its first four words.</li><li>Add four content words. Small connecting words ride free.</li><li>Pass the buck by email, or release it to the wild, a public list where any stranger can claim it.</li></ol>
         <p>There's no page limit. One buck could pass through ten thousand hands: forty thousand words by strangers who never met, four at a time.</p>
         <h2>Stories to follow</h2>${billLinks(bills)}<h2>A few words before you go</h2>${FAQ.map(({ question, answer }) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`).join("")}`
      : `<p>Read a story, claim a buck, and write what happens next. Holders play free.</p>${bills.length ? billLinks(bills) : `<p>The wild is quiet. <a href="/release">Release a buck</a> to start a story.</p>`}`;
  } else if (path === "/release") {
    content = `<p>Four words to start it. Strangers write the story. You write the finale.</p><p>Release a buck for $2 in sandbox test money: $1 travels with the story and $1 supports the platform. Give it a prompt and send it to a friend or the wild.</p><p>Enable JavaScript to use the word counter and sandbox checkout.</p>`;
  } else if (INFO_PAGES[path]) {
    content = infoHtml(INFO_PAGES[path]);
  }
  if (url.searchParams.has("t") || url.searchParams.has("c")) meta = { ...meta, noindex: true };

  const index = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!index.ok) return new Response("Page temporarily unavailable", { status: 503, headers: { "Retry-After": "60", "X-Robots-Tag": "noindex" } });
  const headers = new Headers(index.headers);
  // Rewritten HTML has a different representation from the asset template.
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  if (meta.noindex) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new HTMLRewriter()
    .on("[data-seo]", { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(renderHead(meta), { html: true }) })
    .on("#root", { element: (el) => void el.setInnerContent(publicHtml(meta, content), { html: true }) })
    .transform(new Response(index.body, { status, headers }));
}

export const SITEMAP_PAGE_SIZE = 1000;
const publicBills = "is_seed = 0 AND hop_count > 0";
const xmlResponse = (xml: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });

export async function serveSitemap(path: string, env: Env): Promise<Response> {
  if (path === "/sitemap.xml") {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bills WHERE ${publicBills}`).first<{ n: number }>();
    const files = ["sitemap-pages.xml", ...Array.from({ length: Math.ceil((row?.n ?? 0) / SITEMAP_PAGE_SIZE) }, (_, i) => `sitemap-bills-${i + 1}.xml`)];
    return xmlResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${SITE_URL}/${file}</loc></sitemap>`).join("")}</sitemapindex>`);
  }
  if (path === "/sitemap-pages.xml") return xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(PAGES).map((p) => `<url><loc>${SITE_URL}${p}</loc></url>`).join("")}</urlset>`);
  const match = path.match(/^\/sitemap-bills-([1-9]\d*)\.xml$/);
  const page = Number(match?.[1]);
  const offset = (page - 1) * SITEMAP_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) return new Response("Not found", { status: 404 });
  const { results } = await env.DB.prepare(`SELECT serial, MAX(created_at, COALESCE(ended_at, 0), COALESCE((SELECT MAX(confirmed_at) FROM hops WHERE bill_id = bills.id AND status = 'confirmed'), 0)) AS modified_at FROM bills WHERE ${publicBills} ORDER BY seq ASC LIMIT ? OFFSET ?`)
    .bind(SITEMAP_PAGE_SIZE, offset).all<{ serial: string; modified_at: number }>();
  if (!results.length) return new Response("Not found", { status: 404 });
  return xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${results.map((bill) => `<url><loc>${SITE_URL}/b/${escapeHtml(bill.serial)}</loc><lastmod>${new Date(bill.modified_at).toISOString()}</lastmod></url>`).join("")}</urlset>`);
}
