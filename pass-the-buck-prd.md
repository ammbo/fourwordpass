# Pass the Buck — Product Requirements Document

**Working title:** Pass the Buck
**Tagline options:** "Passage of the Buck" / "Pay It ForWord"
**One-liner:** A dollar travels from person to person through PayPal. Every holder adds exactly 4 words to a collaborative story, then passes it on. Follow the journey on a map, in a passport of stamps, and in a story written by strangers.

**Hackathon:** PayPal AI Hackathon (Devpost) — must meaningfully use PayPal + AI. Sandbox-first build.

**Document purpose:** This PRD is written to be fed directly to a coding agent. Build the MVP exactly as specified in sections marked MVP. Everything else is V2 unless noted.

---

## 1. Product overview

Pass the Buck turns a $1 PayPal payment into a storytelling object.

- A creator mints a **Bill** (a story instance) for $2. $1 funds the bill's first payout. $1 is platform revenue.
- The bill is sent to a recipient via PayPal Payouts API. The recipient does not need an account, does not OAuth PayPal, and does not install anything.
- The recipient opens a link, adds **4 words** to the story, then chooses the next holder (by email) or releases the bill **to the wild** for anyone to claim.
- Every hop is a real $1 PayPal transaction initiated by the platform backend. The platform is always the sender of record, which makes every hop verifiable via webhook.
- Each bill accumulates:
  - **The Story** — the concatenated 4-word contributions, in order
  - **The Diary** — AI-written first-person narration by the bill itself, reacting to each hop
  - **The Passport** — a visual stamp per hop (city, date, generated illustration)
  - **The Map** — geographic trail of where the bill has been

Stories are human-written. AI suggests, narrates, nags, and illustrates. AI does not write the story.

---

## 2. Goals and non-goals

### Goals (MVP)

- **Viral loop** — receiving a bill must take under 60 seconds to contribute and pass. No signup required to participate.
- **PayPal is load-bearing** — money actually moves on every hop via Payouts API, confirmed by webhook before the chain advances.
- **AI is character, not author** — AI gives the bill a personality, writes its diary, nags stalled holders, generates passport stamps, and suggests next words on request.
- **Shareable artifacts** — every bill has a public page (story + map + passport) worth screenshotting and sharing.

### Non-goals (MVP)

- No native mobile apps. Mobile web only.
- No real-money production payouts. Sandbox only. Production requires PayPal Payouts approval, which is out of scope for the hackathon.
- No OAuth with PayPal for participants. Only the operator holds API credentials.
- No marketplace, no tipping, no multi-currency. USD $1 only.
- No AI-written story content by default (see Section 9 for the narrow exceptions).

---

## 3. Naming

- **Product name:** Pass the Buck. Decide the domain based on availability (candidates: `passthebuck.app`, `passthebuck.com`, `passthebk.com` — check before launch).
- **Headline:** "Passage of the Buck" — use as the hero headline / bill-page subtitle. Plays on "passage of the book."
- **Alt headline:** "Pay It ForWord" — use on the story view specifically, since every bill carries a foreword written by strangers. Foreword = the opening of a book. This is the one-line pitch for the story mechanic.

Do not rename the product to either headline. Product = Pass the Buck. Headlines rotate.

---

## 4. Core concepts

| Term | Meaning |
|---|---|
| Bill | A single traveling $1 and its story. Has a serial number, e.g. TRV-0042. |
| Hop | One contribution: 4 words added + payout to next holder confirmed. |
| Holder | The person who currently has the bill and owes the story 4 words. |
| Mint | Creating a new bill. Costs $2 (see Section 12). |
| Fork | Creating a new bill that starts from an earlier point in an existing story. Costs $2. |
| Wild pool | Bills released with no named recipient. First visitor to claim becomes holder. |
| Passport | Collection of stamps, one per hop, shown on the bill page. |
| Diary | AI-generated first-person log by the bill, updated per hop. |
| Courier score | Single public number per signed-up user: speed + volume + completions. |

---

## 5. The 4-word rule

Every contribution is **exactly 4 content words**.

### Counting rules

- Normalize input: trim, collapse whitespace, strip surrounding punctuation for counting (punctuation may be kept for display).
- Split on whitespace. Hyphenated words count as one word.
- **Stopwords do not count toward the 4.** Maintained list (configurable in code): `the, a, an, and, or, but, to, of, in, on, at, for, with, by, from, as, is, was, are, were, be, been, it, its, this, that`.
  - Rationale: one-word mode died on articles. Stopword exemption forces a real thought while allowing natural grammar. Example: "the robot learned to dream tonight" has 4 content words (robot, learned, dream, tonight) and passes; "and then the lights dimmed" has 2 (lights, dimmed) and must be rejected with a helpful message.
  - Cap total raw words at 8 to prevent stopword stuffing.
- Validation error copy: "That's {n} content words. The buck demands four." Show the live content-word count as the user types.
- Profanity / abuse filter on contributions. Reject and allow retry; never silently alter a user's words.

### Why not 1 word, why not a sentence

- 1 word produces articles and conjunctions; the story stalls semantically.
- A full sentence lets one person dominate tone and length; 4 words keeps every contribution a 10-second task and the story democratic.
- 4 words carries the pun: "Pay It **For**Word" / paying it forward, four words at a time.

---

## 6. Money flow and PayPal architecture

