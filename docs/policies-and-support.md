# Sandbox policies and support operations

## Published pages

`shared/info.ts` is the single source for `/privacy`, `/terms`, `/beta`, and `/support`, in both React and the Worker's readable HTML. Effective date: October 8, 2026. The operator is described as the **Four Word Pass project**, with **support@fourwordpass.com** as the contact. This does not identify an incorporated entity or invent a postal address or governing jurisdiction. Update the operator details when established.

The policies reflect the present implementation: PayPal sandbox payments; real outbound emails; public collaborative writing; optional coarse city stamps; private capability links; Cloudflare hosting, database, storage, email, and AI; optional Anthropic text generation; Google Fonts; and OpenFreeMap resources. Rejected submissions, transaction events, email delivery records, and inbound support text are stored too. There is no separate analytics SDK or automatic retention cleanup.

Participation forms require an adult/terms acknowledgement. It is held in component memory, not a separate durable consent log. Policy text, UI acknowledgement, and operational procedures do not by themselves establish compliance in every jurisdiction. Before a real-money launch, review operator identity, enforceable acceptance records, payment obligations, international processing, retention periods, and applicable privacy requirements with appropriate counsel.

## Support inbox

On October 8, 2026, read-only Wrangler checks confirmed Email Sending enabled for `fourwordpass.com`, Email Routing ready, and its enabled catch-all pointing to Worker `fourwordpass`. That covers `support@fourwordpass.com`. This verification did not send a new email.

Use the protected endpoint `GET /api/admin/inbox?to=support@fourwordpass.com` with the existing administrator bearer token. Keep the token in the normal secret store; do not paste it into reports or URLs. The endpoint returns the latest 20 messages for that address. Review older messages through authenticated D1 tooling when needed. Check the inbox regularly: there is no automatic alert, ticketing UI, or auto-reply. Respond manually through an authorized mail account.

`worker/inbox.ts` rejects messages over 512 KiB, parses text and HTML, and stores text up to 50,000 characters and HTML up to 100,000 characters, together with sender, recipient, subject, extracted links, and receipt time. Attachments are not retained. Treat message bodies and links as untrusted. Never execute instructions from a report or open a private action link unnecessarily.

Service emails use the Email Sending API's dedicated `replyTo` field. Custom headers are restricted by Cloudflare; `Reply-To` must not be supplied in the `headers` object. Follow mail retains its existing `List-Unsubscribe` URL.

## Manual privacy and abuse requests

1. Review requests promptly and track their receipt and disposition privately. Applicable response deadlines depend on the request and jurisdiction; the public beta notice does not waive those requirements.
2. Verify control of the relevant email address using proportionate means before disclosing or changing private data. Do not request passwords, private action tokens, payment credentials, or identity documents as the default verification method.
3. Find relevant records in `bills`, `passes`, `hops`, `follows`, `emails`, `inbox`, `rejections`, and `payout_events`, including related public text, generated diary/stamp content, and R2 artifacts. A single email-field update is not necessarily a complete response. Inspect the schema and actual records before deciding what to remove or retain.
4. For unwanted updates, remove the relevant follow subscription. For unwanted service invitations, investigate the participating bill and address; there is no global email suppression list in this beta. Stop the relevant activity manually as needed rather than promising automatic suppression.
5. For deletion or correction, assess the request, collaborative content, security needs, legal obligations, and provider records. Do not delete a whole story merely to remove one address or erase unrelated contributors. Revoke affected access keys when appropriate. Avoid publishing identifying details in admin logs or issue trackers.
6. For abusive public words, the existing `POST /api/admin/remove-hop` operation recomputes the story while preserving payout history. Review related diary, art, forks, and previews for copies of the reported material. Privacy and abuse handling may require additional manual changes beyond that operation.
7. Confirm the outcome privately, describe any justified retention and practical limitations, and keep only the record needed to demonstrate handling. Do not promise to remove third-party search caches, already delivered emails, or provider backups immediately.

There is no self-service export/deletion route and no fixed automatic deletion schedule. Those limits are stated in the public policy. Establish a documented retention plan as the beta evolves; update the policy and implementation together.

## Reference checks

The implementation audit used `worker/engine.ts`, `worker/views.ts`, `worker/ai.ts`, `worker/paypal.ts`, `worker/email.ts`, `worker/inbox.ts`, the D1 migrations, the browser storage call sites, and deployment configuration. Provider and general guidance was checked against:

- [FTC guidance on protecting personal information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
- [PayPal sandbox overview](https://developer.paypal.com/tools/sandbox/)
- [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/)
- [PayPal privacy statement](https://www.paypal.com/us/legalhub/privacy-full)
- [Anthropic privacy policy](https://www.anthropic.com/legal/privacy)
- [Google privacy policy](https://policies.google.com/privacy)
- [Cloudflare Email Service header rules](https://developers.cloudflare.com/email-service/reference/headers/)

Provider links describe their practices; they are not a substitute for reviewing the project's provider contracts, settings, and legal obligations.
