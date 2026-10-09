# Devpost submission: Four Word Pass

Paste-ready answers for each field, in form order. Anything in `[brackets]` is yours to fill in or confirm. The "About the project" field is in a fenced block so you copy raw Markdown, not rendered text.

Deadline: **Nov 12, 2026, 3:00 pm ET**.

---

## Before you submit

- [x] MIT license added and committed.
- [ ] **Make the repo public.** `ammbo/fourwordpass` is private. The rules require a public repo with the license showing in GitHub's About sidebar.
- [ ] **Stock the wild** with plenty of bills before judging opens.
- [ ] **Watch the 14-day clock.** Bills in the wild are eulogized after 14 days unclaimed, and seeded bills are no exception. FWP-0002 (the featured bill) went back to the wild on Oct 8, so it dies Oct 22 if nobody claims it. Judging runs to Dec 21, so seed close to the deadline or re-seed during judging.
- [ ] **Sandbox buyer login for judges** goes in the testing instructions below (computer only; phones use the test card on the page).
- [ ] **Run a few real hops before recording**, so Open Books has real money on it (right now it shows the two payouts from the Oct 8 end-to-end test).
- [ ] Add the GitHub "About" description and website: *A real dollar travels hand to hand through PayPal. Each holder adds four words to its story.* · `https://fourwordpass.com`

---

# Public project page

## Project name

```text
Four Word Pass
```

## Elevator pitch (if the form asks for one, 200 characters max)

```text
A real dollar travels hand to hand through PayPal. Each holder adds exactly four words to the story it carries, then passes the buck. The bill keeps a diary.
```

## About the project

````markdown
## Inspiration

