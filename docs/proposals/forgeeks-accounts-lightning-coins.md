# Proposal: For Geeks accounts, Lightning Coins and cosmetics

Date: 2026-10-24
Status: Built 2026-10-25 (FG-01 to FG-09, FG-11); live once the owner applies migrations 3–6 and the GitHub setup in supabase/README.md
Product: https://lightningeg.com/forgeeks.html
Tracking ID: FG-ACCOUNTS
Owner: Mohamed (reward authority and final decisions)

## Purpose and confirmed requirements

Turn For Geeks into a member community where contributors can find issues, give useful feedback, earn recognition and spend earned Lightning Coins on cosmetic items. Lightning Coins is a working name.

- Require an account for the For Geeks experience within the existing Lightning website.
- Support email registration/login and direct Google sign-in, preferably using Supabase's free plan initially.
- Require email only. Name, phone number and date of birth are optional; profile completion must be skippable.
- Recognize useful feedback and successful merged pull requests through a leaderboard.
- Assign each issued task its own explicit Lightning Coin reward. A flat payment for every merged PR is superseded by this requirement.
- Never put the Lightning app download or the app itself behind an account.
- Let members build an opt-in public profile that showcases their verified work and their git setup, so For Geeks also markets its contributors.
- Offer a marketplace for themes, banners and other aesthetic items. Purchases never unlock functionality, permissions, contribution opportunities or better ranking.

The sections below recommend implementation policies. Reward amounts, catalog prices and unresolved decisions remain proposals until agreed.

## Existing repository evidence

The website is static HTML/CSS/JavaScript published from `main` through GitHub Pages (README, Structure and Publish with GitHub Pages). Relevant files:

- `forgeeks.html`: developer home.
- `forgeeks-guide.html`: contribution instructions and current `/take` workflow.
- `forgeeks-roadmap.html`: developer roadmap.
- `forgeeks-collaborate.html` and `for-geeks.html`: legacy redirects.
- `js/forgeeks.js` and `css/forgeeks.css`: shared behavior and styling.
- `tools/geeks_shell.py`: shared developer navigation/footer generation.
- `guideline/coders.html`: For Geeks design system.

The current theme picker offers twelve themes and remembers selection in `localStorage` under `lightning-geeks-theme`. It has no account ownership model. The pages link to `LightningEg/Lightning` for contribution tasks; `LightningEg/Lightning_website` is the website source repository. Eligibility of each repository needs an explicit decision.

## User journeys

1. Visitor opens a For Geeks URL, sees login and chooses Google or email/password.
2. Email/password users verify their address; both methods create one stable member identity. Password reset, logout, expired-link recovery and account linking are supported.
3. The member may add optional profile details or skip directly to the community.
4. They optionally connect GitHub to receive verified PR rewards. Users giving website feedback do not need GitHub.
5. They browse issues showing scope, acceptance criteria, availability and a published coin reward; the existing `/take` and `/drop` workflow remains authoritative until changed deliberately.
6. An accepted contribution creates an explainable award in their activity history. A merged PR is verified by the backend and matched to the rewarded issue.
7. Their earned contribution score appears on the leaderboard, and their spendable wallet increases.
8. They preview a cosmetic, confirm its cost, buy it using earned coins and equip it across devices.

## Identity and privacy

Use Supabase Auth for verified email/password and Google OAuth. Request Google's basic identity scopes only. Phone and date of birth are optional manual fields, not reasons to request additional Google permissions.

| Field | Required | Visibility and behavior |
| --- | --- | --- |
| Email | Yes | Private; verification and account recovery |
| Name | No | Private by default; never automatically published |
| Display name | No | Member-visible; generated alias when blank |
| Phone | No | Private, editable/removable; not a login requirement |
| Date of birth | No | Private, editable/removable; explain purpose before collection |
| Avatar | No | Member-visible if selected |
| GitHub identity | For PR attribution only | Verified immutable GitHub ID; show linkage visibility clearly |

Never derive a public alias from an email address. Optional personal data must not appear in leaderboard responses, browser analytics, webhook logs or public GitHub issues. If full date of birth has no product purpose, defer collection or use birthday month/day only. Marketing consent is separate and optional.

