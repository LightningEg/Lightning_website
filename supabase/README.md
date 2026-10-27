# Supabase (For Geeks accounts and Lightning Coins)

Design and status: [docs/proposals/forgeeks-accounts-lightning-coins.md](../docs/proposals/forgeeks-accounts-lightning-coins.md). The main site and For Geeks share this database for accounts, wallet, marketplace, stories and owner operations. Financial app records stay on devices.

## Apply the migrations

Supabase dashboard → SQL Editor → New query → paste one file from `migrations/` → Run. Apply the files in date order, each once. Already ran the first one? Run only the files after it. Later changes go in new, later-dated files; never edit an applied migration.

1. `20261024190000_forgeeks_core.sql`: tables, ledger, wallet, purchases, rules.
2. `20261024210000_forgeeks_minors_guard.sql`: a birth date under 18 keeps the profile private.
3. `20261025090000_forgeeks_account_lifecycle.sql`: download your data, delete your account.
4. `20261025100000_forgeeks_rewards.sql`: GitHub link, claims, merge and pending awards, feedback, task board, owner console helpers.
5. `20261025110000_forgeeks_showcase.sql`: public profiles, members directory, profile reports.
6. `20261025120000_forgeeks_market.sql`: the paid themes and banners, market catalog.

## Rewards from the app repository

`LightningEg/Lightning` runs `.github/workflows/rewards.yml` and the claim steps in `contributors.yml`: `/take` records a claim that locks the offered coins, and a merged pull request that says `Closes #n` pays the issue's coins to its author (held until they link GitHub on the account page). Bots and the owner's own account earn nothing. Both need the repository secret `SUPABASE_SERVICE_ROLE_KEY`; without it they print a notice and do nothing.

GitHub linking needs, once: a GitHub OAuth App whose callback is `https://etecxblerynmkgppdfac.supabase.co/auth/v1/callback`, its client id and secret in Supabase → Authentication → Providers → GitHub, and Authentication → "Allow manual linking" switched on.

## Keep-alive

`.github/workflows/supabase-keepalive.yml` reads one public row every two days so the free project never pauses. A red run means the project is paused: restore it in the Supabase dashboard.

## Make yourself the administrator

Sign in once on the site (or create your user in Authentication → Users), then run this in the SQL Editor with your own address:

```sql
insert into public.admin_roles (user_id, role)
select id, 'admin' from auth.users where email = 'YOUR-EMAIL-HERE';
```

Lightning has **one** owner account: once one is listed, adding a second is refused. If an older database lists more than one, sign in with the account you keep, verify MFA on `admin.html`, and use Settings › Owner account › *Make this the only owner account* (`admin_keep_only_me`); only that account then sees *Owner console* in the menu.

Do not commit your address. Administrators publish rewards (`publish_reward`), correct the ledger (`admin_correct_entry`) and moderate profiles (`admin_suspend_profile`).

## Sign-in settings

Authentication → URL Configuration. Site URL: `https://lightningeg.com`. Redirect URLs: add `https://lightningeg.com/account.html` and `https://lightningeg.com/forgeeks-account.html` (and `http://localhost:8000/forgeeks-account.html` to test on your computer). Google sign-in uses the callback URL Supabase shows in its Google provider settings.

## Keys

- The publishable (`anon`) key may sit in site JavaScript. It can only do what the row-level security rules allow.
- The secret (`service_role`) key stays in Supabase or GitHub Secrets. It is the only role that can call `award_coins`.

## Tests

```
npm i --no-save @electric-sql/pglite jsdom
node supabase/tests/schema.test.mjs    # the database rules
node supabase/tests/account.test.mjs   # the account page, with a fake Supabase client
```

The tests run the migration on a real Postgres engine with Supabase's roles stubbed and check the access rules as each role. They cannot run truly parallel purchases (one connection); overspend protection rests on the wallet row lock plus `CHECK (balance >= 0)`.