A dollar bill is the most-traveled object most of us ever hold, and it never tells you where it's been. [Where's George?](https://www.wheresgeorge.com) has had people logging bill serials since 1998. The surrealists played *exquisite corpse*, where each player adds to a work without seeing the whole. We wanted both at once: a real dollar that travels hand to hand and carries a story written by every hand it passes through.

PayPal makes that possible. You can't watch money move between strangers, but you can watch every payment you send. If the platform is the sender on every hop, every pass of the buck is a real, verifiable payment. Nobody has to trust that the dollar moved, because PayPal says so, and we can publish the books to prove it.

## What it does

**Four Word Pass** turns a $1 PayPal payment into a storytelling object.

1. **Release a buck for $2.** One dollar rides with the bill and one keeps the lights on. You write the first four words (*the Foreword*), then name the first holder by email or set the bill loose in the wild.
2. **Add four words.** Whoever holds the bill adds exactly four words that count. Little words like *the, a, to, of* ride free, so grammar still works. A live counter shows which words count. Stuck? AI suggests three continuations. It never writes for you.
3. **Pass the buck.** Name the next person, or release the bill to the wild for any stranger to claim. The platform sends them $1 through PayPal Payouts. **Your words join the story only when the payout lands.**

Holders need no account, no app and no PayPal login. A hop takes about sixty seconds.

Every bill also grows a life of its own:

- **A personality.** At mint, the bill gets a name, a voice and a few quirks.
- **A diary.** After every hop the bill writes a first-person entry about the new words and where it just was.
- **A passport.** Every hop prints a stamp with the city, date, serial, hop number and a small ink illustration.
- **The Passage.** A map traces the bill city to city.
- **Nags.** Sit on a bill and it gets needy at 24 hours, dramatic at 3 days, and theatrical at 7.
- **A eulogy.** After 14 days without moving, the bill is declared lost. It writes its own eulogy and closes the story with a short ending that is always labeled.
- **Forks.** Don't like where a story went? Fork it from any hop into a new bill and take it somewhere else. Bills keep a family tree.
- **Followers.** Anyone can follow a bill by email and hear when it moves, stalls or ends.

### Open Books

Because the platform takes every checkout and sends every payout itself, it can publish all of them. **[Open Books](https://fourwordpass.com/books)** is a live public ledger of every dollar in and out, built with **AG Grid** and **AG Charts**:

- **The ledger:** every $2 checkout and $1 payout, with the bill, the hop whose words rode on it, PayPal's status, a masked PayPal reference, how long it took to land, and whether a signed webhook or polling confirmed it. Sort it, filter it, search it, export it to CSV. Status cells flash when PayPal answers.
- **The charts:** money in vs. out by day, payouts by PayPal status, time to land, who wrote the words, and the bill's AI writing by model. Every chart and total is computed from the ledger's filtered rows, so filtering to one bill re-slices the whole page. Each bill page links to its own slice.
- **The words count too.** One chart shows what share of story words came from people (holders and creators' finales) versus a lost bill's labeled AI closing.

Emails never leave the server, and PayPal references are masked.

### AI is a character, not an author

Every word of the story comes from a person who held the buck. AI plays the bill: it names it, gives it a voice, keeps its diary, nags its holders, paints its stamps, and offers suggestions a human has to accept. Text reaches a story outside a holder's hop in only two ways. The creator writes the finale, or the bill writes its own ending when it dies. The bill's ending is always labeled, and it's capped at about 5% of the story:

$$ \text{closing words} = \min\big(12,\ \max(1,\ \lfloor 0.05 \cdot w \rfloor)\big) $$

where \\( w \\) is the number of content words in the story.

## How we built it

One Cloudflare Worker serves the React app and the API.

**PayPal**

- **Orders API v2 + the PayPal JavaScript SDK** take the $2 at mint and fork. The server creates the order, PayPal's buttons collect approval, and the server captures it and checks the amount and currency before it creates anything. Money comes in first, so if the capture fails, no bill exists.
- **Payouts API** moves $1 on every hop. The platform is the sender, the pass id doubles as `sender_batch_id` (PayPal rejects duplicates, so retries are free), and the payout note carries the serial and a link back to the bill.
- **Webhooks** (`PAYMENT.PAYOUTS-ITEM.*`) confirm delivery and are checked with PayPal's verify-webhook-signature API. Webhooks come first, with fast polling right after each payout and a once-a-minute cron as fallbacks. In sandbox, a payout lands in seconds.

**AI (Cloudflare Workers AI)**

- **Llama 3.3 70B** where someone is waiting: the bill's personality at mint, and four-word suggestions.
- **gpt-oss-120b** for background writing: the diary, the nags, the eulogy and its labeled closing.
- **FLUX.1 [schnell]** paints the ink illustration on each passport stamp.
- Every prompt is versioned, every output is validated against a Zod schema with structured JSON output, and every stored output records the model and prompt version that wrote it. Open Books charts those records.
- AI suggestions must pass the same four-word rule as human words, and each holder gets a limited number.
- The bill's writing runs after the money settles and has hand-written fallbacks, so a model outage never stalls a hop. The same prompts can also run on Claude if an Anthropic key is set.

**AG Grid and AG Charts**

- **AG Grid Community** runs the Open Books ledger: client-side row model, column and quick filters, pagination, CSV export, and cell-change flashing for live status updates. It's themed with the Theming API to match the site's paper-and-ink look.
- **AG Charts Community** draws bar and donut charts from the grid's filtered rows. The palette comes from the brand's inks, adjusted until it passed a colorblind-safety check.
- Only the modules in use are registered, and the page loads lazily so the rest of the app doesn't pay for it.

**Cloudflare and the frontend**

- **D1** holds state, **R2** stores stamp images, **Email Sending** delivers the bill's emails (the sender name is the bill's serial), **Email Routing** catches replies, `request.cf` gives city-level location, and a **cron trigger** runs the nag ladder, polling and deaths.
- **React 19, Vite, Tailwind CSS 4** and **MapLibre GL** for the map. Each banknote gets a unique spirograph rosette generated from its serial.
- **One rule, two places.** The four-word counter is a single TypeScript module that the browser uses for the live counter and the server uses for validation, with unit tests.

We built it with Claude Code as a pair programmer, working from a written PRD.

## Challenges we ran into

- **`UNCLAIMED` means success.** A payout to someone without a PayPal account comes back `UNCLAIMED`, not `SUCCESS`, and in sandbox that's every real email address. Waiting for `SUCCESS` would have stalled every story at its first stranger. `UNCLAIMED` counts as delivered. `FAILED`, `BLOCKED`, `DENIED`, `RETURNED` and the rest fail the pass, and the holder keeps their words and picks someone else.
- **Sandbox PayPal never emails real inboxes**, so the buzz in your pocket can't come from PayPal. The bill sends its own email with the link, and every hop shows a masked PayPal payout receipt (`PayPal sandbox payout ••••7QX2 · UNCLAIMED`) as proof the money moved.
- **The wild had no payout.** Releasing a bill to the wild pays nobody, so under "words land when the payout lands" those words could never land. The rule became *your words land when the bill leaves your hands successfully*: either a delivered payout, or a release to the wild, where the platform holds the dollar until a stranger claims it.
- **Webhook verification is byte-sensitive.** Re-serializing the parsed event can change it and break the signature check, so the raw body goes in verbatim.
- **Races everywhere.** Duplicate webhooks, a poll and a webhook arriving together, double clicks. Every state change is a conditional `UPDATE`, so the second one changes nothing.
- **Publishing the books without publishing people.** Open Books had to show every payment while revealing no one. The server builds a separate public projection with no emails, no internal ids and masked PayPal references.
- **Image models can't spell.** Stamps are crisp SVG with the city, date, serial and hop number, and the AI illustration is tinted into the middle. The model never draws text.
- **Secret links leak.** A holder link in the URL would leak through the `Referer` header to the map tile servers. Bill pages send `Referrer-Policy: no-referrer`, and the app moves the token out of the URL.
- **Counting to four is hard.** "and then the lights dimmed" has two content words, not four. We needed a stopword list, a cap on total words so nobody pads with stopwords, and the same counting in the browser and on the server.

## Accomplishments that we're proud of

- A full sandbox run: claim, payout `UNCLAIMED` in 18 seconds, the holder's email, four words from the emailed link, a second payout, and signed webhooks verified and matched. It's all on [Open Books](https://fourwordpass.com/books).
- The story never advances on a button click. It advances when PayPal says the money moved.
- The bill has a voice people want to screenshot, and it never writes the story.
- `forwordpass.com`, `forewordpass.com` and `forewardpass.com` all redirect home, because "four" is a homonym.

## What we learned

- Design the money flow around what PayPal actually reports, not what you hope it reports. `UNCLAIMED`, `RETURNED` and webhook retries shaped the product as much as the UI did.
- Being the sender of record is the trick. It's what makes every hop verifiable, and it's what lets us open the books.
- Give AI a role with limits. "Character, not author" made every prompt easier to write and every feature easier to explain.
- Ship a fallback for everything. Every AI call has one, and every payout has three ways to settle.

## What's next

- Production Payouts approval and a self-funding relay: each passer pays $1 in through Orders, and the next holder gets $1 out through Payouts. Open Books would then balance to the cent.
- A storybook view for finished stories.
- Badges for people who keep bills moving.
````

## Built with

Devpost takes these as separate tags (25 max). Here are 23:

```text
paypal
paypal-payouts-api
paypal-orders-api
paypal-javascript-sdk
paypal-webhooks
paypal-sandbox
workers-ai
llama-3.3
gpt-oss
flux
ag-grid
ag-charts
cloudflare-workers
cloudflare-d1
cloudflare-r2
cloudflare-email
typescript
react
vite
tailwindcss
hono
maplibre
claude-code
```

Optional extras for the last two slots: `zod`, `vitest`.

## "Try it out" links

```text
https://fourwordpass.com
```

```text
https://fourwordpass.com/books
```

```text
https://github.com/ammbo/fourwordpass
```

## Image gallery (3:2, 5 MB max, up to 15)

Shot list, in order. 1500×1000 works well.

1. The home hero with a banknote ("Passage of the Buck.").
2. A bill page: the story with the Foreword drop cap, plus the map. (FWP-0002, Wendell the Damp, reads well.)
3. The four-word counter rejecting "and then the lights dimmed" ("That's 2 content words. The buck demands four.").
4. AI suggestions open in the contribute panel.
5. The passport: a grid of stamps.
6. The diary in the bill's voice.
7. The PayPal sandbox checkout ($1 for the buck, $1 to keep the lights on).
8. A hop's payout receipt chip (`PayPal sandbox payout ••••XXXX · UNCLAIMED`).
9. **Open Books: stat tiles and the money chart.**
10. **Open Books: the ledger**, filtered to one bill.
11. **Open Books: the three donut and bar charts** (PayPal statuses, time to land, who wrote the words).
12. A nag email (Day 7).
13. A eulogized bill with its labeled closing (FWP-0001, Valentine the Crumpled).
14. A fork family tree.
15. A simple architecture diagram: Browser → Worker → PayPal Orders/Payouts/Webhooks, Workers AI, D1/R2/Email, Open Books.

## Video (YouTube, public or unlisted, under 3 minutes)

```text
[YouTube URL]
```

Run of show (adapted from PRD §20, adjusted for sandbox):

- **0:00** The pitch in one line: a real dollar, a story by strangers, four words at a time.
- **0:15** Release a buck on camera. Show the PayPal sandbox checkout and the bill's new personality.
- **0:40** The holder email arrives. Open the link with no signup. Type three words and get "The buck demands four." Take an AI suggestion and edit a word.
- **1:05** Pass it on. Show the payout receipt chip and the bill page updating live: story, map pin, diary entry, passport stamp.
- **1:30** Click "Its PayPal ledger." Open Books shows the $2 checkout and both $1 payouts for this bill, with PayPal's statuses and the verified webhook. Clear the filter to show the whole ledger and charts.
- **1:55** Claim a bill from the wild in a second browser.
- **2:10** Fork from an earlier hop and show the family tree.
- **2:25** A seeded long bill: the map lit up, the passport, a nag email, a eulogy with its labeled closing.
- **2:45** Close: "Every hop is a real PayPal payment. Every word is written by a person. And the books are open."

---

# Additional info (judges and organizers only)

## Upload a file

Optional. Skip it, or upload a PDF of the PRD (`pass-the-buck-prd.md`).

## Submitter Type

```text
Individual
```

[Switch to Team if anyone else worked on it.]

## Submitter Country of Residence

```text
[United States?]
```

## Province (Canada)

```text
N/A
```

## Organization Name

```text
N/A
```

## Is your project new, or did it exist before Oct 1, 2026 (9:15 am PT)?

```text
New
```

## If it existed before, explain…

```text
N/A. New project, built during the submission period. Bills labeled "Demo history" on the site carry simulated, backdated journeys to show what a long-running bill looks like. Their payments were simulated, and they're excluded from Open Books.
```

## Explain how your project meets the main technology requirement

```text
PayPal moves the money and AI plays the bill. Every hop of the story is a real PayPal sandbox payment, confirmed by PayPal before the story advances, and every payment is published on a public ledger.

PAYPAL
- Payouts API (/v1/payments/payouts): sends $1 to the next holder on every hop. The platform is the sender of record, so every hop is a payment we can verify. The pass id is the sender_batch_id, which makes retries idempotent. The payout note carries the bill's serial and a link back to its story.
- Webhooks (PAYMENT.PAYOUTS-ITEM.SUCCEEDED / UNCLAIMED / FAILED / BLOCKED / RETURNED and others), checked with the verify-webhook-signature API. A hop's words join the story only after PayPal confirms the payout. Fast polling of the payout status and a cron job are fallbacks.
- Orders API v2 (create + capture): the $2 to release or fork a bill. $1 funds the bill's first payout and $1 is the platform fee. The server checks the captured amount and currency before it creates anything.
- PayPal JavaScript SDK (Smart Payment Buttons): the checkout UI for the $2.
- OAuth 2.0 client credentials for server-to-server auth. Everything runs in the PayPal sandbox.
- Open Books (fourwordpass.com/books) publishes every checkout and payout with PayPal's status, a masked PayPal reference, time to land, and whether a signed webhook confirmed it.

AI (Cloudflare Workers AI)
- Llama 3.3 70B (@cf/meta/llama-3.3-70b-instruct-fp8-fast): invents each bill's personality (name, voice, quirks) at mint, and suggests four-word continuations when a holder asks. Suggestions must pass the same four-word rule, and a person has to accept them.
- gpt-oss-120b (@cf/openai/gpt-oss-120b): writes the bill's first-person diary entry after every hop, the escalating nag emails to holders who sit on it, and the eulogy plus a short, labeled closing when a bill is lost.
- FLUX.1 [schnell] (@cf/black-forest-labs/flux-1-schnell): paints the ink illustration in the middle of each passport stamp. The lettering is SVG, because image models garble text.
- All text generation uses structured JSON output validated with Zod, versioned prompts, and hand-written fallbacks. Every output records the model that wrote it, and Open Books charts those records. The same prompts can run on Claude (Anthropic API) if a key is set.

AI is a character, not an author. People write every word of the story. The only AI text in a story is a lost bill's closing, which is always labeled and capped at about 5% of the story.
```

## Which additional sponsor tool(s) did you use?

```text
AG Grid
```

## Public code repository URL

```text
https://github.com/ammbo/fourwordpass
```

## Working demo URL

```text
https://fourwordpass.com
```

## Testing instructions or credentials

```text
Live at https://fourwordpass.com, running on the PayPal sandbox. No account is needed to play.

1. HOLD A BUCK (free, about 60 seconds)
   - Go to https://fourwordpass.com/wild and claim a bill with an email address you can read.
   - The platform sends that address $1 through PayPal Payouts. Sandbox PayPal never emails real inboxes, so you won't hear from PayPal. Within a few seconds the payout settles as UNCLAIMED (PayPal's status for an address with no sandbox account), and the bill emails you its holder link from buck@fourwordpass.com.
   - Add your four words. Try "and then the lights dimmed" to see the counter reject it: only two of those words count. Tap "Suggest 4 words" for AI help.
   - Pass it to another email you own, or release it back to the wild. Then watch the bill page: your words land when the payout does, and the diary entry, map pin and passport stamp follow within a minute.

2. OPEN THE BOOKS
   - On any bill page, click "Its PayPal ledger", or go to https://fourwordpass.com/books. Your claim and pass are there with PayPal's status, a masked PayPal reference, time to land, and the verified webhook. Filter, sort, search or download the CSV; the charts follow the ledger's filters.

3. RELEASE A BUCK ($2, sandbox money)
   - Go to https://fourwordpass.com/release and write the first four words. Then pay one of two ways:
     a) On any device: choose "Debit or Credit Card" and use the PayPal sandbox test card shown on the page (it has copy buttons for every field).
     b) On a computer: choose "PayPal" and log in with this sandbox buyer account:
        Email: [SANDBOX BUYER EMAIL]
        Password: [SANDBOX BUYER PASSWORD]
     The PayPal button is hidden on phones: if the PayPal app is installed, it takes over the sandbox login and can't finish a sandbox payment.
   - You'll get a creator link by email, which lets you write the finale whenever you like. The $2 shows up in Open Books.

4. LOOK AROUND
   - Bills labeled "Demo history" have simulated history so you can see long journeys, full passports and a eulogy: FWP-0002 (Wendell the Damp) and FWP-0001 (Valentine the Crumpled).
   - Fork any bill from any hop with "Fork from here".

Run it locally: see the README. Mock PayPal mode runs the whole loop with no credentials.
```

## How would you rate your overall experience integrating PayPal? (1–10)

```text
[8]
```

## Why / additional feedback

Draft. Make it yours:

```text
Payouts is a great fit for a product where the platform has to be the sender of record. One API call per hop, idempotency via sender_batch_id, and webhooks gave us a clean, verifiable chain, clean enough that we publish the whole ledger. Orders v2 with the JS SDK buttons was straightforward.

What slowed us down:
- UNCLAIMED is the normal result for a payout to a real email in sandbox, but it's easy to assume SUCCESS is the happy path. Our spec gated the whole chain on SUCCESS and would have stalled every story at its first stranger. A line in the Payouts quickstart saying "treat UNCLAIMED as delivered, then handle RETURNED" would help.
- Sandbox never emails real inboxes. That's reasonable, but it means you can't demo the recipient's side without building your own notification.
- verify-webhook-signature needs the event embedded byte-for-byte, and re-serializing the parsed JSON breaks it. A raw-body example in the docs would save people time.
- Payouts has to be enabled on the sandbox app, which is easy to miss.
```

## Open to us contacting you for additional feedback?

```text
[Yes / No]
```

## APIMatic Context Plugin experience

```text
N/A
```

## AG Grid experience

Draft. Make it yours:

```text
We used AG Grid Community and AG Charts Community for Open Books (fourwordpass.com/books), a public ledger of every PayPal checkout and payout behind the app.

What worked well:
- The Theming API. themeQuartz.withParams matched our paper-and-ink brand with about a dozen params and no CSS overrides.
- Module registration kept the bundle honest: we registered only what we used. In development, the ValidationModule caught two modules we'd forgotten (LocaleModule for localeText, ClientSideRowModelApiModule for forEachNodeAfterFilter) and a v36.2 deprecation, each with the exact import to add. That saved real time.
- Grid-driven charts were easy. onModelUpdated plus forEachNodeAfterFilter gave us the filtered rows, and every chart and stat tile on the page recomputes from them, so filtering the ledger re-slices the whole dashboard.
- getRowId plus enableCellChangeFlash made live updates feel alive: when PayPal's status for a payout changes, the cell flashes in place.
- CSV export took one line.

What we'd improve:
- AG Charts is heavy for a single page. Lazy loading made it fine, but a lighter Community build would help.
- Donut inner labels quietly disappear when they don't fit the hole, which took some guesswork to diagnose.
```

## Eligibility checkboxes

Confirm all three yourself: age of majority, eligible jurisdiction, and not an employee or agent of PayPal, Devpost or any sponsor.
