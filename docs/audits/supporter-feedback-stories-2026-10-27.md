# Feedback, combined support and story tickets

- Based on merged PR119, commit 5958c5ebb7c873fbe1a7de93d4b64511b4e8b797.
- Live public coin_rate verified: 5 Cotton/EGP, 2026-10-27.
- Accepted feedback gives 10 score/10 Cotton; owner MFA required, bonus reason required.
- Supporter thresholds: Bronze100/Silver250/Gold500/True1000 EGP equivalent = confirmed money + net score/5. Bonus top-up Cotton and gifts do not inflate support. Spending does not remove support. Historical earned badges retained.
- Public supporter_levels returns only display name, earned level and badge ID under visibility consent. Personal progress exists only for the authenticated requester.
- No social post verification code or mandatory backlink. Title, excerpt, link and author name are sent in one form; owner review, consent, current revision and original-award guards remain. Author name is review context, not verified identity.
- Arabic Community/Marketplace share purchase logic, account and catalog with English. For Geeks remains English.
- Try-on, purchase/cart confirmations and actual observed leaderboard changes use short transform/opacity reactions, disabled under reduced motion. No fake rank history.

## Acceptance checks
- Full test suite: all 47 test files passed, zero failed. Cotton cart tests retained.
- Page check: 93 pages, zero errors, 15 existing warnings.
- Real public preview checked at1280 and390 pixels in both languages, with no horizontal overflow or page exceptions; try-on visibly changes both pages.
- Database rules exercised on isolated Postgres with real migrations, not production writes. UI form tests use explicitly mocked service responses. Authenticated end-to-end production approval/purchase unavailable; not claimed verified.
- Owner must merge and apply the three NEW migrations in this PR to existing backend (previous migration completion does not apply to these). No new Lovable Cloud instance created.
- Rank-change reaction requires a previously observed rank in the same session; first load remains still.
