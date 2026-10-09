# Devpost submission: Four Word Pass

Paste-ready answers for each field, in form order. Anything in `[brackets]` is yours to fill in or confirm. The "About the project" field is in a fenced block so you copy raw Markdown, not rendered text.

Deadline: **Nov 12, 2026, 12:00 pm PT / 3:00 pm ET**. Judging: **Dec 1–15, 2026**. Winners: around Dec 21.

Checked against the official rules, overview, FAQ and AG Grid sponsor page on Oct 9, 2026, and against the code and the live site.

---

## Requirements check

| Requirement (Official Rules §4) | Status | Where |
|---|---|---|
| Meaningfully uses a PayPal technology, in sandbox | Done | Orders v2, JS SDK buttons, Payouts, verified Webhooks |
| Meaningfully uses AI | Done | Workers AI: Llama 3.3 70B, gpt-oss-120b, FLUX.1 [schnell] |
| Working prototype | Done | https://fourwordpass.com |
| Text description of features | Done | "About the project" below |
| Functional demo judges can use | Done | Hosted URL, plus README with mock-PayPal local mode |
| Tools named and how they're used | Done | "Main technology requirement" field |
| Public repo, open-source license visible in About | **Not yet** | Repo is private. MIT is already detected |
| Repo has all source, assets, run instructions | Done | README "Run it locally" |
| YouTube video, **public**, under 3 min, shows it working on its device | **Not yet** | Unlisted doesn't meet "publicly visible" |
| No third-party trademarks or music without permission | Check at edit | Use YouTube Audio Library music or none |
| Free, unrestricted access until judging ends (Dec 15) | **Plan needed** | Wild bills die after 14 days. See below |
| New, or significantly updated after Oct 1 | Done | First commit Oct 8, 2026 |
| English | Done | |

## Before you submit

- [ ] **Make the repo public** and set its About: *A real dollar travels hand to hand through PayPal. Each holder adds four words to its story.* · `https://fourwordpass.com`. MIT is already detected, so the license shows once it's public.
- [ ] **Keep this file out of the public repo.** It's tracked (it went in with commit 4de561c), so making the repo public publishes it and its history. Nothing in it is secret today.
- [ ] **Give Open Books a real story.** Right now it shows 3 payouts and $0 in, and the "who wrote the words" and "AI by model" charts are empty, because seeded bills are left out of those charts. Start two or three stories through checkout, pass each through a few emails, and write one finale, so every chart has data before you record.
- [ ] **Stock the wild for judging, not just for the deadline.** A bill in the wild dies 14 days after it got there, and a claimer who never writes keeps it for 24 hours. Seeds made around Nov 10 die around Nov 24, a week before judging. Seed a batch on the morning of **Dec 1**, top it up around Dec 8, and keep 8 to 10 in the wild so a judge never finds it empty. FWP-0002 is the only bill there now; it was claimed and returned on Oct 9, so it dies around Oct 23.
- [ ] **Join the hackathon on Devpost** if you haven't. The submit form only appears for registered participants.
- [ ] **Upload the video as Public** on YouTube, under 3:00.
- [ ] **Decide on AG Studio** (see "AG Grid sponsor prize" at the end).

---

# Public project page

## Project name

```text
Four Word Pass
```

## Elevator pitch (200 characters max; this is 190)

```text
A real dollar travels stranger to stranger through PayPal. Each holder adds four words to the story it carries, then passes the buck. AI plays the bill, never the author. The books are open.
```

## About the project

````markdown
## Inspiration

