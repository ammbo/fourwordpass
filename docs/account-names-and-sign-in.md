# Account names and sign-in

Reviewed 2026-10-11. Implemented locally; production migration, deployment and inbox verification are separate release steps.

First name is required in account onboarding; last name is optional. Both allow international names and browser autofill. Public pen names remain separate. Names are self-reported, not proof of someone's real identity.

## Account entry points

- `/signin` and the signed-out dashboard: choosing a pen name reveals name fields. Signing in without one asks for names after email verification if the account lacks them.
- Follow by typed email: the optional account offer includes names; one confirmation link creates the profile and confirms the follow.
- Follow using a holder ticket: the embedded email-code account form uses the same fields and completion step.
- Claim from the wild: the optional account offer includes names, carried into the emailed challenge.
- Release and fork: selecting “create an account” reveals name fields, carried in the existing creator-key email offer.
- Old accounts, old emailed links and claim codes: a shared completion dialog asks for the missing first name after authentication.
- Dashboard: users can update their invitation name independently of their public pen name.

Pending names live on the email challenge until verification. An offer cannot change an already populated profile; editing it requires the account session. Names do not appear in public bill responses, signatures, or URLs.

## Invitations

At handoff, store the sender's profile name on the private pass. Use it in the From display name (`Jane Smith via Four Word Pass`), subject, preview and body. The actual sending address remains Four Word Pass.

A first handoff uses only the authenticated creator's server-supplied name. Looking up an account from an anonymous visitor's typed email would let that visitor borrow someone else's name. Holder and creator capabilities authorize subsequent handoffs, including sending a returned story to a new recipient. Store a snapshot so profile edits and delivery retries do not change an existing invitation's attribution.

Anonymous play remains available. Anonymous first handoffs and older passes without a recorded name retain the existing generic invitation; creating an unverified account offer alone does not authorize attribution to that account.

## OAuth decision

Keep the existing email-code/link flow as the default. Collecting two name fields does not require another login provider.

Google is the preferred optional addition if OAuth is wanted next. Request only `openid email profile`, validate the token and verified email, and use the stable provider subject for identity. Profile names are not guaranteed, so retain the name-completion step and let users correct imported names. Requires Google client configuration and a tested callback/account-linking flow. No Google sign-in was added in this change.

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

PayPal offers Log in with PayPal and can share names and email with consent. It is a separate login integration from checkout/payouts. PayPal requires app review and approval for live login scopes; its documentation says review typically takes a few weeks. Sandbox login uses sandbox accounts. This makes it a poor default for this app's current sandbox experience; consider it later as an optional shortcut for PayPal users. No PayPal login was added.

- [PayPal login overview](https://developer.paypal.com/log-in/how-it-works)
- [PayPal integration and live review requirements](https://developer.paypal.com/log-in/build/)

## Release

Apply `0008_profile_names.sql` before deploying the Worker and client together. Verify account offers by follow, claim and release, profile completion for an older account, and a named invitation in a real inbox. Local tests stub email delivery and do not establish inbox rendering or production deployment.
