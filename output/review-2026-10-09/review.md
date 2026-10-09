# Four Word Pass application review

Reviewed October 9, 2026, against checkout `ab2d4c7` and the public site. Application source was left unchanged. The known difficulty completing PayPal sandbox checkout is excluded from the findings below.

**Implementation follow-up:** [repairs and current verification](repairs.md) records the subsequent local fixes, corrected severity assessment, and deployment boundary. The findings and reproduction artifacts below are historical evidence of the pre-repair behavior.

Five high-priority defects deserve attention before a broader beta: paid mints can report failure and lose the creator key; interrupted settlement can freeze a bill; competing wild releases can publish multiple contributions; failed notifications are never retried; and local payout timeouts are treated as definitive payment failures. A separate real-money blocker remains in the funding model.

## High-priority findings

### 1. P1 — Mint can accept checkout, create the bill, then return an error without the creator key

**Reproduced in isolation.** `mintBill` captures the order and persists the bill before starting its first payout. A non-retryable payout rejection runs the fallback that confirms the opening and releases the bill to the wild, then `startPass` throws. This exits `mintBill` before it sends the creator-key email or returns the serial and key. The browser stays on the checkout form showing an error even though the bill exists and the payment was accepted. Retrying that order produces “That payment already minted a bill.” Starting another checkout can charge again.

The isolated result was one persisted wild bill associated with the order, a rejected mint call, and no creator email. The capture was simulated; no live charge was made.

**Locations:** [capture and order reuse check](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:117), [first payout before creator email](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:182), [throw after fallback](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:235), [browser error handling](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/MintForm.tsx:40).

**Fix:** Treat the fallback to wild as a successful mint with a handoff warning. Make the paid operation resumable and persist a recoverable result, with authorization bound to the checkout attempt, so a lost response or later failure does not require another payment. Queue the creator email durably.

### 2. P1 — Interruption between settlement writes permanently freezes a bill

**Reproduced with injected database failure.** `deliverPass` first commits `passes.status = 'delivered'` using a standalone update. It then confirms the hop and changes the bill to holding in another database operation. If the second operation fails, replay sees that the pass is already delivered and exits. Cron polls only pending passes, and its delivery backfill only attempts notifications and hop effects; neither repairs the bill transition.

After the injected interruption, replay and cron left the bill `in_transit`, the pass `delivered`, and zero pending passes. It has no path to normal recovery. Failure settlement and the separate bill-reservation/pass-insertion operations have similar interruption windows.

**Locations:** [delivery settlement](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:307), [failure settlement](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:327), [claim reservation](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:601), [cron recovery queries](/Users/ammonbrown/Documents/dev/fourwordpass/worker/cron.ts:23).

**Fix:** Commit the related lifecycle writes atomically, with guards that apply to the whole transition. Add reconciliation for stranded `in_transit` bills and incomplete mint operations rather than relying solely on pending passes.

### 3. P1 — Racing wild releases publish two contributions from one holder

**Reproduced with two concurrent calls using the same holder snapshot.** `releaseToWild` confirms the pending hop before attempting the conditional bill update. The losing request still confirms its words even when its bill update affects zero rows. Both requests can subsequently observe a wild bill and return success.

The reproduction confirmed two distinct four-word contributions at indices 1 and 2 from one holder. This can also let stale work append words after another lifecycle action has won. Disabling the submit button does not protect requests from another tab or client.

**Locations:** [hop confirmation before guarded update](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:389), [wild contribution result check](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:583).

**Fix:** Make winning the holder/status transition a prerequisite for confirmation inside the same atomic operation. Use a stable contribution idempotency key and an invariant limiting each holding turn to its permitted contribution.

### 4. P1 — Failed holder emails are marked complete and never retried

**Reproduced with a mail provider returning failure.** `afterDelivery` sets `holder_notified = 1` before sending. `sendMail` catches provider errors and returns `false`; the caller ignores that result. Cron selects only `holder_notified = 0`. The test attempted the email once, left the flag at 1, and never retried through either replay or cron.