## InstaPay and permanent purchase infrastructure (FG-12)

Apply `20261025130000_insta_pay_topups.sql` after migrations 1–6. It is additive and does not seed packages, prices, payment addresses or assets. Existing website cosmetics are untouched. This is backend infrastructure, not a live checkout or a finished PC/phone claim screen.

- Trusted configuration creates `coin_packages`; rows are inactive by default. Prices are integer piastres and coins are integers. New requests snapshot the agreed amounts.
- A member calls `request_topup(package_id, request_key)` with a UUID retry key. The returned request UUID is the support/payment reference. `cancel_topup(request_id)` only cancels that member’s pending request. Customers cannot approve or write payment tables.
- An administrator calls `admin_review_topup(request_id, decision, received_piastres, payment_reference, note)` after checking the actual incoming transfer. Their Supabase session must have MFA assurance `aal2`. No service key or typed browser MFA flag is accepted as proof. Duplicate payment references are normalized to uppercase and rejected across requests; retries of the same approval return the original credit.
- Paid coins post `paid_topup` entries to the existing ledger; the trigger updates the existing wallet, with contribution delta zero. Existing `purchase_item` spends them normally. Corrections remain linked ledger entries; an approved payment record describes the original settlement, even if a later ledger correction reverses it.
- `admin_wallet_reconciliation()` returns each balance, ledger sum and difference. Use this for private CSV/Sheets reporting; it grants no spreadsheet write authority. Automated Sheets export and bank-transfer matching are still to build.
- Payment history is included in `export_my_data`. Account deletion anonymizes top-up ownership while retaining the provider reference against duplicate credit. It deliberately deletes online inventory as the existing account-deletion policy does; users must export purchases before deletion. A portable offline package cannot be revoked immediately.
- `item_deliveries` registers supplied assets by item, platform, version, minimum app version, HTTPS URL and SHA-256. No rows are seeded. An owned item may have no app delivery yet: it remains website-only, and must not be advertised as usable in the app. Only trusted configuration writes deliveries. Desktop/phone clients must still validate allowed asset hosts, safe package contents and compatibility before installing.
- `restore_store_inventory()` returns only the authenticated account’s permanent owned items (including retired items) and delivery metadata. Calling it does not consume or charge ownership. It is not itself a signed offline license.

### Signed restoration endpoint

`functions/restore-purchases/index.ts` is a Supabase Edge Function. Deploy it with JWT verification enabled, and configure these backend secrets first:

- `STORE_SIGNING_PRIVATE_JWK`: an Ed25519 private JWK, generated and backed up outside Git.
- `STORE_SIGNING_KEY_ID`: a stable identifier. Ship its corresponding public verification key with app clients; retain old public keys through rotation.
- `STORE_ALLOWED_ORIGINS`: comma-separated exact browser origins, such as the production website. Native clients can omit Origin; they still need a valid authenticated user token.

The standard Supabase URL and anon key come from the function runtime. No service-role key is required: the function verifies the user token, then calls the inventory RPC under that user’s identity. A missing signing configuration returns 503, with no secret details. POST returns `{algorithm, key_id, payload, signature}`. The Ed25519 signature covers the exact UTF-8 payload string; signature encoding is base64url. Clients must reject unknown keys/algorithms, verify before parsing, and check the expected account. There is no license expiry, hardware identifier or activation quota. Signing does not prevent an owner copying a portable cosmetic license.

The signing primitive is tested with disposable generated keys. The Deno HTTP wrapper still needs staged Supabase deployment tests (JWT rejection, CORS, outages and secret configuration) before release. Apply provider rate limits for restore/download traffic before enabling sales. Store credentials separately from ledger/profile backups. Do not load remote store pages into the privileged local WebView.

### Still required before accepting payments

