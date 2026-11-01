# Landing page: five advantages

Status: plan and copy draft, awaiting owner approval. Branch `claude/landing-five-advantages`.

## Why

The home page was built as a product tour. Showing features belongs on Features; the home page should say why Lightning, in five claims a visitor can repeat after thirty seconds.

## Objective

A first-time visitor in Egypt leaves the home page knowing Lightning is **free today**, **private**, **comprehensive**, **built around what you own rather than what is in your accounts**, and **made for Egypt**, and downloads or joins early access because of it.

Success:
- Each claim has its own section and one proof.
- No feature tour on the home page; Features carries it, with screens.
- Two calls to action only: Download free, Get early access.
- Every claim is true of the app today (B10); compares only with a kind of tool, never a named product (brand voice).

## Owner decisions (2026-11-01)

1. Free: say "free today". Cosmetic themes stay optional and never lock a money feature.
2. Comprehensive: tell the problem first (scattered tools, each seeing one corner), then show the depth. No proof tiles.
3. Competition: general kinds only (bank apps, expense trackers, spreadsheets).
4. Hero stays: "All Your Money. One Clear Picture."

## Page order

| # | Section | Claim | Proof |
|---|---|---|---|
| 0 | Hero | unchanged | Overview on PC and phone |
| 1 | Free | Every money feature, free today | Promise cards, reworked |
| 2 | Private | No bank login, no server | One encrypted ledger, pair once |
| 3 | Comprehensive | One tool where three or four were needed | Problem, then investments, expense analysis, cash flow |
| 4 | Own versus hold | In your accounts is not what you own | 995,703 in accounts, less 6,900 held for family, 988,804 owned, less 78,500 owed, 910,304 net worth |
| 5 | Made for Egypt | Built for how money works here | EGP and dollars at your rate, gold, certificates, gam'eya, wallets, bank SMS, Arabic |
| 6 | FAQ, signup band, sign-off | unchanged | |

## Copy draft (site headings are Title Case, B02)

**1 · Free.** Label: Free today. H2: Every Feature. No Price. Line: Every money feature is free today: no trial, subscription or paywall. Optional themes let you support us; they never lock a feature.

**2 · Private.** Label: Private by design. H2: Your Money Stays with You. Line: No bank login and no server. One encrypted ledger on your phone, borrowed by your PC, opened with your password.

**3 · Comprehensive.** Label: One tool, not four. H2: Your Money Lives in Four Tools. Line: A bank app for the balance, a tracker for spending, a spreadsheet for investments, and a notebook for what is coming. Each sees one corner. Lightning puts them in one ledger: Investments (cost, gain, dollars in pounds), Expense analysis (where it went, and why it changed), Cash flow (the next three months before they arrive).

**4 · Own versus hold.** Label: Accounts or ownership. H2: In Your Accounts Is Not What You Own. Line: 995,703 EGP sits in nine places. 6,900 of it is held for family and 78,500 is owed. What you own is 988,804, and your net worth is 910,304. Most apps stop at the first number.

**5 · Made for Egypt.** Label: Made in Egypt. H2: Built for Money in Egypt. Line: Pounds and dollars at your own rate, gold at home, NBE certificates, a gam'eya, Vodafone Cash, bank SMS read for you. In Arabic that is Egyptian, not translated.

## Work packages

1. Owner approves this copy.
2. Guideline: B01 allows screens on Features; update B05 if needed. Change `guideline/` here and in the app repository together.
3. `features.html` gains the moved showcase (sync, themes, ahead, tedious-part) with real screens.
4. `index.html` rebuilt from B06 blocks in the order above; loads `css/landing.css`, `css/home.css`.
5. `ar/index.html` mirrors it in Egyptian Arabic.
6. README (Landing pages), version archive row, `python tools/app_release.py sync --write`.
7. B12 checklist, phone width, dark mode, SEO title and description.