Users can edit/delete optional data, request account deletion and choose whether to appear on the member leaderboard. Define retention and anonymization for historical awards and purchases before launch. Define an age policy before collecting birth dates; do not infer one from this proposal.

A Google account and a GitHub account must link through authenticated provider flows. Never accept a typed GitHub handle as ownership proof or merge accounts merely because an unverified email matches. One GitHub identity belongs to one member at a time; unlink/relink events need history to prevent claiming the same rewards again.

## Public member showcase

For Geeks doubles as marketing for the people who build Lightning. A member may publish a profile that presents who they are and what they worked on. Publishing is opt-in per section; a new profile is private.

Visibility levels per profile: private (default), members only, public.

Public sections a member may fill in:

- Display name, avatar, optional cosmetic banner and a short bio.
- **Work:** verified contributions listed automatically from the ledger (merged PR title, link to the rewarded issue, date). The member may hide individual entries. Self-described work (for example other projects) can be added as links and is labelled self-reported.
- **Git setup:** editor, operating system, languages, tools, a dotfiles or portfolio link, plus their GitHub profile link. Structured fields plus short free text.
- Contribution score and rank. Never the wallet balance or purchase history.

Never public: email, phone, date of birth, real name (unless the member chooses it as their display name), or anything the member left private. Free text is rendered as plain text, links must be https, and every public profile has a report control and moderator takedown.

Public profile pages render client-side from a public database view that exposes only opted-in fields. A later build step could generate static pages for search indexing, but that would copy profile data into the public repository history and make deletion slower, so it needs a separate decision.

Age rule (proposal): publishing a public profile requires the member to confirm they are 18 or older. Date of birth is not needed for this.

## Access boundary and hosting

Gate the For Geeks community, member profiles, task dashboard, leaderboard, wallet, inventory and marketplace. Authentication callbacks, login/reset flows and legal information remain publicly reachable. Ordinary Lightning marketing pages remain public; this proposal introduces community accounts, not an account requirement for the financial app.

**GitHub Pages cannot enforce authenticated delivery of HTML.** A JavaScript redirect can improve navigation but cannot make a public static document private. Supabase row-level security protects database records, not HTML already served by Pages.

Recommended architecture: retain the existing domain and public marketing site; route the developer area through a server/edge gateway that verifies sessions before serving protected content. Evaluate a Cloudflare Worker or equivalent routing layer. Preserving same-domain path routing requires a hosting/DNS decision; a separate community subdomain is a fallback requiring an explicit scope decision.

Do not mark gating complete while the same protected HTML is still reachable through the Pages origin, a legacy URL or an archive. Inventory all For Geeks variants, redirects, generated pages and origin addresses. Decide what can remain public as historical material. Public source code and GitHub issues will still be public; account gating cannot make an open repository confidential.

Protected responses use appropriate private/no-store caching. Validate sessions at every protected server endpoint. Redirect only to approved internal paths after login. Remove gated URLs from sitemap/search discovery as appropriate; robots directives are not authorization controls. Update `sitemap.xml`, `robots.txt`, `llms.txt`, public links and indexing metadata during rollout.

### Access map

Because pages are static and public on GitHub Pages, "gated" means the member data and actions behind a Supabase session, not the HTML shell.

| Area | Access | Reason |
| --- | --- | --- |
| Lightning app download and install, release log, privacy, feedback and survey forms | Public, always | The app never requires an account; downloads are never behind sign-in |
| Marketing, guides, blog, features, how it works | Public | Acquisition |
| `forgeeks.html`, `forgeeks-guide.html`, `forgeeks-roadmap.html`, `contribute.html` | Public | They recruit contributors; the repository is public anyway |
| GitHub issues, `/take`, pull requests | Public on GitHub | Anyone may contribute without an account; coins need an account with a verified GitHub link |
| Login, signup, reset, auth callback, legal pages | Public | Required to sign in |
| Public showcase profiles and leaderboard entries of members who opted in | Public | Marketing for contributors and the project |
| Member task board with coin rewards and claims | Signed in | Reward amounts belong to the member experience; the GitHub issue keeps its normal text |
| Own profile editor, visibility settings, activity history, wallet | Signed in, own data only | Personal data |
| Marketplace, inventory, equip | Signed in | Spends coins |
| Members-only profiles | Signed in | Visibility level chosen by the member |
| Reward publishing, moderation queue, ledger corrections | Administrator only | Owner authority |