Owner payment details/QR and coin packages; bank reconciliation and optional Sheets exporter; app account connection; license verification/import and theme renderer on PC/phone; asset publication and actual prices; live end-to-end acceptance. No example assets or coin packages should be treated as production data. Only Mono remains free; all other palettes require ownership.

## Main-site account and marketplace

`account.html` and `marketplace.html` use the Part B main-site design with the same forms, auth client, wallet, catalog and inventory as For Geeks. `tools/site_accounts.py` generates their markup and theme preview registry from the existing community pages; run it and then `python tools/footer.py` after changes. Main-site navigation includes both destinations. The home-page invitation has three explanatory illustrations, English/Arabic copy, native modal focus handling, signed-in suppression and a seven-day dismissal preference. These illustrations are not catalog assets.

Add `https://lightningeg.com/account.html` (and the localhost equivalent for development) to Supabase Authentication redirect allowlists before using Google signup, email verification or password recovery on the new page. Keep existing For Geeks callback URLs. Main account/market screens are English; Arabic navigation and the invitation point to those shared screens and state this in the invitation.

Automated acceptance: all `supabase/tests/*.test.mjs`; optional real Chromium: install `playwright-core@1.58.2`, run `python -m http.server 8000 --bind 127.0.0.1`, then `node supabase/tests/main-site-browser.mjs`. Browser tests intercept authentication and never use the live Supabase project. The test currently uses `/usr/bin/chromium`.

## One purchase, one profile: seats and codes (2026-10-27)

Owner rule: buying an app theme unlocks it for **one Lightning profile**. `20261027130000_profile_seats.sql` builds it.

- **The seat.** A purchase comes with one seat. The website code (`issue_activation_code`, unchanged: ten minutes, single use, hashed) claims it. The app sends its own profile id, which is the same on every device that profile lives on; `redeem_activation_code(code, item, version, profile_id)` then either finds that profile already holding a seat (another device of it: free) or takes a free seat for it, and **burns the code**. With no free seat the claim is refused and the code is **not** burned. The signed licence names the profile (`profile_id`), so the app wears the theme only for that profile.
- **Another profile.** The owner of the theme can add a seat for **25% of its price** (75% off, rounded up, at least one coin) with `purchase_theme_seat(item, expected_price, key)`: once per key, a changed price refuses, ten profiles at most, the theme must be in an app release. It is a ledger purchase, so it shows in Sales, Activity, the wallet history and the data export.
- **The pages.** Each owned app theme on the marketplace and your collection shows "1 of 1 profile unlocked", **Get app unlock code** and **Add another profile · N coins** (a confirmation first). `my_theme_seats()` feeds it.
- **Support.** The owner console's Members view lists a member's claimed profiles (`admin_profile_claims`) and frees a seat for someone who lost a device or profile (`admin_release_profile_claim`, reason required, kept in the audit log).
- **The edge function.** `redeem-purchase` now requires `profile_id` and answers **409 `no_seat`** when every seat is used, so the app can say what to do. Redeploy it together with the migration; an app that does not send a profile id is told to update. The signed payload keeps `schema_version` 1 and adds `profile_id`.
- **Offline and portability.** A licence is signed and checked offline against the profile id; it is still a copyable file, and a copy only works on a profile with that id. This limits sharing between people, it is not strong DRM.

## Marketplace cart and sales tracking

Apply `20261027090000_cart_and_sales_tracking.sql` after the migrations above. It adds a server-side cart so the cart follows a member between devices, an all-or-nothing checkout, and the numbers the owner needs to see what sells. Cosmetics only; every charge is still a ledger entry through the existing purchase functions.