This section answers the monitoring question directly: **you cannot observe transactions between unrelated third parties on PayPal**, and the product must never try. Instead, the platform is the sender on every hop.

### 6.1 Principle: be the rails, not a bystander

- Only the operator (the app backend) holds PayPal API credentials (client ID + secret, sandbox for MVP).
- Every payout is initiated by the backend via the **PayPal Payouts API**. The recipient is identified by email address only.
- Recipients never authenticate with PayPal inside this product. Receiving $1 requires only a PayPal account matching that email, which PayPal itself handles (PayPal emails them; if they have no account, PayPal prompts them to create one to claim — that is PayPal's flow, not ours).
- Because every hop is our API call, we observe everything: payout ID, status, recipient, timestamp. No scraping, no feed, no permissions problem.

### 6.2 Hop sequence (must implement exactly)

1. Holder submits 4 words + next recipient email (or chooses "release to the wild").
2. Backend validates words, creates a Hop record in `pending_payout` state. Story does NOT advance yet.
3. Backend calls Payouts API: amount $1.00 USD, recipient email, `sender_item_id` = hop ID, note field (Section 6.4).
4. PayPal webhook `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` arrives → hop becomes `confirmed`, words append to the story, passport stamp mints, diary entry generates, followers notified, new holder's contribution link activates.
5. On `PAYMENT.PAYOUTS-ITEM.FAILED` or `BLOCKED` → hop becomes `failed`, holder is notified and can retry or pick a different recipient. Story never advances on an unconfirmed payout.
6. If no webhook within a timeout (e.g. 15 minutes), poll the payout batch status as fallback. Webhook is primary.

**Rule:** the chain advances on webhook confirmation only. Never on button click.

### 6.3 Funding model

- **MVP (sandbox):** test money. Orders captures a $2 sandbox mint/fork checkout; one sandbox business account funds each later test payout. Explicit mock mode simulates both APIs.
- **Proposed production model (not implemented):** see "Paid Four Word" in Section 18. Passing is free; each bill carries one standing $1 cash-out offer paid from platform funds; only the creator can revive a cashed-out bill, for $2. Per-hop live transfers are not economically viable at this amount. Live checkout and new payouts remain gated until this is implemented. The earlier per-hop collection/relay proposal is superseded.
- Note in README: production Payouts requires PayPal approval for the Payouts feature. Sandbox is unrestricted.

### 6.4 The PayPal transaction note

The payout `note` field should carry:

```
TRV-0042 is yours. {N} strangers are writing its story.
Add your 4 words: {short_url}
```

- Include the serial number and a short URL to the bill's contribution page (`/b/{serial}`).
- Do NOT rely on PayPal rendering the URL as clickable in its "you've got money" email. It usually displays as text; some clients auto-link. Treat PayPal's email as the backup notification.
- The primary CTA is our own email (via Resend, Section 10) sent the moment the webhook confirms the payout. That email has the real button.
- Also include the note text fallback: if the recipient only ever sees PayPal's email, the serial + URL must be enough to continue.

### 6.5 Claim links

- Contribution links are signed, unguessable tokens: `/b/{serial}?t={token}`. Token is single-bill, holder-scoped, and rotates after each hop.
- A link works without any account. If the visitor later signs up, their anonymous hops can be claimed to their profile (match by the email the payout was sent to, after magic-link verification).

---

## 7. User flows

### 7.1 Mint a bill (creator)

1. User clicks "Release a buck." Signup optional; require an email (for the creator's finale rights, Section 9) and a payment method in production; in sandbox, a fake checkout button.
2. User picks: starting city (default: browser geolocation, editable), optional opening prompt/theme ("a story about a robot learning to dream"), and optionally a target hop goal (display only, see Section 8.3). No hop limit is enforced.
3. Bill is created: serial number assigned, AI generates the bill's personality, first payout fires to the first recipient (email entered by creator) or into the wild pool.
4. Creator gets a share link + the bill page. Creator automatically follows the bill with "every hop" notifications.

### 7.2 Receive and contribute (holder) — the core loop

1. Recipient gets PayPal's payment email + our Resend email: "TRV-0042 is yours. 12 strangers are writing its story."
2. Link opens the bill page in contribution mode: story so far (scrollable), map, diary excerpt, big input: "Add your 4 words."
3. Live counter shows content words as they type. Two optional AI helpers (Section 9.2): "Suggest 4 words" (a few one-tap options) — using a suggestion still counts as the holder's contribution; the holder taps to accept.
4. Holder enters next recipient email, or taps "Release to the wild."
5. Optional: holder adds a note (short text and/or a photo) attached to the hop. Notes feed the diary and passport. Notes are not part of the 4-word story.
6. Submit → backend runs Section 6.2. Holder sees "Sent. TRV-0042 is on its way." and a prompt to follow the bill (email capture if anonymous) and share.

### 7.3 Claim from the wild

1. `/wild` lists claimable bills: serial, story teaser (last 12 words), city, age, follower count.
2. First visitor to click "Claim" becomes holder: the $1 payout fires to the email they enter. (In sandbox, payout to their provided PayPal email.)
3. They then contribute per 7.2. Claiming without contributing within 24h returns the bill to the wild pool (no penalty; the nag system applies while they hold it).

### 7.4 Follow a bill

- Anyone can follow from a bill page with just an email (no account needed), or one click if signed in.
- Notification preference at follow time (Section 11): **every hop** or **only when it ends** (finale or eulogy). Default: only when it ends (protects against inbox fatigue; every-hop is opt-in enthusiasm).

### 7.5 Fork a story

1. On any bill page, every hop in the story timeline has a "Fork from here" action.
2. Forking costs $2 (production; sandbox: simulated). $1 platform fee, $1 funds the new bill's first payout.
3. The new bill copies the story text up to the fork point, records `forked_from_bill_id` + `forked_at_hop_index`, and gets its own serial number.
4. Forks are displayed as a family tree on both bills' pages ("This story forked 3 ways at word 48"). Multiple endings are a feature: divergent branches each pursue their own finale.
5. The forker becomes the new bill's creator (with finale rights for that branch).

---

## 8. Bill lifecycle

### 8.1 States

- `active` — a holder owes 4 words (or a payout is pending)
- `in_transit` — payout initiated, awaiting webhook
- `complete` — creator wrote the finale (Section 9.3)
- `eulogized` — stalled past the death threshold; closed with eulogy (Section 9.4)
- `wild` — sub-state of active: no named holder, claimable

### 8.2 No hop limit

- Stories have **no enforced hop limit**. A 10,000-hop, 40,000-content-word story is the dream outcome, not an edge case. Design pagination and story rendering for very long stories (virtualized scroll, chapter breaks every 100 hops generated from diary summaries — display only, not story text).
- The bill creator may set an optional **goal** (e.g. "help this story reach 50 hops"). Goals are display + motivation only. Hitting a goal prompts the finale flow; it does not auto-end the story.
- **Admin-only mega-bills:** an `is_admin_minted` flag allows operator-minted bills (e.g. "The Great American Novel — 10,000 hops") with special framing on their pages. Regular users can also create unbounded stories, but only admin bills get the featured placement.

### 8.3 Stall handling and the nag system

The bill has a voice. Use it.

- **24h with no contribution:** first nag to the holder (email + on-page if they return). Polite, in the bill's personality. Example register: "Day 1 in your pocket, {name}. Warm in here. Just need 4 words."
- **72h:** second nag, escalating. Diary publicly notes the stall ("TRV-0042 has not moved in 3 days. Send snacks.").
- **7 days:** final nag, full guilt trip. Followers (every-hop subscribers) get a "stalled" ping — social pressure is the enforcement mechanism.
- **14 days:** bill is declared stalled-dead → eulogy flow (Section 9.4). The $1 stays with the last holder; do not attempt recovery. The story closes cleanly instead of rotting.

Nags must be screenshot-worthy. Personality-driven, never generic "reminder" copy. Each bill's personality (generated at mint) controls nag tone.

### 8.4 The map and contributor highlighting

- Bill page shows a map of hop origins (city-level only, from holder-provided or IP-derived location with consent; never expose precise location).
- Story view: **hovering (or tapping) a contributor highlights their 4 words** in the story text and spotlights their pin on the map. Reverse also works: hovering a map pin highlights that hop's words. This is the "who touched this story, where" moment — make it delightful.
- Anonymous contributors show as their anonymized handle (Section 10.2) or "A stranger in {city}".

---

## 9. AI specification

**Prime directive: stories are human-written.** AI is narrator, coach, and illustrator — never ghostwriter. Any AI-generated prose must be visually labeled as the bill's voice (diary, nags, eulogy), never blended into the story text.

### 9.1 Bill personality (at mint)

- Generate: a name-like persona ("a restless dollar with a coffee problem"), a voice profile (tone keywords), and a diary style.
- Personality drives: diary entries, nag copy, eulogy tone, and matchmaking suggestions.
- Store the personality prompt on the bill record; every AI call for that bill includes it.

### 9.2 Next-4-words suggestions (holder assist)

- On request ("Suggest 4 words"), return 3 one-tap options. Each option is exactly 4 content words that continue the story plausibly.
- Holder taps to accept, edits freely, or ignores. Accepted suggestions are indistinguishable in the story (the holder chose them) but log an `ai_assisted: true` flag internally for product analytics. Do not mark them publicly.
- Rate-limit suggestions (e.g. 5 generations per hop) to control cost and preserve human authorship.

### 9.3 Endings and finales

Stories must be wrappable without becoming AI-written:

1. **Creator finale (primary path):** when a bill hits its goal, or the creator chooses "End this story," the finale returns to the **person who minted it** (or the forker, for a branch). The creator writes the closing contribution — allow a longer final segment (e.g. up to 12 content words, clearly the finale block) so they can actually land the ending. The UI offers AI finale **suggestions** (a few tight closing options), but the creator picks, edits, or writes their own. A human makes the final call.
2. **No creator available:** if the creator is unreachable (no response in 14 days after a finale prompt, or anonymous with no email), AI writes the finale **as tightly and briefly as possible** — a single short closing segment, publicly labeled: "The buck wrote its own ending (its creator never came back)." This is the only fully AI-written story text allowed, it must be rare, and it must be disclosed on the page.
3. **Hop-count framing:** the finale UI shows how close the story came to its goal ("47 of 50 hops"). Completed-at-goal and ended-early are both honorable endings.

### 9.4 Eulogies (stalled bills)

When a bill dies (Section 8.3):

1. AI writes a **eulogy** in the bill's voice: where it was born, highlights of its journey, where it was last seen, and the fact that it did not reach its goal (if it had one). Example register: "TRV-0042 was last seen in Austin, in the hands of someone who really needed coffee. It dreamed of 50 hops. It made 23. Pour one out."
2. To avoid a graveyard of half-written stories, AI then writes a **brief closing** for the story itself — as short as possible (target: one closing segment, finale-length or less), explicitly labeled on the page as the buck's own ending, visually distinct from human contributions.
3. The bill state becomes `eulogized`. The story + eulogy + closing remain a permanent, shareable artifact. Followers with "when it ends" preference get this notification. This is the only other place AI writes story-adjacent text, and the labeling rule applies.

**Anti-slop rule:** combined AI-written story text (finale fallback + eulogy closing) must be a small fraction of any bill's story. If the AI closing would exceed ~5% of the story's content words, trim it. AI endings exist so no story is left dangling — not to write stories.

### 9.5 Diary

- After each confirmed hop, generate a 1–3 sentence first-person diary entry from: the 4 new words, holder's note, city, hop count, story excerpt, and bill personality.
- Diary entries are dated and stamped ("Day 3 — Nashville"). They are the bill's social content; optimize for quotability.
- Diary never alters or paraphrases story text into itself as if human-written. It reacts; it does not author.

### 9.6 Passport stamps

- Each confirmed hop mints a stamp: city, date, serial, and a small AI-generated illustration (image model) seeded by the hop's note/city/story words.
- Stamps are collectible: a user's profile (if signed up) shows every stamp they've earned as a holder. Bill pages show the full passport grid.
- Generate stamps asynchronously; the hop must not block on image generation. Placeholder stamp → swap in when ready.

### 9.7 Next-holder matchmaking

- Optional assist on the pass screen: given the story's recent themes and the bill's personality, suggest a *type* of next holder ("this story has been to four coffee shops — find a musician next"). Suggest archetypes and, if the holder starts typing an email of a past contributor, surface "send it back to {handle}?"
- AI never chooses the recipient autonomously in MVP. Human picks.

### 9.8 AI implementation notes

- Text model: any capable LLM via API. All prompts live in a `prompts/` directory, versioned, with the bill personality injected.
- Every AI output stored with model name + prompt version for debugging and cost tracking.
- Hard guardrail in code: the function that appends to `story_text` accepts only holder-submitted (or holder-accepted) words, plus the two labeled exceptions in 9.3.2 and 9.4.2, which must pass through a separate, clearly named code path.

---

## 10. Accounts and identity

### 10.1 Optional signup, magic links only

- Participation never requires an account. Signup is offered for: profiles, courier score, stamp collection, claiming past hops, and managing notification preferences.
- Auth: **magic links via Resend**. User enters email → Resend sends a sign-in link → session cookie. **No passwords. No OAuth** (no PayPal OAuth, no social login in MVP).
- A user's account email and their PayPal payout email may differ; store both.

### 10.2 Public identity

- On signup, user picks a public **anonymized username** (handle). Handles are what's shown on stories, maps, leaderboards, and stamps.
- Backend stores the user's PayPal email privately. **Never render PayPal emails publicly.** Public surfaces show handle + city only.
- Anonymous (not signed up) contributors appear as "A stranger in {city}" unless they later claim their hops (10.3).

### 10.3 Claiming past hops

- If a signed-up user's verified email matches the recipient email of past anonymous hops, offer one-click claim: those hops attach to their profile, handle replaces "a stranger," stamps join their collection.
- Claiming never rewrites story text — display attribution only.

### 10.4 Privacy rules

- City-level location only, and only with holder consent at contribution time (default: derive coarse city from IP, show the holder what will be displayed, allow "don't show my city").
- No public feed of who paid whom. The product's graph (story, map, diary) is the public layer; payment details (emails, payout IDs) stay in the backend.
- Minors: this product moves money between adults via PayPal. Do not build child accounts or child-directed features. (The screen-time allowance concept is explicitly out of scope — children's data + money is a COPPA problem for a different product.)

---

## 11. Followers and notifications

### 11.1 Follow preferences

At follow time, the follower chooses:

| Preference | Triggers |
|---|---|
| Every hop | Each confirmed hop: new words + city + diary line |
| Only when it ends | Finale posted, or eulogy posted |

- Default: **Only when it ends.**
- Signed-up users can change preference per bill on their profile. Email-only followers get a manage link in every notification (signed token, no login required).

### 11.2 Notification channels

- **Email via Resend** is the only MVP channel. Templates needed: you've got a buck (holder CTA), nag 1/2/3, hop update (followers), finale posted, eulogy posted, magic link, finale invitation (creator).
- No push notifications in MVP.

### 11.3 Courier score and leaderboards

- Courier score (single number, signed-up users): weighted sum of hops completed, median pass speed, and stories carried to completion (as holder on a completed bill). Keep the formula in one documented function; tune later.
- Public leaderboard: top couriers by score, handle + city + score only.
- Followers exert soft pressure: bill pages show follower count ("212 people are watching this buck"). Holders see it on the contribution screen.

---

## 12. Monetization

Design the data model for these now; only the mint flow needs a (sandbox-simulated) price in MVP.

| Stream | Mechanic |
|---|---|
| Mint fee | Minting costs $2: $1 funds the bill, $1 platform revenue |
| Fork fee | Forking costs $2: $1 funds the new bill, $1 platform revenue |
| Storybook export | A finished/eulogized story becomes an AI-illustrated print-on-demand book (~$20). Buyers: contributors who want the book of the story they helped write |
| Story readings and videos | A finished story performed in a chosen voice or style: audio, short generated video, or longer rendered video. One-off purchase, or a group gift for every contributor (Section 18) |
| Sponsored bills | A brand funds N bills ($1 each) + a fee; bill pages carry "Released by {brand}". Distribution they cannot buy elsewhere |
| Private chains | Paid private bills for weddings, conferences, classrooms: invite-only holders, custom prompt, printable keepsake |

- **Playing is always free.** Creators (and forkers) pay; holders never pay to contribute. This mirrors lottery economics: buying a ticket costs money, scratching one someone handed you is free.
- MVP implementation: sandbox checkout stub with the $2 breakdown displayed ($1 to the buck, $1 to keep the lights on). No real charge.

---

## 13. Pages and UI

### 13.1 Bill page (public, the shareable artifact) — MVP

- Header: serial (TRV-0042), status, hop count, content-word count, follower count, age, "Released in {city} on {date}"
- **The Story** — full text, rendered as flowing prose. Hover/tap a segment highlights the contributor + map pin (Section 8.4). AI-written finale/eulogy closings visually distinct + labeled.
- **The Map** — hop pins in order with a connecting path. Pin hover highlights story segment.
- **The Diary** — reverse-chronological first-person entries.
- **The Passport** — stamp grid, one per hop.
- **Fork tree** — branches in/out with links ("Forked from TRV-0017 at word 48" / "Forked into TRV-0089, TRV-0103").
- Actions: Follow (with preference picker), Fork from here (per-hop), Share.
- If the visitor is the current holder (valid token): contribution panel at top (Section 7.2).

### 13.2 Other pages — MVP

- **Home** — hero ("Passage of the Buck"), live counters (bills traveling, words written, cities touched), featured bills, wild pool preview, "Release a buck" CTA.
- **/wild** — claimable bills (Section 7.3).
- **/b/{serial}** — bill page; contribution mode via `?t={token}`.
- **Mint flow** — Section 7.1.
- **Profile** (signed-in) — handle, courier score, stamps collected, bills minted/followed, per-bill notification preferences.
- **Leaderboard** — top couriers.
- **Storybook page** (post-completion) — reading view + export/buy CTA (stub in MVP).

### 13.3 Design notes

- The bill is a character. Every empty state, error, and email speaks in or about the bill's voice.
- Serial numbers styled like real currency serials. Passport stamps look like passport stamps.
- Mobile-first: the holder flow (email link → contribute → pass) is a phone flow.

---

## 14. Data model

Core tables (adapt to chosen ORM; names are normative):

- **users** — id, email (verified, unique), handle (unique), paypal_email (nullable, private), is_admin, created_at
- **bills** — id, serial (unique, e.g. TRV-0042), creator_id (nullable for anonymous mint), forked_from_bill_id (nullable), forked_at_hop_index (nullable), personality (JSON: name, voice, diary style), prompt_theme, goal_hops (nullable), status (active | in_transit | complete | eulogized), is_admin_minted, origin_city, created_at, completed_at
- **hops** — id, bill_id, index (order), words (raw), content_word_count, note_text, note_photo_url, city, contributor_user_id (nullable), contributor_email (payout recipient, private), contributor_display (handle or "A stranger in {city}"), ai_assisted (bool, private), payout_id, payout_status (pending | succeeded | failed), stamp_image_url, diary_entry, created_at, confirmed_at
- **follows** — id, bill_id, user_id (nullable), email, preference (every_hop | on_end), created_at
- **sessions** — magic-link sessions: id, user_id, token_hash, expires_at
- **payout_events** — id, hop_id, paypal_batch_id, paypal_item_id, event_type, raw_payload (JSON), received_at

Invariants enforced in code:

- A bill's story text = concatenation of its confirmed hops' words, in index order. Nothing else may append except the labeled finale/eulogy paths (Section 9.8).
- `index` is assigned at confirmation time, never at submission time (failed payouts consume no index).
- Serial numbers are sequential and never reused, including for forks.

---

## 15. API surface (backend)

- `POST /api/bills` — mint a bill (creator email, first recipient or wild, theme, goal) → creates bill, fires first payout
- `POST /api/bills/{serial}/contribute` — holder contribution (token-authenticated): words, next recipient email or wild flag, note, city consent
- `POST /api/bills/{serial}/fork` — fork from a hop index → new bill, first payout
- `POST /api/bills/{serial}/claim` — claim a wild bill (email) → becomes holder
- `POST /api/bills/{serial}/follow` — follow with preference
- `POST /api/bills/{serial}/finale` — creator finale (creator-authenticated via magic link)
- `POST /api/bills/{serial}/suggest` — AI next-4-words suggestions (rate-limited)
- `POST /api/webhooks/paypal` — Payouts webhook receiver; verifies signature, advances chain (Section 6.2)
- `POST /api/auth/magic-link` — request magic link (Resend)
- `GET /api/auth/verify?token=...` — consume magic link, set session
- `GET /api/bills/{serial}` — public bill payload (story, hops, map points, passport, diary; no private emails)
- Cron jobs: nag scheduler (24h / 72h / 7d), death check (14d → eulogy flow), webhook timeout poller

---

## 16. Integrations

| Service | Use | Notes |
|---|---|---|
| PayPal Payouts API (sandbox) | Every hop's $1 payout | Operator credentials only; webhook `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` / `FAILED` is the chain-advance signal |
| PayPal Orders API | Production relay pool + mint fees | Document only for MVP; sandbox stub the checkout |
| Resend | All email: magic links, holder CTAs, nags, follower updates | Primary notification channel; PayPal's own email is backup |
| LLM API | Personality, diary, nags, suggestions, finale suggestions, eulogies | Prompts versioned in `prompts/`; personality injected per bill |
| Image model API | Passport stamp illustrations | Async; never blocks a hop |
| Maps | Bill trail map | Any embeddable map (Mapbox GL / Google Maps JS / Leaflet+OSM). City-level pins only |

Secrets: all API keys in environment variables. PayPal + LLM + Resend keys are server-only, never exposed to the client.

---

## 17. Incentive stack (why bills don't stall)

Layered, in order of importance:

1. **Friction near zero** — no account, no PayPal auth, 4 words, 60 seconds. Stalling is usually friction, not malice.
2. **The nagging bill** — escalating in-voice emails at 24h / 72h / 7d (Section 8.3). Screenshot-worthy by design; nags are marketing.
3. **The audience** — follower counts shown to the holder; every-hop followers get stalled pings. Being watched creates obligation.
4. **Courier score** — fast, prolific passers climb a public leaderboard (Section 11.3).
5. **Stamps** — holders collect passport stamps for their profile. Completion instinct.
6. **Endings exist** — goals + creator finales mean stories finish, and finished stories (books, shares) recruit the next minters. A game with no ending feels pointless; this one ends.
7. **Clean death** — 14-day eulogy closes stalled bills with dignity instead of leaving them rotting. Death is content, not failure.

---

## 18. MVP scope vs V2

Status as of Oct 9, 2026. The hackathon build is deployed at fourwordpass.com and passes a full hosted sandbox run. Known hurdle: the initial $2 purchase has to go through PayPal sandbox checkout. Submission logistics (video, Devpost, seeding the wild for judging) are tracked in `devpost-submission.md`, not here.

**Where the build differs from this document:**

- Product is **Four Word Pass** (fourwordpass.com), serials `FWP-0001`. "Pass the Buck" survives as a phrase, not the product name.
- Email is **Cloudflare Email Service**, not Resend. Inbound mail for `@fourwordpass.com` goes to a catch-all Worker and is stored in D1; nothing forwards to a human inbox.
- Sign-in is an emailed **six-digit code or link**, not a magic link only.
- Mint and fork use a **real sandbox Orders checkout**, not a stub. Mock mode exists only for local testing.
- AI prompts live in `worker/ai.ts`, not a `prompts/` directory. Each AI output still stores its model and prompt.

### MVP (hackathon build)

- [x] Mint, contribute, wild claim, pass: full loop on PayPal sandbox, confirmed by webhook with polling as fallback
- [x] $2 mint and fork through sandbox Orders checkout
- [x] 4-content-word validation with stopword exemption
- [x] Bill page: story with contributor highlight linked to map pins and passport stamps, diary, async AI stamps, paged history for long stories, live updates
- [x] AI: personality, diary, nags, next-4-words suggestions (rationed per holder), creator finale with AI suggestions, eulogy and labeled AI closing
- [x] Forking, with the family tree on both bills' pages
- [x] Optional accounts: emailed code sign-in, claimed pen names, past hops linked automatically by participant id, dashboard with stamps and follows
- [x] Follower preferences (every hop / only when it ends), with a manage link in every email
- [x] Admin: featured bills, remove a hop, end a bill, seed and decorate demo bills (admin endpoints rather than a standalone script); no hop limits anywhere
- [ ] Courier score and leaderboard (punted to V2)

**Shipped beyond the original MVP:**

- [x] Send back: a holder who doesn't want the buck returns it to whoever passed it (or to the wild, if they claimed it); the sender passes it again
- [x] Open Books: a public ledger of every dollar in and out
- [x] SEO: server-rendered metadata, sitemaps, policy and FAQ pages
- [x] Share: native share sheet on mobile, custom share dialog on desktop (copy link, X, Bluesky, Facebook, LinkedIn, Reddit, email)
- [x] Email deliverability: SPF/DKIM/DMARC on Cloudflare, text-first layout led by the heading, RFC 8058 one-click unsubscribe on every non-transactional email (buck-passing emails are transactional and carry none)
- [x] Flood limits per inbox: 5 passes or claims per address per day, 3 follow confirmations per address per day, holder-link resend once an hour, hop emails to a follower at most every 3 hours, sign-in codes capped at 6 an hour and 12 a day

**Punted from the original MVP:**

- [ ] Courier score and leaderboard (Sections 11.3, 13.2)
- [ ] Photo notes on hops (text notes only)
- [ ] Next-holder matchmaking (Section 9.7)
- [ ] Report button on bill pages (reports go to the support email; an admin can remove a hop)
- [ ] Storybook page stub (Section 13.2)
- [ ] Chapter breaks for very long stories (paging exists; generated chapter summaries do not)

**Operations, not code:**

- [ ] Google Search Console verification TXT record (add in the Cloudflare dashboard)
- [ ] DMARC reporting address: `v=DMARC1; p=reject; rua=mailto:dmarc@fourwordpass.com`
- [ ] Register the domain in Google Postmaster Tools
- [ ] Forward support mail to a real inbox (verify a destination address, then forward from the email Worker)

### V2 (post-hackathon)

Decision (Oct 9): the hackathon entry keeps per-hop sandbox payouts. Everything below waits until after submission.

- [ ] Production money: the "Paid Four Word" model below, real $2 mint/fork/revival checkout, Payouts approval
- [ ] Pass by link (details below)
- [ ] An address-wide "never email me" opt-out (today, unsubscribing is per buck)
- [ ] Abuse detection for cash-out gaming (see below)
- [ ] Courier score and leaderboard; richer courier score later
- [ ] Story readings and videos: a paid add-on for finished stories (details below)
- [ ] Storybook print-on-demand export and storefront
- [ ] Sponsored bills + brand dashboard; private chains (weddings, conferences)
- [ ] Push notifications; chapter summaries for 1,000+ hop stories
- [ ] Multi-currency; non-US payout handling

#### Pass by link

- The holder chooses "Pass by link" instead of typing an email. The share sheet (or desktop share dialog) sends a private hand-off link by text, chat, or QR.
- The bill is reserved for that link for about 48 hours. One claim per link. The first person to open it reads the story and enters their own PayPal email; that consent helps deliverability and means the holder never needs anyone's address.
- The sender sees the claimer's masked email. A Turnstile check guards the claim step. An optional first name from the sender acts as a soft check.
- Unclaimed links expire back to the sender (who picks again) or to the wild, reusing the send-back flow.
- Link previews carry the bill's card and a story line, so group chats become the growth loop.

#### Story readings and videos

A one-off purchase once a story ends (finale or eulogy): the story performed in a chosen voice, tone, or style. Every contributor is a likely buyer, and every free preview is an ad.

**Rules**

- The performance is verbatim. AI reads or acts the story; it never rewrites, smooths, or summarizes it. Label it as an AI performance.
- Voices and characters are archetypes ("noir detective", "nature documentary", "bedtime story", "old-time radio", "monk reading a leather-bound tome"). Never a real person's voice or likeness (right-of-publicity and voice laws such as Tennessee's ELVIS Act).
- The terms must license contributors' words for paid readings and videos.

**Formats**

- **Audio:** text-to-speech in the chosen voice (ElevenLabs or similar). Any length. A full 40,000-word story runs 4 to 5 hours, so price by length.
- **Generated video, under a minute:** a cheap video model with a reference image for a consistent look. Use the bill's own art (banknote, passport stamps, personality) as the reference. Short clips are stitched together: the opening, a few highlights, and the finale, all read verbatim.
- **Rendered video, over a minute:** templated rather than generated. Narration over the story text, the map trail animating hop by hop, and passport stamps turning. Deterministic, on-brand, cheap at any length, and rendered once and cached.

**Cost reference** (fal.ai MiniMax H3 Max Turbo, per second of video; promotional rates end Oct 15, 2026):

| Resolution | Promo | Regular | 60-second clip at regular rate |
|---|---|---|---|
| 480p | $0.015 | $0.025 | $1.50 |
| 768p | $0.024 | $0.04 | $2.40 |
| 1080p | $0.048 | $0.08 | $4.80 |

Prices are falling; re-check before launch and keep the model swappable.

**Pricing to start with**

| Product | Price |
|---|---|
| 30-second preview clip, branded with the bill's link | Free |
| Full audio reading, one voice | $3–5 |
| Generated video under a minute | $9–15 |
| Rendered video over a minute | $9–15 |
| Unlock for every contributor (a group gift; contributors can chip in) | A multiple of the single price |

- Checkout through the PayPal Orders API. Generate after payment confirms, then cache and email a link.
- Later: voice bundles ("pick three narrators"), and a bundle with the storybook print.

#### Post-hackathon option: "Paid Four Word" (cash-out model)

The hackathon build keeps a sandbox payout on every hop. It demos PayPal well, but per-hop payouts cannot scale. This option replaces them with one standing $1 offer per bill. It is an experiment: how far does a dollar get paid forward before someone keeps it?

**Money**

- Passing is free. Money moves only on mint, revival, and cash-out.
- Mint and fork stay $2 (Orders API). The platform does not hold the dollar as a deposit: the mint is a product sale, and the $1 is a standing offer the platform pays from its own funds. No escrow, no stored value.
- If nobody cashes out, the platform keeps the dollar. Disclose at checkout and in the terms: "The dollar is an offer to whoever holds the buck. If nobody takes it, it isn't refunded."
- Fee check: a $2 checkout loses roughly $0.56 to processing; a cash-out costs $1 plus the payout fee. A revived-then-cashed-out bill is roughly break-even; an uncashed bill keeps roughly $1.40. Confirm against the live fee schedule before launch.

**Cashing out**

- On their turn, a holder either passes the buck on or cashes out the $1. Cashing out is their last move: they may add four parting words, which become the line before the ending.
- Payout goes to the holder's email via Payouts; PayPal's own claim flow covers recipients without an account. The bill pauses as "Cashed out" when the holder chooses, not when PayPal confirms. A failed payout is reported to the holder for retry; the bill stays paused.
- A bill claimed from the wild cannot be cashed out on that turn. Claimers can still game it by passing to a second address; accept that for now and detect abuse later (same-person passes, rapid claim-pass-cash patterns, per-person cash-out caps).
- The cash-out holder is never shown publicly: no email, no pen name. Only the hop number and city ("Cashed out at hop 23, Austin").

**After a cash-out: the creator has final say**

- Only the creator can act. No rescues by followers or strangers.
- **Revive:** pay $2 (Orders API) and the story continues from where it stopped. The creator passes it on or releases it to the wild. Revivals can repeat and are counted publicly ("revived twice").
- **Finish:** write the finale. The story ends with "Cashed out" in its record.
- **Do nothing:** after 7 days the bill writes its own ending (the existing eulogy flow).
- The diary and story record the break honestly: "Cashed out at hop 23. Revived by the one who started me."

**Statuses and voice**

- An unbroken chain carries the "Paid Four Word" badge. A break shows "Cashed out", then "Revived" or ended.
- Tone is wry, never shaming. Spending a dollar is what dollars do.

**Stats this unlocks**

- Average hops before a cash-out, the longest chain never cashed out, where dollars get spent, revival rate.

**What it changes**

- Per-hop payouts, the payout state machine, and payout webhooks in the hop sequence (Section 6.2) are replaced by free handoffs plus a single cash-out payout. Holders lose PayPal's "you've got $1" email on every hop, so our own email deliverability and pass-by-link matter more.
- Data: a cash-out record per bill, a revival count, and a "cashed out, awaiting creator" state with its 7-day timeout.
- Existing sandbox bills need a migration path.

---

## 19. Edge cases and guardrails

- **Payout fails** (bad email, no PayPal account, blocked): hop stays unconfirmed, holder picks a new recipient. Story never advances on failed money.
- **Recipient never claims the PayPal payment:** PayPal auto-reverses unclaimed payments per its own policy (~30 days). Our hop is already confirmed at payout success; the product does not depend on the recipient keeping the dollar. The story is the asset; the $1 is the baton pass that proves the handoff happened.
- **Holder sits forever:** nag ladder → 14-day eulogy. The $1 is not recovered. Accept the loss; the eulogy is worth more than a dollar of nagging infrastructure.
- **Abusive content:** profanity/abuse filter on words and notes; report button on bill pages; admin can remove a hop (story recomputes from remaining confirmed hops; payout history stays in the audit log).
- **Spam mints:** mint requires an email; rate-limit mints per email/IP. Wild pool shows newest + most-followed first so spam sinks.
- **Duplicate webhook delivery:** idempotent webhook handler keyed on PayPal item ID. Confirming an already-confirmed hop is a no-op.
- **Two holders at once:** only one active contribution token per bill. The token rotates on every confirmed hop; stale tokens show "This buck has moved on."
- **Very long stories:** story view paginates/virtualizes; the public API returns hops in pages, never all 10,000 at once.

---

## 20. Hackathon demo script (3 minutes)

The demo is the pitch. Stage it exactly:

1. **(0:00)** Live: mint a bill on camera. "This is TRV-0147. It has a personality, a passport, and one dollar." Show the sandbox checkout stub ($1 to the buck, $1 to us).
2. **(0:30)** Send it to a teammate's email. Their phone buzzes twice: PayPal's "you've got money" + our Resend email. They open the link — no signup — read the story so far.
3. **(1:00)** They type 4 words (show the live content-word counter; deliberately type 3 first, get "The buck demands four"). They tap a one-tap AI suggestion, edit one word, pass it to the wild.
4. **(1:30)** Third person claims it from /wild on a laptop. Webhook confirms; watch the bill page update live: story grows, map pin drops, diary entry writes itself, passport stamp appears.
5. **(2:00)** Fork it. From an earlier hop: "We didn't like where that went." Fork → new serial → family tree updates. Two stories now run from one.
6. **(2:30)** Show a seeded long-running bill: 300 hops, map lit up, hover a contributor → their words highlight. Flash the nag emails ("Day 7 in your pocket..."). End on a eulogized bill with its AI closing, labeled.
7. **(2:50)** Close: "Every hop is a real PayPal payment. Every story is written by strangers, four words at a time. Pass the buck."

Seed data before recording: 2–3 bills with 20–300 hops, full passports, one eulogized bill. The live bill must be fresh-minted on camera.

---

## 21. Open decisions for the builder

- **Domain availability** decides final branding between passthebuck variants; product name stays "Pass the Buck" regardless (Section 3).
- **Map provider:** Leaflet + OpenStreetMap is free and fine for city pins; Mapbox looks better. Pick one, don't build both.
- **Image model for stamps:** pick the cheapest adequate API; stamps are small. Cache aggressively — one stamp per hop, generated once.
- **Stopword list tuning:** the Section 5 list is a starting point. Log rejected contributions during testing; if real users keep tripping on a word, adjust the list, not the rule.

---

## 22. Success criteria

- A stranger can go from email receipt to confirmed pass in under 60 seconds with zero instructions.
- Every demo hop shows a real sandbox Payouts transaction ID in the backend log.
- Story text contains zero unlabeled AI-written words.
- The bill page (story + map + passport) is screenshot-worthy without explanation.
