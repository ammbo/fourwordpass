# Search, sharing, and launch

## Implemented

Canonical origin: `https://fourwordpass.com`. The similarly named `forwardpass.com` is a separate site. Existing configured homonym domains keep their permanent redirects. HTTPS, known trailing-slash variants, and bill-serial casing normalize to canonical paths.

`shared/site.ts` owns page titles, descriptions, canonical URLs, Open Graph tags, large Twitter/X cards, image dimensions and alt text, and JSON-LD. The Vite template, Worker, and client navigation use this same source. Metadata is replaced, never appended as a second conflicting set.

The Worker returns readable public HTML for home, release, wild, story, privacy, terms, beta, and support pages. React replaces that content when JavaScript loads. This gives crawlers meaningful text and links without rendering JavaScript. Story HTML contains confirmed public contributions, the finale, and a labeled eulogy; it never includes emails, raw payout IDs, pending words, or capability tokens. HTML and JSON-LD escape user text.

Structured data includes WebSite, WebPage, WebApplication, visible FAQ content, breadcrumbs, and story CreativeWork records. Stories also expose `h-entry`, `p-name`, `u-url`, `dt-published`, and `e-content` microformats. Structured data does not guarantee a rich search result.

- `/robots.txt` points to the sitemap and excludes APIs, private email settings, and holder/creator token URLs. Robots rules are discovery guidance, not access control.
- `/sitemap.xml` is a dynamic sitemap index. `/sitemap-pages.xml` lists all seven public information and landing pages; `/sitemap-bills-N.xml` contains up to 1,000 genuine, nonempty stories per file. Confirmed contribution/ending timestamps supply story `lastmod` values. New stories appear automatically. Sitemap responses allow five minutes of caching.
- `/llms.txt` explains the app, beta status, public pages, content provenance, and private-link boundaries. It is an informational file, not a guarantee of AI discovery or a permission system.
- Private settings and token-bearing requests send `noindex, nofollow`. Demo histories and empty stories retain share previews but are excluded from indexing and the sitemap. Missing stories, unknown pages, and missing assets return HTTP 404. APIs send `X-Robots-Tag: noindex, nofollow`.
- HTML sends `no-store` and `Referrer-Policy: no-referrer`; rewritten template ETags and lengths are removed. Query strings are absent from canonical/share URLs. The browser manifest supplies bookmark icons and uses browser display mode; it does not advertise offline support.
- Marketing copy prominently identifies PayPal sandbox test money. The homepage FAQ and demo-counter label explain costs, word counting, AI's role, private email links, and simulated history.
- `/privacy`, `/terms`, `/beta`, and `/support` are linked from the footer, participation forms, and service emails. Their shared source is `shared/info.ts`. Participation forms require an unchecked adult/terms acknowledgement before submitting. Service emails set the Email Sending API's `replyTo` field to `support@fourwordpass.com`.

Brand assets and the image-generation prompt are documented in [brand-assets.md](brand-assets.md). Policy decisions and manual support procedures are in [policies-and-support.md](policies-and-support.md).

## Remaining launch work

1. Verify the domain in Google Search Console and Bing Webmaster Tools and submit `https://fourwordpass.com/sitemap.xml`. Check actual indexing after launch. Verification needs the owner's accounts or DNS access.
2. Check shared links in platform preview debuggers and request a cache refresh when necessary. Existing cached previews can outlive a deploy.
3. Before handling real money, implement and verify the PayPal production switch and review the operator identity, payment terms, privacy practices, retention plan, and support operations for that launch. The published policies describe the current sandbox and manual processes. Update the policies, beta copy, metadata, FAQ, llms.txt, and share artwork together when this changes.
4. Decide on analytics and campaign attribution. Track public-page visits and meaningful participation events, and strip holder/creator query tokens before collecting URLs. Do not treat the displayed demo-inclusive counters as acquisition or real participant metrics. No analytics vendor was added in this pass.
5. Check field performance and accessibility once there is real traffic. The build still reports a large MapLibre chunk; map code is already loaded dynamically. A broader performance audit should be driven by measured pages and devices.

## Validation

Run `npm test`, `npm run typecheck`, and `npm run build`. Local HTTP verification should cover every page, genuine and demo stories, private URLs, missing stories, sitemap children, images, and crawler-file MIME types. In the browser, verify title and metadata changes after navigation as well as on direct page loads.

## Deployment record

Deployed with the existing `npm run deploy` on October 8, 2026. Worker version: `221e1dd4-3ece-46a6-9ee7-a492951e2847`. Remote migrations reported none to apply. Local validation: 24 tests passed, TypeScript passed, production build passed, and `git diff --check` passed.

Production HTTP checks at approximately 18:33 UTC confirmed all seven public pages, unique titles/descriptions and canonicals, share-card metadata, parseable JSON-LD, policy/footer links, sandbox configuration, API/private-page indexing exclusions, crawler-file and asset MIME types, the matching 1200×630 OG image, and real 404 responses. Canonical-domain, trailing-slash, and serial-casing redirects also passed. The sitemap currently has one static-page child and zero eligible genuine stories; existing demo histories are deliberately excluded. Story sitemap pagination and genuine-story selection are covered by local tests. Browser checks confirmed the deployed beta guide; local browser checks verified policy navigation and the initially unchecked participation acknowledgement. These checks did not initiate payment, publish a contribution, or send a new email.