- **Cart:** `cart_view()`, `cart_add(item)`, `cart_remove(item)`, `cart_clear()` for the signed-in member. A cart holds up to 25 lines; only what is on sale, not owned, not free and not earned can be added. A set in the cart covers its parts (they ride inside it at no extra cost); a set that shares parts with another set already in the cart is refused. Tables are private: members use these functions, never the tables.
- **Checkout:** `checkout_cart(expected_total, key)` prices the cart now, refuses the whole order if the total differs from the one shown, if any line stopped being available, or if the wallet is short, then buys each line through `purchase_set` / `purchase_item_at_price` in one transaction and empties the cart. The key (8 to 36 characters) makes a retry return the same order and never charge twice. Each line keeps its own purchase and ledger entry; `orders` and `order_lines` group them.
- **Tracking:** `cart_events` records add, remove, clear and checkout, written only by those functions. Deleting an account removes its cart and orders and keeps the events without the person. `admin_sales(days)` (MFA administrator) returns sales by day, item, type and channel (cart, direct, gift), the order count and basket size, the funnel (added, started, checked out, taken out again), carts waiting now and carts stalled over a day, and the latest orders by short id. It names no member.
- **Pages:** `js/market-cart.js` adds the chip, the add-to-cart buttons and the cart window to `marketplace.html` (For Geeks keeps buying one item at a time). The owner console has a **Sales** view (`js/owner-sales.js`). Regenerate with `python tools/site_accounts.py`, `python tools/store_admin.py`, then `python tools/footer.py`.
- **Tests:** `cart.test.mjs` (database), `cart-pages.test.mjs` (cart window), `owner-sales-pages.test.mjs` (Sales view).

Not built: shipping or fulfilment (everything is delivered to the account at once), discount codes, and cart reminders by email.

## Activity audit, profile pictures, collection and merge rewards (2026-10-27)

- **Activity audit** (`20261027100000_activity_audit.sql`, owner console **Activity**). `admin_activity(category, search, before, limit, days)` lists coins, scores, sales and the owner's own actions, newest first, for MFA administrators. It adds no second copy: it reads the append-only ledger (every coin and score change; a purchase, set or gift is a ledger row, enriched with its item, gift recipient and cart order), and `audit_log` (append-only; everything the owner and the workflows did). Categories: all, coins, scores, sales, owner actions; search matches email, display name, item, order or reference with wildcards treated literally. The summary adds up the last 30 days (paid in, given, spent, refunded, corrections, score awarded, manual credits). **Save as CSV** writes what is on screen and neutralises cells that start like a formula. The file names members: keep it private.
- **Profile pictures** (`20261027110000_profile_pictures.sql`). The browser crops to a square, shrinks to 256 px (dropping camera data) and uploads one file, `<random key>/avatar`, to the public `avatars` bucket (256 KB, PNG, JPEG or WebP). The key is private to the member (`ensure_avatar_path()` makes it, `my_avatar_path()` reads it) and unrelated to their account id, so a public picture address never reveals the account. Policies let a member write only that file; an administrator may delete any. A trigger lets `avatar_url` be set only to the member's own file (links saved before this stay until changed). `admin_remove_avatar(email, reason)` clears the link at once, logs the reason and returns the file's path; the console's Members view then deletes the file through Storage. Account deletion removes the picture (redeploy the `delete-account` function after applying the migration).
- **Your collection** (`collection.html`). The market drawn with only what the member owns: equip, wear across the website, and **Get app unlock code**. It is in the community bar, the account menu (**my collection**) and the marketplace. Regenerate with `python tools/site_accounts.py`.
- **Merge rewards for this repository** (`20261027120000_website_repo_rewards.sql`, `.github/workflows/rewards.yml`). A merged pull request that closes an issue of `LightningEg/Lightning_website` pays its author through the same `award_merge()` path as the app repository (one award per issue; the owner publishes each offer first). Add the Actions secret `SUPABASE_SERVICE_ROLE_KEY` to this repository, or the workflow only prints a notice.
- **Account chip**: `js/site-membership.js` no longer replaces the top-bar icon with the words "My account" while the profile loads; it only sets the accessible name.

## Swappable parts, activation codes and proof policy

