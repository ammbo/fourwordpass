# Four Word Pass — Devpost images

11 PNG screenshots from https://fourwordpass.com, captured October 9, 2026.

- Every image: 1935 × 1290 pixels, exactly 3:2.
- Every file is under Devpost's 5 MB limit.
- Numbered filenames give the suggested upload order.
- Upload the PNGs; the preview JPG, HTML, scripts, notes and manifest are not gallery images.
- No page content or API responses were substituted. Map tiles, fonts, PayPal frames, AG Grid and AG Charts were rendered in Chrome.
- No orders, payments, claims, forks, subscriptions or emails were submitted while capturing. Form values use example.com.

## Paste-ready captions

1. **Passage of the Buck** — [01-passage-of-the-buck.png](01-passage-of-the-buck.png)

   A dollar carries a story from person to person, four words at a time. The hosted prototype uses PayPal sandbox test money.

2. **Meet Wendell the Damp** — [02-meet-wendell.png](02-meet-wendell.png)

   Every bill gets a name, a voice and a journey. Wendell is a labeled demo bill with simulated early history.

3. **The Story and The Passage** — [03-story-and-passage.png](03-story-and-passage.png)

   Read the story beside its city-by-city route, then inspect a hop and its masked PayPal receipt.

4. **Four words that count** — [04-four-words-that-count.png](04-four-words-that-count.png)

   The live word counter counts “lights” and “dimmed”; connecting words ride free.

5. **The Diary and The Passport** — [05-diary-and-passport.png](05-diary-and-passport.png)

   The bill narrates its travels in an AI-written diary and collects illustrated city stamps.

6. **Join from the wild** — [06-join-from-the-wild.png](06-join-from-the-wild.png)

   A bill released to the wild waits for a stranger to claim it and add the next four words.

7. **Sandbox checkout** — [07-sandbox-checkout.png](07-sandbox-checkout.png)

   Starting a story costs $2 in PayPal sandbox test money. The page provides a published test card and PayPal’s checkout button.

8. **Open Books** — [08-open-books.png](08-open-books.png)

   A public ledger shows the observed PayPal sandbox totals and payments over time. Demo payments are excluded.

9. **The PayPal ledger** — [09-paypal-ledger.png](09-paypal-ledger.png)

   The ledger exposes PayPal status, masked references, landing times and webhook confirmation without publishing email addresses.

10. **A bill’s own eulogy** — [10-a-bills-own-eulogy.png](10-a-bills-own-eulogy.png)

   A bill that has stopped traveling writes a eulogy in its own voice. Valentine’s journey is labeled demo history.

11. **Fork the story** — [11-fork-the-story.png](11-fork-the-story.png)

   Start a new branch from a chosen hop and carry the story in another direction.

## Capture notes

- **03-story-and-passage.png:** FWP-0002 has labeled demo history; its latest displayed receipt is a PayPal sandbox payout.
- **05-diary-and-passport.png:** Wendell is a demo bill. The newest stamp is visibly still inking; completed historical stamps are shown as rendered.
- **06-join-from-the-wild.png:** Only the public list is opened; no bill is claimed.
- **07-sandbox-checkout.png:** Unsubmitted form with example.com sample values. No order was created, no payment was submitted and no email was sent.
- **08-open-books.png:** At capture: $0 paid in, $3 paid out, 3 sandbox payouts. These are current test counts, not adoption or real-money metrics.
- **09-paypal-ledger.png:** Gallery card with an unaltered screenshot of the live ledger and a caption outside it. The date and empty hop columns were hidden with AG Grid’s normal drag-out interaction to show payment verification. Three observed sandbox payouts.
- **11-fork-the-story.png:** Fork dialog only. No checkout, branch, payout or email is created.

## Optional shots that still need private access or more product activity

- **Holder-only AI suggestions:** requires a current private holder link. The public release form was used for the live four-word counter instead.
- **Nag email:** requires an actual received email or access to an operator-approved demo outbox. No reminder was sent for these screenshots.
- **Populated authorship and AI model charts:** Open Books currently has no non-demo story/AI records for those charts. Their real empty state has been left intact.
- **Fork family tree:** neither featured demo bill currently has a branch. Image 11 shows the real fork dialog without creating a branch.

JavaScript, maps, chart canvases, stamps and the PayPal button were capturable; no manual screenshot is required for the included images.

## Re-capture

From the repository root, run `node output/devpost/capture-gallery.mjs`, then `node output/devpost/package-gallery.mjs`. The capture script uses the bundled Playwright runtime and installed Google Chrome. `FWP_GALLERY_START=4` resumes from the public form and keeps already captured images. Screenshot paths, source URLs and capture timestamps are saved in `manifest.json`.