Legacy design variants (`for-geeks-2.html`, `for-geeks-4.html`, `for-geeks-test.html`, `test.html`, `version-b.html`, `version-c.html`, `versions.html`) contain no member data. Decide at FG-04 whether to keep them, mark them noindex or remove them.

## Issue rewards and feedback

Each published reward has a repository ID, issue ID, integer coin amount, acceptance criteria, version, editor and timestamp. Show the amount before a contributor takes the task. Zero denotes an explicitly unpaid task; missing configuration means not yet reward eligible.

Proposed policy:

- Maintainers publish rewards; contributors cannot edit them.
- Lock the offered reward at assignment/accepted claim time. Changes to an active offer require a visible change history and contributor agreement; no silent retrospective reductions.
- Closing an issue, opening a PR, passing checks or merging an unrelated PR does not independently earn a reward.
- Award the issue budget once after a qualifying merge and maintainer acceptance. A PR can reference multiple issues, but each award requires validated linkage and completed acceptance criteria.
- Multiple PRs completing one issue share its existing budget. Multiple contributors require a recorded split whose sum does not exceed that budget; the default is one accepted recipient.
- Duplicate issues, reopened issues and webhook replays cannot mint another budget. A materially new task requires a new reward allocation.
- PRs without a rewarded issue need a maintainer-approved allocation before payout.
- Feedback enters a moderation queue. Useful feedback and accepted bug reports receive a documented reward determined by the feedback policy or a resulting rewarded task. Avoid paying twice for the same report and task unless explicitly approved as separate work.
- Feedback submissions alone earn nothing. Rejected, duplicate and spam reports receive no award. Non-code work remains eligible when it has accepted deliverables.

Illustrative values only: a small task might offer 25 coins, a medium task 75, and a larger task 200. These are examples, not an automatic formula or committed economy. Set feedback amounts, catalog prices and initial supply together before launch.

## Coins, ranking and corrections

Maintain two separate quantities:

- **Contribution score:** qualifying earned awards minus contribution reversals. Drives monthly/all-time rankings.
- **Spendable Lightning Coins:** posted wallet credits minus purchases and other wallet debits, including approved reversals/refunds.

Example: earn 150 coins, buy a 60-coin banner, keep a contribution score of 150 and a wallet balance of 90. Spending never reduces rank. Refunds restore spendable coins but do not create contribution score. Administrative gifts, if introduced, do not count as contributions.

Use an append-only ledger with award source, amount, recipient, reason, timestamp and idempotency key. Correct errors with linked reversing entries rather than rewriting history. Restrict score adjustments to authorized administrators and record every action. Owner revision (2026-10-24): coins may be earned or purchased through manually verified InstaPay top-ups. Purchased coins do not increase contribution score. Coins remain nontransferable and cannot be withdrawn. Supabase is authoritative; Google Sheets is a reporting/reconciliation copy.

Record earn time separately from event processing time so delayed delivery cannot distort monthly rankings. Define the leaderboard timezone before launch. Equal scores share a rank; ordering within a tie is stable. Show display name, avatar, contribution counts and score only. Members can inspect their own full award history and appeal an incorrect decision.

Reverts require review rather than an automatic penalty for every reverted merge. Confirm attribution and reason before reversing an award. If coins have already been spent, record an explicit debt/hold and block further spending until reconciled, or apply another documented policy; never silently delete owned cosmetics. Finalize this policy before marketplace launch.

## Cosmetic marketplace

Initial catalog: For Geeks themes and profile banners; possible later items include avatar frames and decorative badges. All are visual. No paid visibility boosts, functional tools, private task access, higher reward multipliers or moderation privileges.

Keep a free default, a readable light/dark option and accessibility settings. Recommendation: retain the existing twelve themes as the starter set and sell newly designed cosmetics; confirm before introducing scarcity to existing choices. Motion reduction, contrast and keyboard access must remain free and available with every theme.