Apply `20261025140000_activation_and_payment_proof.sql` next. No bundled app versions are enabled by this migration. `cosmetics/slots.json` inventories eleven appearance compartments; each theme JSON is its per-part guideline. The supplied PDFs are references, not executable assets or binding policy. The two new designs are sandbox previews on the main marketplace, unpriced and unavailable for paid app delivery until integration/acceptance. Textile products and currency naming remain optional design backlog. See [parts contract](../cosmetics/README.md) and [manual payment policy](../cosmetics/payment-policy.md).

Only after an app release bundles and supports a specific item/version should trusted configuration enable its `bundled_item_versions` row. Owners then get a **Get app unlock code** button on the main marketplace. `issue_activation_code(item_id, asset_version)` returns a 122-bit random UUID code, displayed in four copyable groups. The database keeps only its SHA-256 hash, expires it after ten minutes and caps issuance at twenty per account/hour. Redemption is serialized and single-use. Codes and private signing material never enter audit logs. An account purchase has no expiry/device cap; another PC/phone gets another code free.

`functions/redeem-purchase` exchanges the ticket for the same Ed25519 envelope used by restoration. Deploy this endpoint with JWT verification **disabled for this endpoint only**, because a native app presents a random bearer code rather than a member JWT; it uses the backend service key for the narrowly granted redemption RPC. Keep restore-purchases JWT verification enabled. Add gateway request limits before enabling this endpoint; code entropy is not a substitute for abuse control. The redeem wrapper bounds body size, rejects browser Origin requests, validates signing configuration before consumption and never logs the code. Expired/used/unsupported codes fail closed. If a response is lost, the owner issues a new code without repurchasing; no automatic reuse of spent tickets. An old app must supply the exact locally supported item/version and refuse an unsupported response before saving a license.

The app-side companion branch bundles both data manifests and implements offline signature verification. It does not yet add an activation screen, cache persistence, the part-to-component renderer or a release public-key registry. Those remain release gates. Do not enable bundled versions based only on the data manifests being present. A short random code cannot be reliably redeemed once entirely offline; offer signed-file import as the offline alternative. A portable signed license is copyable; this accepted cosmetic limitation must not be described as strong DRM.

Historical WhatsApp flow (superseded by the website receipt workflow below): before showing QR/address, checkout must show `manual-final-v1` and call `accept_topup_terms`. The member later calls `submit_topup_reference`, then sends their own payment receipt to WhatsApp Business. An MFA administrator records visual receipt review with `admin_record_topup_proof`, then separately checks the actual incoming transfer and calls `admin_review_topup`. Approval now refuses missing terms/customer reference/screenshot review. WhatsApp image handling is still private and manual; no receipt upload bucket or OCR is implied. Customer/sender references may differ from the receiving bank reference, so do not require literal equality between them.

The no-discretionary-refunds policy is stated before payment with an explicit acceptance timestamp. Mandatory rights and manual correction of payment/delivery errors remain available; no refund feature or automatic clawback is added. Checkout and MFA admin UI are now available. Live payment acceptance remains gated on owner configuration and an actual reconciled transfer.


## Website operations and community stories (owner revision, October 24)

Apply migrations 1500, 1600, 1700 and 1800 after the existing eight migrations. Production was inspected and these four were applied through the Supabase connector; The earlier manual migrations were subsequently verified and their history baselined; do not replay applied files.