A dollar bill is the most-traveled object most of us ever hold, and it never tells you where it's been. [Where's George?](https://www.wheresgeorge.com) has had people logging bill serials since 1998. The surrealists played *exquisite corpse*, where each player adds to a work without seeing the whole. We wanted both at once: a real dollar that travels hand to hand and carries a story written by every hand it passes through.

PayPal makes that possible. You can't watch money move between strangers, but you can watch every payment you send. If the platform is the sender on every hop, every pass of the buck is a real, verifiable payment. Nobody has to trust that the dollar moved, because PayPal says so, and we can publish the books to prove it.

## What it does

**Four Word Pass** turns a $1 PayPal payment into a storytelling object.

1. **Start a story for $2.** One dollar rides with the bill and one keeps the lights on. You write the first four words (*the Foreword*), then name the first holder by email or release the bill to *the wild*, a public page where any stranger can claim it.
2. **Add four words.** Whoever holds the bill adds exactly four words that count. Little words like *the, a, to, of* ride free, so grammar still works. A live counter shows which words count. Stuck? AI suggests three continuations. It never writes for you.
3. **Pass the buck.** Name the next person, or release the bill to the wild. The platform sends the next holder $1 through PayPal Payouts. **Your words join the story only when the payout lands.**

Joining a story is free. Holders need no account, no app and no PayPal login. A hop takes about a minute.

Every bill also grows a life of its own:

- **A personality.** At mint, the bill gets a name, a voice and a few quirks.
- **A diary.** After every hop the bill writes a first-person entry about the new words and where it just was.
- **A passport.** Every hop prints a stamp with the city, date, serial, hop number and a small ink illustration.
- **The Passage.** A map traces the bill city to city.
- **Nags.** Sit on a bill and it gets needy at 24 hours, dramatic at 3 days, and theatrical at 7.
- **Send it back.** Not for you? One link sends the bill back to whoever passed it to you, and they pick someone else. Their words stay in the story.
- **A eulogy.** After 14 days without moving, the bill is declared lost. It writes its own eulogy and closes the story with a short ending that is always labeled.
- **Forks.** Don't like where a story went? Fork it from any hop into a new bill and take it somewhere else. Bills keep a family tree.
- **Followers.** Anyone can follow a bill by email and hear when it moves, stalls or ends.

### Open Books

Because the platform takes every checkout and sends every payout itself, it can publish all of them. **[Open Books](https://fourwordpass.com/books)** is a live public ledger of every dollar in and out, built with **AG Grid** and **AG Charts**:

- **The ledger:** every $2 checkout and $1 payout, with the bill, the hop whose words rode on it, PayPal's status, a masked PayPal reference, how long it took to land, and whether a signed webhook or polling confirmed it. Sort it, filter it, search it, export it to CSV. Status cells flash when PayPal answers.
- **The charts:** money in vs. out by day, payouts by PayPal status, time to land, who wrote the words, and the bill's AI writing by model. Every chart and total is computed from the ledger's filtered rows, so filtering to one bill re-slices the whole page. Each bill page links to its own slice.
- **The words count too.** One chart shows what share of story words came from people (holders and creators' finales) versus a lost bill's labeled AI closing.

Emails never leave the server, and PayPal references are masked.

### PayPal moves the money. The AI reacts to it.

Every word of the story comes from a person who held the buck. AI plays the bill, and the bill reacts to what the money does:

- **A payout lands:** the bill writes a diary entry about the new words, and its passport gets a stamp painted for that city.
- **The money sits still:** the bill nags its holder, louder at 1, 3 and 7 days, and posts about it in its public diary.
- **The money stops for 14 days:** the bill writes its own eulogy.

The AI never moves money and never writes the story. It names the bill, gives it a voice, and offers word suggestions a person has to accept. Text reaches a story outside a holder's hop in only two ways: the creator writes the finale, or a lost bill writes its own ending. That ending is always labeled, and it's capped at about 5% of the story:

$$ \text{closing words} = \min\big(12,\ \max(1,\ \lfloor 0.05 \cdot w \rfloor)\big) $$

where \\( w \\) is the number of content words in the story.

## Who it's for, and why it matters

Payment apps treat money as plumbing. Four Word Pass treats a payment as something that can carry meaning, and that opens it up to people who'd never open a payments app for fun.

- **Friends and strangers who want a small, real reason to connect.** Joining is free, and starting a story costs $2. A story can be a gift to a friend in another city, a game for a group chat or a book club, or a message in a bottle for a stranger. An email link is the whole onboarding.
- **PayPal.** In production, every hop is a $1 payout to someone who may not have PayPal yet. That's an invitation with a dollar in it and a story attached, sent by someone who chose them. Each story is a chain of people meeting PayPal by getting paid.
- **Anyone who pays people and has to prove it.** Mutual aid funds, fundraisers, creator funds and marketplaces all get asked "did the money actually go out?" Open Books is a working answer. When the platform is the sender of record, it can publish every payment with PayPal's own status, confirmed by signed webhooks, without exposing anyone.

## How we built it

One Cloudflare Worker serves the React app and the API.

**PayPal**

- **Orders API v2 + the PayPal JavaScript SDK** take the $2 when a story starts or forks. The server creates the order, PayPal's buttons collect approval, and the server captures it and checks the amount and currency before it creates anything. Money comes in first, so if the capture fails, no bill exists.
- **Payouts API** moves $1 on every hop. The platform is the sender, the pass id doubles as `sender_batch_id` (PayPal rejects duplicates, so retries are free), and the payout note carries the serial and a link back to the bill.
- **Webhooks** (`PAYMENT.PAYOUTS-ITEM.*`) are checked with PayPal's verify-webhook-signature API. Three paths can settle a payout: a signed webhook, fast polling right after the payout, and a once-a-minute cron. The first one wins and the others change nothing. Open Books shows which path confirmed each payout and whether a verified webhook arrived. In sandbox, a payout lands in seconds.
- **Retries that can't pay twice.** If PayPal has a hiccup (a 5xx, a rate limit, an auth blip) when we create a payout, the pass stays in flight and retries with the same `sender_batch_id`. Only PayPal rejecting the request fails it, and anything still unsettled after two hours hands the bill back to its sender.

**AI (Cloudflare Workers AI)**

- **Llama 3.3 70B** where someone is waiting: the bill's personality at mint, and four-word suggestions.
- **gpt-oss-120b** for background writing: the diary, the nags, the eulogy and its labeled closing.
- **FLUX.1 [schnell]** paints the ink illustration on each passport stamp.
- Every prompt is versioned. Each output's shape is a Zod schema, sent to the model as JSON Schema, and every response is validated against it before it's stored. Every stored output records the model and prompt version that wrote it, and Open Books charts those records.
- AI suggestions must pass the same four-word rule as human words, and each holder gets five.
- The bill's writing runs after the money settles and has hand-written fallbacks, so a model outage never stalls a hop.

**AG Grid and AG Charts**

- **AG Grid Community** runs the Open Books ledger: client-side row model, custom cell renderers for bills and PayPal statuses, column and quick filters, pagination, CSV export, and cell-change flashing for live status updates. It's themed with the Theming API to match the site's paper-and-ink look.
- **AG Charts Community** draws bar and donut charts from the grid's filtered rows. The palette comes from the brand's inks, adjusted until it passed a colorblind-safety check.
- Only the modules in use are registered, and the page loads lazily so the rest of the app doesn't pay for it.

**Cloudflare and the frontend**

- **D1** holds state, **R2** stores stamp images, **Email Sending** delivers the bill's emails from Four Word Pass, **Email Routing** catches replies, `request.cf` gives city-level location, and a **cron trigger** runs the nag ladder, polling and deaths.
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
- **Real people bring real logins.** Shown a PayPal button, beta testers type their real PayPal password, which can't work in the sandbox, and on phones an installed PayPal app takes over the sandbox login and can't finish. Sandbox checkout shows only PayPal's card button, with a published sandbox test card and copy buttons.
- **Nobody could say no.** Someone named by a friend had to write four words to move the bill, or sit through three nags until it died. Now they can send it back, and it returns to the person who chose them.
- **Counting to four is hard.** "and then the lights dimmed" has two content words, not four. We needed a stopword list, a cap on total words so nobody pads with stopwords, and the same counting in the browser and on the server.

## Accomplishments that we're proud of

- A full sandbox run: claim, payout `UNCLAIMED` in 18 seconds, the holder's email, four words from the emailed link, a second payout, and signed webhooks verified and matched. It's all on [Open Books](https://fourwordpass.com/books).
- The story never advances on a button click. It advances when PayPal says the money moved.
- The bill has a voice people want to screenshot, and it never writes the story.
- It's a whole product, not a demo: it works on phones, has share cards, privacy and terms pages, and a support inbox.
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

Devpost takes these as separate tags (25 max). Here are all 25:

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
zod
vitest
claude-code
```

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

Shot list, in order. 1500×1000 works well. Shoot Open Books after it has real stories on it, so no chart is empty.

1. The home hero with a banknote ("Passage of the Buck.").
2. A bill page: the story with the Foreword drop cap, plus the map. (FWP-0002, Wendell the Damp, reads well.)
3. The four-word counter rejecting "and then the lights dimmed" ("That's 2 content words. The buck demands four.").
4. AI suggestions open in the contribute panel.
5. The passport: a grid of stamps.
6. The diary in the bill's voice.
7. The PayPal sandbox checkout with the test card ($1 for the buck, $1 to keep the lights on).
8. A hop's payout receipt chip (`PayPal sandbox payout ••••XXXX · UNCLAIMED`).
9. **Open Books: stat tiles and the money chart.**
10. **Open Books: the ledger**, filtered to one bill.
11. **Open Books: the donut and bar charts** (PayPal statuses, time to land, who wrote the words).
12. A nag email (Day 7).
13. A eulogized bill with its labeled closing (FWP-0001, Valentine the Crumpled).
14. A fork family tree.
15. A simple architecture diagram: Browser → Worker → PayPal Orders/Payouts/Webhooks, Workers AI, D1/R2/Email, Open Books.

## Video (YouTube, Public, under 3 minutes)

```text
[YouTube URL]
```

The Presentation criterion asks three things: what problem is solved, who it's for, and why it matters. Say all three in the first 20 seconds, then show it working end to end. Shoot the holder's part on a phone, since that's where the email lands. Use YouTube Audio Library music or none.

- **0:00** The hook: "Payment apps treat a dollar like plumbing. What if it carried a story?" One line on who it's for: friends and strangers who want a reason to connect, and anyone who pays people and has to prove it.
- **0:20** Start a story on a computer. Write the Foreword, pay with the sandbox test card, and meet the bill's new personality.
- **0:45** On a phone: the email arrives ("Someone passed you a story. Add four words."). Open the link with no signup. Type "and then the lights dimmed" and get "The buck demands four." Take an AI suggestion and edit a word.
- **1:10** Pass it on. Show the payout receipt chip and the bill page updating live: words, map pin, diary entry, passport stamp.
- **1:35** Click "Its PayPal ledger." Open Books shows the $2 checkout and the $1 payouts for this bill, with PayPal's statuses and the verified webhook. Clear the filter and watch the charts re-slice.
- **2:00** Claim a bill from the wild in a second browser.
- **2:15** Fork from an earlier hop and show the family tree.
- **2:30** A seeded long bill: the map lit up, the passport, a nag email, a eulogy with its labeled closing.
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
N/A. New project, first commit Oct 8, 2026. Bills labeled "Demo history" on the site carry simulated, backdated journeys to show what a long-running bill looks like. Their simulated payments never touched PayPal, so Open Books leaves them out.
```

## Explain how your project meets the main technology requirement

```text
PayPal moves the money and AI plays the bill. Every hop of the story is a real PayPal sandbox payment, confirmed by PayPal before the story advances, and every payment is published on a public ledger. The AI reacts to what the money does: a landed payout triggers the bill's diary entry and passport stamp, money that sits still triggers nags, and money that stops for 14 days triggers the eulogy.

PAYPAL
- Payouts API (/v1/payments/payouts): sends $1 to the next holder on every hop. The platform is the sender of record, so every hop is a payment we can verify. The pass id is the sender_batch_id, which makes retries idempotent: PayPal outages and rate limits are retried without risk of paying twice. The payout note carries the bill's serial and a link back to its story.
- Webhooks (PAYMENT.PAYOUTS-ITEM.SUCCEEDED / UNCLAIMED / FAILED / BLOCKED / RETURNED and others), checked with the verify-webhook-signature API. A hop's words join the story only after PayPal confirms the payout. A signed webhook, fast polling right after the payout, or a once-a-minute cron can settle it; the first one wins.
- Orders API v2 (create + capture): the $2 to start or fork a story. $1 funds the bill's first payout and $1 is the platform fee. The server checks the captured amount and currency before it creates anything.
- PayPal JavaScript SDK (Smart Payment Buttons): the checkout UI for the $2, shown as PayPal's card button with a published sandbox test card.
- OAuth 2.0 client credentials for server-to-server auth. Everything runs in the PayPal sandbox.
- Open Books (fourwordpass.com/books) publishes every checkout and payout with PayPal's status, a masked PayPal reference, time to land, and whether a signed webhook confirmed it.

AI (Cloudflare Workers AI)
- Llama 3.3 70B (@cf/meta/llama-3.3-70b-instruct-fp8-fast): invents each bill's personality (name, voice, quirks) at mint, and suggests four-word continuations when a holder asks. Suggestions must pass the same four-word rule, and a person has to accept them.
- gpt-oss-120b (@cf/openai/gpt-oss-120b): writes the bill's first-person diary entry after every hop, the escalating nag emails to holders who sit on it, and the eulogy plus a short, labeled closing when a bill is lost.
- FLUX.1 [schnell] (@cf/black-forest-labs/flux-1-schnell): paints the ink illustration in the middle of each passport stamp. The lettering is SVG, because image models garble text.
- Every output is validated against a Zod schema, with versioned prompts and hand-written fallbacks. Every output records the model that wrote it, and Open Books charts those records. The same prompts can run on Claude (Anthropic API) if a key is set.

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
Live at https://fourwordpass.com, running on the PayPal sandbox. No account is needed to play, and it works on phones and computers.

1. JOIN A STORY (free, about a minute)
   - Go to https://fourwordpass.com/wild, open a bill, and click "Claim this buck" with an email address you can read.
   - The platform sends that address $1 through PayPal Payouts. Sandbox PayPal never emails real inboxes, so you won't hear from PayPal. Within a few seconds the payout settles as UNCLAIMED (PayPal's status for an address with no sandbox account), and you get an email from Four Word Pass (buck@fourwordpass.com) with your holder link. Check spam if it's slow.
   - Add your four words. Try "and then the lights dimmed" to see the counter reject it: only two of those words count. Tap "Suggest 4 words" for AI help.
   - Pass it to another email you own, or release it back to the wild. Then watch the bill page: your words land when the payout does, and the diary entry, map pin and passport stamp follow within a minute.
   - A bill claimed from the wild gives you 24 hours to write. After that it wanders back to the wild for someone else.
   - Not for you? "Not for you? Send it back" at the bottom of the panel (and in every holder email) returns it to whoever passed it to you, and they pick someone else. Try it from the second email you passed it to.

2. OPEN THE BOOKS
   - On any bill page, click "Its PayPal ledger", or go to https://fourwordpass.com/books. Your claim and pass are there with PayPal's status, a masked PayPal reference, time to land, and the verified webhook. Filter, sort, search or download the CSV; the charts follow the ledger's filters.

3. START A STORY ($2, sandbox money)
   - Go to https://fourwordpass.com/release and write the first four words. Choose "Debit or Credit Card" and use the PayPal sandbox test card shown on the page (it has copy buttons for every field). It works on phones and computers.
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
- On a phone with the PayPal app installed, the app takes over the sandbox login and can't finish the payment. And beta testers who see a PayPal button type their real PayPal password. We ended up showing only the card button in sandbox.
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

---

# AG Grid sponsor prize: open decision

The AG Grid sponsor page (paypalaihackathon.devpost.com/details/aggrid) is about **AG Studio**, their embedded dashboard component, not the plain grid. It says the award "covers both what your dashboard looks like and how you build it," asks for "custom widgets, theming, and layout tools, not just AG Grid or AG Charts on their own," and invites entries to try the **Studio Agent Framework**. The Oct 12 webinar, "Build a payments dashboard without building a dashboard," is theirs.

Open Books qualifies, since the prize is open to entries that "use any AG Grid tools." But it's exactly the grid and charts on their own, so it's up against what the judges asked for.

- **Ship as is.** Lean on what's already there: Theming API branding, custom cell renderers, and a grid that cross-filters every chart.
- **Rebuild Open Books on AG Studio** with a Studio agent ("show me payouts that took over 30 seconds"). That also adds AI to the sponsor surface. Two catches: the free trial license lasts 45 days, so one started today expires Nov 23, before judging opens Dec 1. Ask the AG Grid team on the PayPal Discord about a license that runs through Dec 15, or start the trial after Oct 31. And AG Studio is commercial software in an MIT repo, which the rules allow but is worth a sentence in the README.
