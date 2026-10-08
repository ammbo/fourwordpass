import { describe, expect, it } from "vitest";
import { FAQ, PAGES, SITE_URL, billMeta, pageMeta, renderHead, structuredData } from "../shared/site";
import { serveSitemap } from "../worker/seo";

describe("public page metadata", () => {
  it("gives each landing page a unique title, canonical, and full share card", () => {
    expect(new Set(Object.values(PAGES).map((m) => m.title)).size).toBe(Object.keys(PAGES).length);
    for (const meta of Object.values(PAGES)) {
      const head = renderHead(meta);
      expect(head).toContain(`rel="canonical" href="${SITE_URL}${meta.path}"`);
      expect(head).toContain('name="twitter:card" content="summary_large_image"');
      expect(head).toContain('property="og:image:width" content="1200"');
      expect((head.match(/name="description"/g) ?? []).length).toBe(1);
    }
  });

  it("keeps private email management and missing pages out of search", () => {
    expect(pageMeta("/f/private-id").noindex).toBe(true);
    expect(pageMeta("/missing").noindex).toBe(true);
  });

  it("uses the visible FAQ text verbatim in structured data", () => {
    const schema = structuredData(PAGES["/"])["@graph"].find((node) => node["@type"] === "FAQPage");
    expect(schema?.mainEntity).toEqual(FAQ.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })));
  });

  it("escapes user story text in attributes, titles, and JSON-LD", () => {
    const meta = billMeta({ serial: "FWP-0001", name: '</title><script>alert("x")</script>', teaser: '</script><script>alert("x")</script>', hopCount: 1, createdAt: 1, isSeed: false });
    const head = renderHead(meta);
    expect(head).not.toContain('<script>alert');
    expect(head).toContain("&lt;/title&gt;");
    const json = head.match(/<script data-seo type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    expect(json).toBeTruthy();
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json!)["@graph"].some((node: Record<string, unknown>) => node.name === meta.heading)).toBe(true);
  });

  it("indexes genuine stories while labeling and excluding simulated or empty histories", () => {
    const base = { serial: "fwp-0001", name: "Buck", teaser: "Four good words here", hopCount: 1, createdAt: 1, isSeed: false };
    expect(billMeta(base).noindex).toBe(false);
    expect(billMeta(base).path).toBe("/b/FWP-0001");
    expect(billMeta({ ...base, isSeed: true }).noindex).toBe(true);
    expect(billMeta({ ...base, isSeed: true }).description).toContain("Demo history");
    expect(billMeta({ ...base, hopCount: 0 }).noindex).toBe(true);
  });
});

function sitemapEnv(count: number, rows: { serial: string; modified_at: number }[] = []) {
  const queries: string[] = [];
  const binds: unknown[][] = [];
  const env = { DB: { prepare(query: string) {
    queries.push(query);
    return {
      first: async () => ({ n: count }),
      bind(...values: unknown[]) { binds.push(values); return { all: async () => ({ results: rows }) }; },
    };
  } } } as unknown as Env;
  return { env, queries, binds };
}

describe("sitemap discovery", () => {
  it("splits large story collections into bounded sitemap files", async () => {
    const { env, queries } = sitemapEnv(1001);
    const response = await serveSitemap("/sitemap.xml", env);
    const xml = await response.text();
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(xml).toContain("sitemap-bills-1.xml");
    expect(xml).toContain("sitemap-bills-2.xml");
    expect(xml).not.toContain("sitemap-bills-3.xml");
    expect(queries[0]).toContain("is_seed = 0 AND hop_count > 0");
  });

  it("does not publish empty story files for a site with only demo histories", async () => {
    const { env } = sitemapEnv(0);
    const xml = await (await serveSitemap("/sitemap.xml", env)).text();
    expect(xml).toContain("sitemap-pages.xml");
    expect(xml).not.toContain("sitemap-bills");
  });

  it("uses confirmed story timestamps and canonical token-free URLs", async () => {
    const { env, queries, binds } = sitemapEnv(1001, [{ serial: "FWP-1001", modified_at: 1000 }]);
    const xml = await (await serveSitemap("/sitemap-bills-2.xml", env)).text();
    expect(binds[0]).toEqual([1000, 1000]);
    expect(queries[0]).toContain("status = 'confirmed'");
    expect(xml).toContain(`${SITE_URL}/b/FWP-1001</loc>`);
    expect(xml).toContain("1970-01-01T00:00:01.000Z");
    expect(xml).not.toContain("?t=");
    expect(xml).not.toContain("?c=");
  });

  it("rejects invalid and empty sitemap page numbers", async () => {
    const { env } = sitemapEnv(0);
    for (const path of ["/sitemap-bills-0.xml", "/sitemap-bills-1.xml", "/sitemap-bills-99999999999999999999.xml"]) {
      expect((await serveSitemap(path, env)).status).toBe(404);
    }
  });

  it("serves numbered sitemap files through the actual Worker router", async () => {
    const { default: worker } = await import("../worker/index");
    const { env } = sitemapEnv(1, [{ serial: "FWP-0001", modified_at: 1000 }]);
    const response = await worker.fetch(new Request(`${SITE_URL}/sitemap-bills-1.xml`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(await response.text()).toContain(`${SITE_URL}/b/FWP-0001</loc>`);
  });

  it("redirects configured aliases while protecting capability-bearing URLs", async () => {
    const { default: worker } = await import("../worker/index");
    const { env } = sitemapEnv(0);
    const response = await worker.fetch(new Request("https://forwordpass.com/b/FWP-0001?t=private-test"), env);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(`${SITE_URL}/b/FWP-0001?t=private-test`);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