Each item has a stable ID, type, preview, description, coin price, active status and asset version. Provide owned/equipped states, a price confirmation, insufficient-funds feedback and persistent inventory. Retired items remain usable for owners unless removed for a documented reason with a refund policy.

Purchasing is one server-side database transaction: verify session and catalog price, lock the wallet, verify funds and non-ownership, debit the wallet, insert purchase and grant inventory. Enforce unique ownership and request idempotency. Concurrent requests cannot overspend or charge twice. The browser never supplies an authoritative price or balance.

Equipping validates ownership on the server and saves the selected item per slot. `localStorage` may cache display preferences; it grants no ownership. Cosmetics are not DRM: CSS and public artwork can be copied; ownership controls official account selection and profile rendering.

## Proposed technical components

- Existing site frontend and Part D design system, extended with accessible account/community screens.
- Supabase Auth and Postgres with row-level security; trusted Edge Functions/server endpoints for awarding, spending and administration.
- Session-aware hosting/gateway for protected developer pages.
- GitHub App/webhook integration with the smallest suitable read permissions on an explicit repository allowlist.
- Production email provider for verification and reset delivery; assess free allowances and delivery limits before launch.

Logical records: private profiles, member display profiles, GitHub links, administrator roles, repository eligibility, reward offers/versions/claims, feedback/moderation, contribution events, award allocations, ledger entries, wallet state, catalog items, purchases, inventory, equipped items, webhook deliveries and audit history. Use database constraints for nonnegative prices, positive rewards, unique identities, unique source awards and unique inventory. Clients cannot write roles, balances, award entries or inventory directly. Private and member-visible fields use separate tables or deliberately constrained APIs.

Validate GitHub webhook signatures against the raw body and deduplicate delivery IDs. Then verify repository eligibility, merge status, stable author identity, issue linkage and reward acceptance. Award issuance and ledger posting must be atomic and independently idempotent by source allocation. Queue retries, record failures without personal payloads, and provide reconciliation for missed/out-of-order events. Contributions predating GitHub linkage may be claimed only after verified ownership and the agreed historical cutoff.

Secrets stay in managed backend configuration; no Supabase privileged key, Google secret or webhook secret in browser assets or Git history. Apply least privilege, authenticated admin operations, safe rendering of feedback, request limits and OAuth callback allowlists. Back up durable records and document restore/reconciliation procedures.

## Main-site membership revision

Account and marketplace are product-wide surfaces, not exclusive to For Geeks. `account.html` and `marketplace.html` reuse the same identity and commerce records with the main-site design. Public navigation exposes them. A dismissible home-page invitation illustrates profile, website cosmetics and accepted contribution benefits. Signed-in visitors do not see it; dismissal pauses it for seven days. App assets and InstaPay top-ups are described as upcoming, not available. Add the new account URL to the auth redirect allowlist before live sign-in acceptance. Assets and packages are still supplied by the owner later.

## Payment and app ownership revision (FG-12)

The owner requests infrastructure first; assets, badges, coin packages and prices will be supplied later. Reuse the existing accounts, ledger, wallet, purchases and inventory. No second wallet or device-bound entitlement system.