For a named recipient in the sandbox, this email is the only practical route to their holder key. Its failure can stall the entire chain. The diary, follower, and goal flags also claim completion before their work finishes, so they can lose work on failure or cancellation. Serial follower sends can be cut off partway through the list. Cloudflare documents a 30-second post-response `waitUntil` limit, which makes durable recovery relevant here. [Cloudflare Workers guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

**Locations:** [holder notification flag](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:407), [mail failure result](/Users/ammonbrown/Documents/dev/fourwordpass/worker/email.ts:113), [hop effect flags](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:489), [serial follower fan-out](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:818).

**Fix:** Use retryable jobs or an outbox with pending, in-progress, and successful states. Record successful delivery only after success; allow expired work claims to retry. Track follower delivery per recipient rather than marking the entire fan-out complete first.

### 5. P1 — Payout timeout and later financial status changes are not reconciled

**Two cases reproduced in isolation.** After two hours the app fails a pending pass and restores the bill to its sender or the wild. This does not cancel the payout at PayPal. A later successful event is ignored because delivery only updates records whose status is still pending. The old recipient can receive money while the app permits another payout with a new pass id.

Separately, once an `UNCLAIMED` payout is marked delivered, later `SUCCESS` or `RETURNED` events do not update its stored PayPal status. The reproduction left a returned payment recorded as `UNCLAIMED`. Open Books therefore cannot reliably keep its promise of current payment statuses or accurate money-out totals. PayPal explicitly describes pending payouts as still processing and unclaimed payouts as returnable after 30 days. [PayPal payout processing](https://developer.paypal.com/payouts/payment-processing).

**Locations:** [local timeout](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:288), [pending-only delivery update](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:309), [pending-only failure update](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:329), [ledger outcome](/Users/ammonbrown/Documents/dev/fourwordpass/worker/books.ts:93).

**Fix:** Separate the story's handoff state from the financial transaction's evolving state. Keep unresolved payouts under reconciliation, store all subsequent verified status changes, and cancel or confirm the old transaction before allowing a replacement that could pay twice.

## Real-money release gate

### 6. P1 for live money — Changing PAYPAL_MODE is insufficient; repeat claims can pay indefinitely

**Claim/return loop reproduced with simulated payouts.** Claiming a wild bill sends $1. Declining that claim returns the story to the wild without recovering the payout. The same email can immediately claim again. Three loops generated three payouts with zero new words and no checkout.

Later hops are intentionally platform-funded in the sandbox, as the PRD and Open Books explain. The production relay-pool collection flow is not implemented: only mint/fork captures $2. There is no shared payout budget or per-recipient lifetime cap. This is a real-money release gate, separate from sandbox checkout compatibility. In beta, the loop can still exhaust the sandbox balance and trigger real app emails.

**Locations:** [claim](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:601), [return to wild](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:625), [every payout sends another dollar](/Users/ammonbrown/Documents/dev/fourwordpass/worker/paypal.ts:122), [documented production model](/Users/ammonbrown/Documents/dev/fourwordpass/pass-the-buck-prd.md:122).

**Fix:** Keep any checkout workaround explicitly simulated until the funding model is implemented. Before live money, require funding or a bounded sponsor allocation for every payout, enforce a shared atomic spend cap, and prevent repeated payouts from claim/return cycles.

## Other confirmed defects

### 7. P2 — Eulogy generation can end a bill that has just resumed moving

**Reproduced.** The inactivity selection happens before an AI call. After that call, the final update checks only whether the bill is holding or wild. If a claim settles or a holder changes during generation, the old eulogy still closes the newly active bill. The test changed the bill to a fresh holding state during generation and it was nevertheless eulogized.

**Location:** [ending after AI generation](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:727).

**Fix:** Compare the selected version, holder, and inactivity timestamp at commit time, and recheck the inactivity condition. Discard an ending generated for an obsolete state.

### 8. P2 — Real contributions to demo bills are excluded from cron backfill

**Reproduced; a matching symptom was visible live.** Seeded bills are intentionally claimable by real users, but the hop-effects cron excludes every hop on a bill with `is_seed = 1`. A real contribution whose initial diary, notification, or stamp task did not finish is therefore never backfilled. The test skipped a real hop on a seeded bill; clearing the bill-level seed flag let the same cron complete its stamp.

The live featured FWP-0002 showed a sandbox receipt for hop 63 and an “INKING…” stamp while the bill had already been wild for hours. That is consistent with this defect; I did not inspect its private database record or provider logs.

**Locations:** [bill-level seed exclusion](/Users/ammonbrown/Documents/dev/fourwordpass/worker/cron.ts:41), [seed bills accept real participants](/Users/ammonbrown/Documents/dev/fourwordpass/worker/admin.ts:98).

**Fix:** Distinguish simulated hops from real contributions at the hop level. Backfill real hops regardless of the bill's origin; seeded historical hops already have their effects flags set or stamps marked none.

### 9. P2 — An expired holder link suppresses claiming a wild bill

**Verified in the live browser using a deliberately invalid test token.** The page showed “This buck has moved on” for a bill marked “In the wild,” with zero “Claim this buck” buttons. The claim CTA depends on the absence of any stored token, rather than whether the token represents the current holder. Real old tokens after release, failed claim, decline, or expiry take the same moved-on path. The token remains in session storage, so reload does not restore the CTA in that tab. Some follow/resend controls use the same presence check.

**Locations:** [claim CTA condition](/Users/ammonbrown/Documents/dev/fourwordpass/src/pages/Bill.tsx:149), [stored tokens](/Users/ammonbrown/Documents/dev/fourwordpass/src/api.ts:106), [moved-on panel](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/ContributePanel.tsx:102).

**Fix:** Render controls from the authenticated holder state. Clear or disregard obsolete tokens when the server says moved_on, while retaining the public actions appropriate to the current bill status.

### 10. P2 — Stories silently stop at hop 5,000 despite having no advertised hop limit

**Reproduced with a synthetic 5,001-hop bill.** The public response reported 5,001 hops but returned only the earliest 5,000. Latest words, map pins, stamps, and selectable fork points disappear. The SEO story also uses the same ascending limit. This conflicts with the explicit ten-thousand-hands example.

**Locations:** [public projection](/Users/ammonbrown/Documents/dev/fourwordpass/worker/views.ts:13), [HTML story](/Users/ammonbrown/Documents/dev/fourwordpass/worker/seo.ts:35).

**Fix:** Add paginated story/history retrieval and load the newest segment initially, with access to all earlier segments. Do not describe the current truncated response as the full story.

## Additional issues from code inspection

These were identified in the code rather than exercised end to end:

- **Bill-to-bill navigation retains old token and UI state.** `useUrlToken` reads URL/storage only in its state initializer, and its cleanup effect depends only on `param`. A changed serial does not load the new key or process the new token. In particular, a fork's successful navigation stays on the same BillPage component: it can retain the parent's creator token and reopen the old fork modal when the new bill loads. Reset state on serial change or key the routed bill component. [token hook](/Users/ammonbrown/Documents/dev/fourwordpass/src/api.ts:106), [bill state](/Users/ammonbrown/Documents/dev/fourwordpass/src/pages/Bill.tsx:26), [fork navigation](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/MintForm.tsx:53).
- **Returned-bill controls can remain stale.** CreatorPanel reloads its private view only when serial, token, or status changes. A first recipient declining changes a bill from holding to holding, so an already-open creator page misses the new returnedBy state. The holder panel's local landed/sent flags can also keep a success screen visible after the bill returns. Refresh private views on bill version changes and reset success state when a new holding turn begins. [creator effect](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/CreatorPanel.tsx:20), [holder success screen](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/ContributePanel.tsx:79).
- **Missing PayPal secrets silently enable mock payments in a deployed environment.** `paypalMode` returns mock whenever either credential is missing, even if the configured mode is live or sandbox. Fail closed outside explicitly configured development/mock environments. The current live browser did load sandbox card checkout, so this is a deployment hazard rather than an observed missing-secret incident. [mode selection](/Users/ammonbrown/Documents/dev/fourwordpass/worker/paypal.ts:30).
- **Loading failures have weak recovery UX.** MintForm discards the config error, leaving a disabled simulated-payment button and misleading configuration copy. Home and Wild also ignore useLoad errors; BillPage labels any initial load failure as “No bill by that serial.” Follow preferences do not update their selected styling after save and do not catch save failures. Show distinct loading/offline/server/not-found states with retry actions. [config load](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/MintForm.tsx:15), [bill error](/Users/ammonbrown/Documents/dev/fourwordpass/src/pages/Bill.tsx:48), [follow preferences](/Users/ammonbrown/Documents/dev/fourwordpass/src/pages/Other.tsx:79).
- **Public follow/resend actions can be used to generate unwanted real emails.** Follow accepts and immediately subscribes any email, including changing an existing subscription's preference, without inbox verification. Resend targets the current holder without authentication. Existing limits are per IP and action, with no recipient cooldown, durable opt-out suppression, or shared mail budget. Add recipient-level controls and confirmation for subscriptions. [follow](/Users/ammonbrown/Documents/dev/fourwordpass/worker/engine.ts:790), [resend endpoint](/Users/ammonbrown/Documents/dev/fourwordpass/worker/index.ts:241).
- **Validation and accessibility gaps.** Request JSON is asserted as TypeScript types without runtime schemas; malformed field types can produce generic 500s. The server does not enforce the browser's word-text length limits or bound email length. Most mint inputs have visually adjacent labels without associated input IDs, and Modal lacks focus trapping/restoration. Add bounded request schemas and associate labels; complete keyboard focus handling. [request body](/Users/ammonbrown/Documents/dev/fourwordpass/worker/index.ts:143), [word rules](/Users/ammonbrown/Documents/dev/fourwordpass/shared/words.ts:48), [form labels](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/MintForm.tsx:62), [modal](/Users/ammonbrown/Documents/dev/fourwordpass/src/components/Modal.tsx:3).

## Verification and scope

- Existing suite: **28 tests passed**. Type checking and production build passed.
- Production dependency audit: **zero reported vulnerabilities**. This is an npm advisory check, not a security assurance.
- Ten isolated reproductions passed, asserting the faulty behavior described above. They use the real lifecycle functions and migrations, an in-memory SQLite adapter for D1, and stubbed payment, email, and AI services. They establish application logic failures, not the frequency of failures in Cloudflare production.
- Public browser checks covered Home, Release, the word counter, Wild, a bill, its fork form, and the filtered Open Books ledger. No warnings/errors were captured in the checked browser flows. The observed narrow viewport had no document-wide horizontal overflow; requested viewport overrides did not change the reported width, so desktop/mobile breakpoint coverage is incomplete.
- No live checkout, payout, contribution, subscription, or email was initiated. Authenticated production records, delivery logs, DNS configuration, and provider credentials were not audited. No deployment or application-source changes were made.

Reproduction artifacts: [test harness](/Users/ammonbrown/Documents/dev/fourwordpass/output/review-2026-10-09/lifecycle-reproductions.test.ts), [results](/Users/ammonbrown/Documents/dev/fourwordpass/output/review-2026-10-09/lifecycle-results.txt), [dependency audit](/Users/ammonbrown/Documents/dev/fourwordpass/output/review-2026-10-09/npm-audit.json).

Run the isolated reproductions from the repository root:

```sh
./node_modules/.bin/vitest --run --config output/review-2026-10-09/vitest.config.ts --reporter=verbose --silent=false --disableConsoleIntercept
```

Suggested implementation order: repair paid mint recovery and atomic lifecycle transitions; add durable notification retries; separate payment reconciliation from story state; fix expired-token and returned-bill UI; then address seeded-hop recovery, stale eulogies, and pagination. Keep real-money release behind its separate funding and spend-control gate.