- Open `admin.html`, sign in with the administrator account, enroll an authenticator and verify its code. The backend requires an actual AAL2 session for credits, configuration, moderation and payment approval. The credit form accepts an account email, separate coins and recognition points, and a reason. A retry key prevents double credits; New request starts another credit.
- Configure the real receiving details and upload a private QR in the owner console. Customers enter an amount; there are no bundles. The default is 5 coins per EGP, a 10–10,000 EGP range, and 5%/10%/15% bonuses from 100/500/1,000 EGP. Configuration starts disabled. Do not use a personal transfer test as proof that all production payment cases have been accepted.
- `topup.html` requires explicit terms before checkout. It snapshots destination, amount and signed-in account email. The customer copies that email into InstaPay's note, transfers, then supplies the sending InstaPay address, payment reference and their own receipt image.
- Receipts live in a private 5 MB JPEG/PNG/WebP bucket with owner-only upload and owner/MFA-admin read policies. A receipt alone never credits coins. Admin opens a short-lived signed image, records review, checks the actual incoming bank transfer and enters the received amount and bank reference before approving. Replacement evidence invalidates the earlier review. Database locks and reference uniqueness prevent repeated credits.
- Supabase's immutable ledger is the balance source. Sheets can be an export for reconciliation, never a second writable balance. Routine operations use the admin UI, not SQL. Account purchases persist across website devices; native claim/render integration remains a separate release gate.
- **Community posts** (`stories.html`, migration `20261025230000_community_social.sql`, not deployed; apply after audit migrations 1900/2000/2200; retire old RPCs with 2100 after the frontend deploy). The site hosts no story text: a member lists a link to their own LinkedIn or Reddit post with a title and a 20–400 character summary, plus an 8-character verification code to put in that post. Submitting needs consent, a link and a public adult-confirmed profile. An administrator (MFA) opens the external post, checks the code, then publishes with rank points (0–500, `recognition`) and/or spendable coins (0–500, ledger kind `story_coins`, never raising rank). Each accepted source URL pays once, a member can be paid for at most 3 posts in 30 days, and the copy button supplies the verification code and link back to Lightning. No automatic posting, no engagement rewards.
- Frames and badges are catalog items (`frame-*`, `badge-*`) drawn from CSS and inline SVG; they appear on the leaderboard, member cards, profile and post cards. `leaderboard`, `member_directory`, `get_profile` and `stories_feed` return `frame_item_id` and `badge_item_id` only.
- Only Mono is free. The eleven formerly free non-Mono starter palettes initially cost 100 coins each; the original three paid palettes retain their prices. Existing inventory and previously equipped free palettes are preserved. Admin can change paid prices; Mono stays free.

The owner test award is 200 recognition points and no wallet coins. Production tests use a fixed idempotency key; never replay an unkeyed manual insert. Receipts require an owner retention/deletion process before public paid launch; do not expose their URLs in public feeds or ledger text.

## Full flow audit and finalization

See [the start-to-finish audit](../reports/2026-10-24-marketplace-flow/report.md) for fixes, evidence and launch requirements. Migrations 1900/2000 add quoted-price purchases, atomic evidence-revision approval, bounded receipt reservations, package retirement/idempotency, stricter admin MFA/session checks and Storage-aware account deletion. Deploy the authenticated `delete-account` Edge Function before publishing the account script. Its explicit `getUser` validation requires `verify_jwt=false` at the gateway; its RLS-scoped client uses no service-role key. Follow-up migration 2200 removes the public views’ direct Auth table dependency while preserving current-member checks. Migration 2100 retires obsolete endpoints after the browser deployment. Every changed browser script receives a new version URL.

Owner operations now include unpaid cancellation, rejection notes, package availability, wallet reconciliation and receipt cleanup. Run the receipt cleanup control periodically: eligible images older than 90 days can be deleted, while pending payment evidence is protected. File deletion always uses the Storage API. Account deletion removes receipt files first, blocks unresolved pending payments and clears retained sender identity; interrupted cleanup can be retried or its preparation cancelled.

## Payment and social operations

See [the operator runbook](../docs/payment-operations.md) for private checkout configuration, bank reconciliation, exceptions, rewards, deployment order and pricing assumptions. Migrations 2300/2400/2500 add link listings, amount-based checkout with private QR delivery, a bank journal, member-approved quote adjustments, and verified social moderation. Real receiving details and QR bytes are runtime configuration and must never be committed.