Audit follow-up: the earlier Google Doc described the older 58c5f58 snapshot. Current main already includes account/community/market implementation. FG-12 adds payment support rather than rebuilding those features. Implementation evidence and deployment instructions: [Supabase README](../../supabase/README.md#instapay-and-permanent-purchase-infrastructure-fg-12).

Gaps resolved in the backend: immutable request price snapshots; duplicate provider reference and retry protection; paid credits excluded from contribution ranking; MFA for payment approval; bounded pending requests; payment privacy export/anonymization; account-only inventory restoration without expiry/device limits; an empty delivery registry and server-only signing service.

Ownership is permanent for the account, across supported devices. Restoration never charges or consumes it. Deliberate account deletion still destroys online identity/inventory; provide export and explain recovery consequences. Portable non-expiring licenses are copyable and cannot be immediately revoked after a refund. A signature prevents editing, not sharing.

Gaps still open: checkout/WhatsApp and MFA admin UI; Sheets export queue/retries; asset metadata/compatibility shown in the market; native external-browser account connection; public-key distribution and package verification/import; appearance engine and platform acceptance; staged signing-endpoint tests, rate limits, key backup/rotation and live payment reconciliation. Do not sell app items before working PC/phone claiming exists. Packages and deliveries have no production seeds.

Build sequence: top-up/restore backend → checkout/admin/reporting → app identity and offline verification → asset renderer/compatibility → staged acceptance and launch. Contribution features already built remain independent.

## Delivery tracker

All items start unassigned and not started. Create linked implementation issues from these IDs; record their URLs, owner and evidence here as work begins.

| ID | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| FG-01 | Confirm hosting/access boundary, repository allowlist and economy policies | — | Done: policies 2026-10-24; boundary: static public shells, member data behind Supabase sessions and row-level security |
| FG-02 | Design schema, migrations, RLS and private/member API contracts | FG-01 | Done (#61): core schema, 22 tests |
| FG-03 | Email/Google signup, verification, recovery and optional profile | FG-02 | Done (#62, #63): account page, top-bar account menu, return to page, minors guard |
| FG-04 | Server session gate, legacy/origin audit and indexing migration | FG-01, FG-03 | Done by design: no gateway; member pages are noindex shells that show nothing without a session; leaderboard indexed (sitemap, llms.txt) |
| FG-05 | Verified GitHub linkage, issue reward publishing and claim snapshots | FG-02, FG-03 | Done (#70, app #119): GitHub link through Supabase identities, rewards published in the owner console, claims locked at /take |
| FG-06 | Feedback moderation, signed webhooks, accepted awards and ledger | FG-05 | Done (#70, app #119): merge awards from GitHub Actions (no webhook), pending awards until GitHub is linked, feedback queue and awards |
| FG-07 | Member leaderboard, activity history and wallet | FG-06 | Done (#68, #70): leaderboard (month in Cairo time, all time), activity on the account page, wallet chip |
| FG-08 | Cosmetic catalog, atomic purchases, inventory and equip flows | FG-07 | Done (#69): 3 paid themes, 6 banners, market page, atomic purchase, equip synced across devices |
| FG-09 | Admin audit, reversals, reconciliation and deletion/export procedures | FG-06, FG-08 | Done (#65, #70): owner console (rewards, feedback, corrections, moderation, reports, audit), data export and account deletion |
| FG-10 | Security/accessibility verification, staged launch and operations guide | FG-04, FG-09, FG-11 | Partly: 241 automated tests in CI, Chromium checks at 360/1280 px; still open: a signed-in run against the live project after the migrations |
| FG-11 | Public member showcase: visibility levels, work and git setup sections, public view, report and takedown | FG-03, FG-06 | Done (#68): public profiles with verified and self-reported work, setup, report and takedown |

Suggested releases: accounts/access first (FG-01–04); rewards and rankings next (FG-05–07); cosmetics and operations last (FG-08–10). Do not enable spending before transaction integrity and reversal rules are verified.

## Acceptance criteria

- [ ] Email/password and Google users can register, recover access and return to their intended page without creating duplicate member identities.
- [ ] Email is required; all requested personal profile fields can be skipped, edited and removed.
- [ ] Signed-out requests cannot retrieve protected HTML or member data through canonical, legacy or origin routes.
- [ ] Users cannot read another member's private details, assign roles, forge awards or change wallet state directly.
- [ ] Each eligible issue displays an explicit reward; assignment preserves its agreed version.
- [ ] Verified eligible merges and approved feedback produce the intended allocation once, including retries, delayed deliveries and multiple PRs per issue.
- [ ] Incorrect identity claims, unsigned webhooks and non-allowlisted repositories cannot award coins.
- [ ] Spending leaves contribution ranking unchanged; refunds and reversals follow the documented rules.
- [ ] Concurrent purchases cannot overspend; repeated requests cannot double-charge or grant duplicate ownership.
- [ ] Only owned cosmetics can be officially equipped; choices persist across devices, with free accessible defaults.
- [ ] Moderation, awards, purchases and corrections have an auditable history and a reconciliation path.
- [ ] Mobile, keyboard, screen-reader and reduced-motion flows work across login, marketplace and leaderboard.
- [ ] App download and install links work signed out on every page.
- [ ] A new profile is private; only opted-in sections appear publicly, and email, phone, date of birth and wallet never do.
- [ ] Public profiles list verified work from the ledger separately from self-reported work, render free text safely, and can be reported and taken down.
- [ ] Production email, OAuth callbacks, secret configuration, backups and provider limits are reviewed before rollout.

## Decisions

Decided by the owner on 2026-10-24:

- **Eligible repository:** only `LightningEg/Lightning` (the app) earns coins. The website repository does not.
- **Reward authority:** only the owner sets issue rewards.
- **Leaderboard timezone:** Africa/Cairo.
- **Profile data:** collect all optional fields (phone, date of birth, name, avatar), each skippable, each with its purpose shown at collection. An age policy for date of birth is still needed; draft it before launch.
- **Reverts:** no automatic reversal of a merged-PR award in the first release. An authorized administrator may still post a linked correction entry for a clear error, such as a wrong amount. This narrows the reversal rules above for the first release.
- **Coin name:** "Lightning Coins" stays the working name. Keep it as a single configuration value so a rename is one change.
- **Hosting:** Supabase free plan, Europe region, project created. No payment method attached.

Assumed, pending owner confirmation: For Geeks pages stay static and public on GitHub Pages as empty shells, and all member data (tasks with rewards, profiles, wallet, inventory, leaderboard) is gated by Supabase sessions and row-level security. This avoids a gateway and its quota. A Cloudflare Worker is a later option only if guide and roadmap pages must be hidden; it must fail closed.

Still open:

1. Amount ranges, claim expiry, shared-work splits, feedback rules and appeals.
2. Refunds and item retirement policy (prices set: themes Moss 150, Garnet 200, Frost 250; banners 40–120).
3. Retention periods (deletion is built: personal rows go at once, the ledger is kept without a name).
4. Production email provider (the built-in Supabase email is rate-limited), current free-tier overage behavior, and operational owner.
5. Historical contribution policy and reward start date for the app repository.
6. Public showcase: confirm the 18+ confirmation rule, whether to add static pages for search indexing later, and which git-setup fields to offer.
7. Owner review of privacy notice section 6 (published 2026-10-25, version 3).

## Scope and operating costs

This document authorizes tracking of the proposal; it does not indicate that authentication, rewards or a marketplace are deployed. Manual InstaPay top-ups are now authorized for infrastructure development; cash redemption, trading, random loot boxes and functional purchases remain outside scope. Checkout stays disabled until real owner configuration and end-to-end acceptance. Existing financial data remains outside community storage.

Start with free allowances where suitable, but do not promise permanent zero cost. Verify Supabase quotas, database/storage/egress limits, inactivity behavior, backups, email limits and gateway hosting costs against current provider plans when implementing. Add usage alerts and a recovery plan rather than relying on a free tier indefinitely.

## Change log

- 2026-10-24 · Codex: main-site account/market surfaces and illustrated membership invitation added; FG-12 starts additive InstaPay top-up, reconciliation, delivery registry and signed restoration infrastructure; assets/packages remain unconfigured.

- 2026-10-25: Built FG-04 to FG-09 and FG-11 (#63–#70, app #119): account menu, data export and deletion, privacy notice v3, keep-alive, leaderboard and profiles, market, rewards pipeline and owner console. Tracker updated.
- 2026-10-24: FG-03 built: account page (unlinked, noindex), vendored Supabase client, minors guard migration. A birth date under 18 keeps a profile strictly private, in the page and in the database.
- 2026-10-24: Added access map (app download always public), opt-in public member showcase and FG-11; Supabase and Google sign-in setup reported complete.
- 2026-10-24: Owner decisions recorded (app repository only, owner-set rewards, Cairo timezone, collect all optional profile fields, no reverts in first release); Supabase project created; hosting boundary assumed pending confirmation.
- 2026-10-24: Initial proposal records account gating, optional profile data, Google authentication, feedback/PR recognition, per-issue Lightning Coin rewards and a cosmetics-only marketplace.
