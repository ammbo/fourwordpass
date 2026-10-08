# Four Word Pass

A dollar travels from person to person through PayPal. Every holder adds exactly four words to the story it carries, then passes the buck. The bill has a personality, keeps a diary, collects passport stamps, nags anyone who sits on it, and writes its own eulogy if it gets lost.

Live: **https://fourwordpass.com** · Spec: [pass-the-buck-prd.md](pass-the-buck-prd.md)

Brand assets, search metadata, crawler endpoints, and remaining launch checks: [SEO and launch](docs/seo-and-launch.md) · [Brand assets](docs/brand-assets.md).

The live site is a sandbox beta: payment amounts are test money, while public posts and app emails are real. Published privacy, terms, beta, and support pages are maintained together in `shared/info.ts`. See [Policies and support](docs/policies-and-support.md) for the operator's manual inbox and privacy-request procedures.

## PayPal, AI and AG Grid at a glance

- **PayPal (sandbox)** moves the money. **Orders API v2** with the **JavaScript SDK** buttons takes the $2 to release or fork a bill. The **Payouts API** sends $1 to the next holder on every hop. **Webhooks** (`PAYMENT.PAYOUTS-ITEM.*`, checked with verify-webhook-signature) confirm each payout before the story advances, with polling as a fallback. See [worker/paypal.ts](worker/paypal.ts).
- **AI** plays the bill, never the author. **Workers AI** runs Llama 3.3 70B (personality at mint, word suggestions), gpt-oss-120b (diary, nags, eulogy) and FLUX.1 [schnell] (passport stamp art). Claude takes over the writing if `ANTHROPIC_API_KEY` is set. See [worker/ai.ts](worker/ai.ts).
- **AG Grid + AG Charts** (Community, MIT) power **Open Books** at [/books](https://fourwordpass.com/books): a live public ledger of every PayPal checkout and payout, with charts that follow the ledger's filters. See [Open Books](#open-books).

## What changed from the PRD

The concept and the core loop are built as specified. These are the deliberate departures:

**Fixes (the PRD as written would have broken):**
1. **`UNCLAIMED` counts as delivered.** A payout to anyone without a PayPal account comes back `UNCLAIMED`, not `SUCCEEDED`. In sandbox that's every real email address. Gating on `SUCCEEDED` would stall every chain at its first stranger. `FAILED`, `BLOCKED`, `DENIED`, `RETURNED` and similar statuses fail the pass.
2. **Sandbox PayPal never emails real inboxes.** The demo beat "their phone buzzes twice" can't happen. Our own email is the notification, and each hop on the bill page shows a masked PayPal payout receipt (`PayPal sandbox payout ••••7QX2 · UNCLAIMED`) as proof the money moved.
3. **The wild had no payout, so its words could never confirm.** The rule is now: *your words land when the bill leaves your hands successfully*. That means either a confirmed payout to the next holder, or release into the wild (the platform holds the dollar). A claim triggers the payout, and **you hold the buck once your dollar lands.**
4. **Holder tokens in URLs would leak through the Referer header to map tiles.** Bill pages send `Referrer-Policy: no-referrer`, and the app moves the token from the URL into session storage.
5. The PRD's own example ("and then the lights dimmed" = 2 content words) needs `then` in the stopword list, so it's there.

**Simplified (cut for MVP; none of it appears in the demo):**
- **No accounts, magic links, profiles or handles.** Everything uses secret links: an HMAC holder link that rotates with every delivered payout, a creator link (your key to write the finale), and a follow link for managing or unsubscribing. Each hop can carry an optional pen name.
- **Cut:** courier score and leaderboard, next-holder matchmaking, photo notes, storybook page, chapter summaries.
- **The "AI writes the finale if the creator never responds" timer is gone.** One rule now: after 14 days without moving, the bill writes its eulogy and a labeled closing (≤5% of the story's words, max 12). Creators can end the story whenever they like.
- **Mint and fork failures don't strand the bill.** If the first payout fails, the creator's opening words land and the bill goes wild.

**Upgrades:**
- **Real PayPal sandbox Checkout** (Orders API) for the $2 mint and fork, not a fake button. Money comes in through PayPal and goes out through PayPal.
- **One Cloudflare Worker** serves the React app and API, with D1, R2, Workers AI (stamp art plus a text fallback), Cloudflare Email Sending (no Resend), `request.cf` for city-level location (no geo-IP service), and a cron for nags, polling and backfills.
- **Passport stamps** are crisp SVG (city, date, serial, hop number) with an AI ink illustration tinted into the middle. Image models garble text, so they never draw the lettering.
- **Fast polling** right after each payout, plus the webhook, plus a cron fallback. In sandbox the "watch it land" moment takes seconds.
- **Each bill gets a unique spirograph rosette** on its banknote, generated from its serial.
- **Open Books**, a public ledger of every dollar in and out (AG Grid + AG Charts). Being the sender of record on every payout is what makes it possible.

## Names and puns

One pun per surface, and each one has a job.

| Pun | Lives in | Job |
|---|---|---|
| **Four Word Pass** | name, the "4" logo, the URL | States the rule, and sounds like "forward pass" |
| **Passage of the Buck** | home hero headline, the bill's map ("The Passage") | The concept: a dollar's journey, and a passage of text |
| **Pass the buck** | the button you press, the hero subhead | The verb |
| **The Foreword** | the creator's first four words (drop cap on the story) | The arc: Foreword → Story → Finale (or Eulogy) |
| **Pay It ForWord** | story section, footer | The ethic |
| **Open Books** | the public ledger at `/books` | Transparency: the account books, and the story books |

"Four" is a homonym, so every spelling resolves: `forwordpass.com`, `forewordpass.com`, `forewardpass.com` and `www.` all 301 to `fourwordpass.com`, keeping the path.

## Architecture

```
worker/
  index.ts       routes (Hono), share-page meta tags, cron entry
  engine.ts      the lifecycle: mint/fork, passes, deliver/fail, contribute, claim, endings, nags
  paypal.ts      Payouts + Orders + webhook verification (and a mock for local dev)
  ai.ts          personality, diary, nags, suggestions, eulogy, stamps; prompts are versioned
  views.ts       public projections (emails, payout ids, ai_assisted never leave here)
  books.ts       Open Books: every checkout and payout, masked for the public ledger
  cron.ts        every minute: poll payouts, backfill side effects, wild returns, nag ladder, deaths
  admin.ts       seed demo bills, fast-forward time, feature, remove a hop
shared/words.ts  the four-word rule (used by the browser counter AND the server)
src/             React app: Home, Release, Wild, Bill page (story/map/diary/passport/fork tree), Open Books
migrations/      D1 schema
```

**Model:** a **pass** is $1 moving from the platform to a person, and a **hop** is four words. Every state change is a conditional `UPDATE`, so duplicate webhooks, racing polls and double clicks are no-ops. Hop index is assigned at confirmation. The only text that reaches a story outside a holder's hop goes through `writeCreatorFinale` (human) and `writeBillsOwnEnding` (AI, always labeled).

**AI:** Production runs on Workers AI: Llama 3.3 where someone is waiting (suggestions, personality at mint) and gpt-oss-120b for background writing (diary, nags, eulogy). With `ANTHROPIC_API_KEY` set, Claude (`claude-opus-5-5`, low effort, server-side refusal fallbacks) writes instead. Every output records its model and prompt version.

## Open Books

`/books` publishes every PayPal movement the platform has made. The platform takes every checkout and sends every payout itself, so it can show all of them.

- **The ledger (AG Grid):** one row per $2 checkout or $1 payout, with the bill, the hop whose words rode on it, PayPal's status, a masked PayPal reference, time to land, and whether a signed webhook or polling confirmed it. Sorting, column filters, quick search, pagination, CSV export, and cells that flash when PayPal's status changes. `?bill=FWP-0002` opens it filtered to one bill; every bill page links there.
- **The charts (AG Charts):** money in vs. out by day, payouts by PayPal status, time to land, who wrote the words (holders, creators' finales, and lost bills' labeled AI closings), and AI output by model. Every chart and stat tile is computed from the grid's filtered rows, so filtering the ledger re-slices the whole page.
- **Privacy:** `worker/books.ts` returns no emails and no internal ids. PayPal references are masked to their last four characters, the same as the receipts on bill pages. Seeded demo bills are left out, because their payments were simulated.
- **Weight:** the page and both libraries load lazily, so the rest of the app doesn't pay for them. Only the Community modules it uses are registered.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars        # mock PayPal, emails logged to D1 instead of sent
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

In mock mode payouts settle about 3s after creation. Any recipient containing `+fail` (e.g. `x+fail@example.com`) fails, which exercises the retry path. Emails land in the `emails` table, which you can view at `GET /api/admin/outbox` with `Authorization: Bearer dev-admin`.

```bash
npm test          # four-word rule, AI closing budget, moderation
npm run typecheck
```

## Deploy

```bash
npm run deploy    # build → remote D1 migrations → wrangler deploy
```

Production secrets (`TOKEN_SECRET`, `ADMIN_TOKEN`) are already set. A copy is in `.secrets.local`, which is gitignored. Email Sending is enabled for `fourwordpass.com`; mail comes from `buck@fourwordpass.com` with the bill's serial as the sender name.

## PayPal sandbox

**Live in sandbox as of Oct 8, 2026.** The client ID, secret and webhook ID are set as Worker secrets, and the webhook is registered for `https://fourwordpass.com/api/webhooks/paypal`. A real end-to-end run passed: claim → payout `UNCLAIMED` in ~17s → holder email received → contribute from the emailed link → second payout → signed webhook verified and matched.

Local dev stays on mock PayPal. Set `PAYPAL_MODE=sandbox` in `.dev.vars` to use real sandbox locally; webhooks can't reach localhost, but polling settles payouts anyway.

To set it up from scratch:

1. developer.paypal.com → Apps & Credentials → **Sandbox** → create an app, and make sure **Payouts** is ticked under its features.
2. Set the credentials and register the webhook:
   ```bash
   npx wrangler secret put PAYPAL_CLIENT_ID
   npx wrangler secret put PAYPAL_CLIENT_SECRET
   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/paypal-webhook.mjs
   npx wrangler secret put PAYPAL_WEBHOOK_ID      # paste the id it printed
   ```
3. Checkout needs a sandbox **personal** (buyer) account to pay the $2. Payouts come from your sandbox **business** account balance.

Optional: `npx wrangler secret put ANTHROPIC_API_KEY` for a noticeably better bill voice.

## Email

Outbound mail goes through Cloudflare Email Sending, from `buck@fourwordpass.com` with the bill's serial as the sender name and `support@fourwordpass.com` as Reply-To. Inbound mail to **any** `@fourwordpass.com` address is caught by Email Routing and stored by the Worker's `email()` handler. Read support messages with authenticated `GET /api/admin/inbox?to=support@fourwordpass.com`. Replies are manual; there is no automatic support response or inbox notification. The endpoint returns the latest 20 messages for the selected address. See [Policies and support](docs/policies-and-support.md) for operating procedures.

## Admin

Every admin call takes `Authorization: Bearer $ADMIN_TOKEN`.

| Call | Does |
|---|---|
| `POST /api/admin/seed {theme, hops, featured?, eulogize?, goal?, stamps?}` | Demo bill with simulated history, labeled "Demo history". It lands in the wild, so real people can claim it. |
| `POST /api/admin/age {serial, hours}` | Fast-forwards the holder's clock and runs cron. Use it to demo nags and death. |
| `POST /api/admin/end {serial}` | Eulogize now |
| `POST /api/admin/decorate {serial, stamps}` | Diary entries and stamps for a seeded bill |
| `POST /api/admin/feature {serial, featured}` | Feature on the home page |
| `POST /api/admin/remove-hop {serial, idx}` | Remove an abusive hop. The story recomputes and payout history stays. |
| `POST /api/admin/cron` · `GET /api/admin/outbox` · `GET /api/admin/inbox` | Run cron now · recent sent emails · received emails |

## Demo script notes (PRD §20)

- **0:30:** only *our* email arrives; sandbox PayPal sends nothing to real inboxes. Show the receipt chip on the hop instead, and the sandbox business account's activity if you want PayPal's own UI.
- **1:00:** the live counter shows free words as dashed chips and fills four slots. Typing "and then the lights dimmed" triggers "That's 2 content words. The buck demands four."
- **2:30:** to show nags, `POST /api/admin/age {"serial":"FWP-…","hours":170}` sends all three nags and the followers' stall ping.
- Seeded bills are labeled "Demo history". The live bill must be minted on camera.
- **Open Books:** after minting on camera, open `/books?bill=FWP-…` from the bill page. The $2 checkout and the $1 payout are already there, and the status cell flashes when PayPal answers.

## License

[MIT](LICENSE)
