# October 9 repair follow-up

Implemented locally following the review and the user's corrections. The original review describes the old checkout; its reproduction tests intentionally assert the old faulty behavior. The maintained regression tests are now in `test/lifecycle.test.ts`.

The paid-mint/key failure was the most serious immediate defect. Interrupted database writes, racing tabs and a claim during eulogy generation were real defects with narrow failure windows; the original review overstated their practical frequency. Holder mail also already had manual recovery through “Email me my link.” Repeated platform-funded sandbox payouts remain an intentional design choice.

| Original finding | Result |
|---|---|
| 1. Paid mint loses creator key | Creator mail is persisted before the initial handoff. A rejected first address releases the paid bill wild and still returns its creator key. A checkout-bound private recovery key resumes the same draft and order after an interruption; the browser offers “Finish saved checkout.” |
| 2. Interrupted lifecycle writes | Reservations and settlements commit related pass, bill and hop writes in one D1 transaction. The reserved pass ID guards settlement. Migration/cron reconcile identifiable older interrupted settlements. |
| 3. Racing wild releases | Only the request that wins the holder/status/version guard can confirm its contribution. |
| 4. Lost notifications | Durable mail outbox with leases and backoff; holder flag changes after successful delivery. Hop work retries after an expired lease. Follower delivery uses persistent jobs and stable per-recipient mail keys across pages, removing the old 500-recipient cutoff. Ending notification jobs commit with the ending. |
| 5. Timeout and later payout outcomes | Slow payouts remain reserved and keep polling. UNCLAIMED payments keep reconciling. Later outcomes update the financial record without rewinding published story ownership; stale concurrent success cannot overwrite a reversal. |
| 6. Repeat sandbox claims | Preserved. New live order creation, capture and payouts are gated until the replacement funding model exists. |
| 7. Stale eulogy | Commit checks the version, holder, clocks and continued inactivity. Explicit authenticated admin endings retain their force option with the same state/version guards. |
| 8. Seeded-bill backfill | Real confirmed hops on demo bills participate in cron recovery; simulated/inherited history retains its existing completed effects flags. |
| 9. Expired token hides claim | Obsolete holder tokens are cleared. Route keys reset private state between bills; returned-holder/creator controls refresh on state changes. |
| 10. Story truncation | API and public HTML use 200-hop keyset pages, newest first, with earlier/later and beginning/latest controls. Back/Forward restore the page. Map/stamps show the selected page; overall counts and holder location stay independent of that page. |

Additional repairs include explicit mock mode, missing-credential failure, historical payment-mode labels, mode-aware payment copy, request schemas/length limits, load-error retry controls, inbox-confirmed follows, preserved opt-outs, resend cooldowns, field labels, and modal keyboard trapping/restoration. README and the PRD document the payment boundary. The local Devpost draft distinguishes the sandbox prototype from the proposed live model and marks hosted retesting pending.

## Verification

- `npm test`: **52 passing tests**, including real SQLite lifecycle transactions with stubbed external payment, email and AI services. [Output](repair-tests.txt).
- `npm run typecheck`: passed. [Output](repair-typecheck.txt).
- `npm run build`: passed. Existing large-chunk warnings remain for MapLibre and Open Books. [Output](repair-build.txt).
- Migration 0004 applied locally; five synthetic legacy migration cases separately checked pending/settled reservations and excluded old holders/declined claims. [Output](repair-migration.txt).
- Local browser: invalid holder token exposes claim; newest 200 of 5,001 hops, earlier/beginning/latest and Back/Forward; fork form and mock payment copy; dialog Tab wrapping, Escape and focus restoration; 200 rendered story hops and no document overflow in the checked viewport. Full responsive-device coverage was not established.
- Disposable fixture FWP-900000 and its 5,001 hops removed; test browser/server closed. No real checkout, payout, email subscription or provider email was initiated.

## Deployment and remaining decisions

No remote migration, deployment, hosted provider retest, or Devpost publication was performed. Deploy `0004_reliability.sql` with the new Worker and frontend, then retest sandbox mint → handoff → contribution → finale plus email confirmation. Finish old in-progress checkouts before deployment: the new mint API requires a recovery key created by the updated checkout flow. Audit any older stranded bills that have no identifiable matching pass separately; the code cannot infer a missing historical payment record.

The held-dollar live model is **planned, not implemented**. Its final recipient, creator-ending rule, wild/expired-story outcome and fee treatment still need a product decision. Drain pending/unclaimed payouts before changing PayPal environments; historical records retain their original mode.

Mail delivery is at least once: provider acceptance followed by a lost database acknowledgement can still produce a duplicate. Recipient cooldowns and opt-out suppression were added; an account-wide mail budget was not added. Delivered outbox message bodies are cleared after seven days while deduplication IDs remain.
