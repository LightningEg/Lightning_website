# Website audit against guideline 3.6 · 2026-10-03

## Current reading · 2026-10-24

This report records the 2026-10-03 site snapshot. Its “Next steps” section is historical, not a live work list. The site has since moved to `index.html`, `how-it-works.html` and `current-status.html`; `version-b.html` and `version-c.html` now redirect to `index.html`. Read [Current Status](../../current-status.html) for current download facts. Track any remaining product decisions in the active plan.


Scope: the three landing pages and the two shared pages, checked against [guideline 3.6](../../guideline/website.html) Part B (B01 to B11) and the Part A rules the site borrows (colour, numbers, buttons, icons). Each page was rendered at 320, 390, 640, 760, 900, 1000, 1100 and 1280px, in light and dark.

> **Update, later the same day: owner decisions (guideline 3.7).** After seeing Version D, the owner chose centred hero and section headers, a short label above each section, and the hero's punch line in the gradient. Guideline 3.7 now says so, which overrules items 1 to 3 below for headers, labels and the hero (gradient words in *section* headings are still out). The site's logo is now the two-leaf mark from A02 everywhere; the old ribbon mark stays only in archived pages.

| Page | Release | Verdict |
|---|---|---|
| A · `index.html` | UX-2026.10.02.07 | Clear story, but a near copy of B; numbers in "six places" don't add up; placeholders and an out-of-date FAQ |
| B · `version-b.html` | UX-2026.09.30.05 | Same as A, one section different |
| C · `version-c.html` | UX-2026.09.30.03 | Most off-guideline: placeholder testimonials, four quotes, vague words, a return that reads as promised |
| How It Works | UX-2026.10.01.07 | Best structure on the site (a real sequence on real screens); styling breaks the guideline |
| Current Status | UX-2026.10.02.08 | Answers the wrong question: B01 says "what is built and what is next"; it is a beta-tester hub |

## On every page (shared CSS)

1. **Eyebrow labels above every heading** (B02, B11). "PRIVATE BY DESIGN", the guideline's own "never" example, is on A and B.
2. **Gradient words in headings** (B02, B03.1): every hero H1, "You Just Don't Have a System.", "Analysis", "Status.", "See the Full Picture." and the 56px footer motto.
3. **Section headers centred** (B02 and B05: left aligned).
4. **Title Case buttons and arrows in buttons** (B11, A10.1): "See What Small Changes Are Worth", "Get Early Access", "Take the Survey · 3–5 min", "How It Works →".
5. **Vivid result card** (B08, B11): the calculator result sits on the vivid gradient. The How It Works "Sit down for analysis" segment and the founder avatar are vivid too.
6. **Sizes over spec** (B04, B05): H1 84 to 86px (max 78), result 68px (max 64), H2 up to 50 to 58px (max 48), 96px between sections (72).
7. **Glyph icons** ⌂ ✓ = ↯ instead of Lucide (A15).
8. **Strong rose on ordinary money out** (A03, A11, B03): "−10,000", "−1,309" and "150 EGP a day". Strong rose means "needs you"; on the site it is for errors only. Money out is ink with a minus.
9. **Phones lose the navigation**: below 640px the header hides How It Works and Current Status, leaving only the footer and the Testing tab.
10. **Pages scroll sideways** (B05): at 760px A, C and How It Works are 800px wide and Current Status 792px; A is also 330px wide at 320px.
11. **Top bar not the same everywhere** (B02): Current Status, the archive and app feedback swap "Take the survey" for "Send feedback". The guideline draws the button as secondary; the site uses Nile primary.
12. **Footer** (B05: lockup · tagline · links) carries a 56px gradient motto.

## A and B

- **Near duplicates.** Same hero, same picture, safe-to-spend, calculator, tour, trust, FAQ and signup. They differ in eyebrow wording, where the quote sits and one section (Three Truths against How Small Changes Become Wealth). Testing them against each other measures very little.
- **Numbers that don't add up** (A01 honest numbers): "Family money in your bank, 10,000" is a sixth tile on top of a bank balance that already contains it. The tiles add to 270,566; the card says "What you own 250,565: everything, minus family money", and a reader gets 260,566.
- **Placeholders on the page** (B11): pricing and the founder note.
- **FAQ out of date** (B10 "describe only what the app does today"): "Windows, Mac and Linux, setup needs Python 3.11" and "opens in your browser". Current Status offers a Windows ZIP that needs neither.
- **Hero over spec**: eyebrow, a two-line lead, a three-item checklist and two buttons. The primary button jumps to the calculator, not to Get early access (B01).
- **Calculator** (B08): starts at 1,000 (spec 2,000); "an illustration, not a forecast" is in a footnote, not under the result; no Get early access beside the result.
- Ten sections, 8,250px tall at 1280px.

## C

- **Five placeholder testimonials** with ★★★★★, "[Full name]" and "[Role] · [City]" (B11).
- **Four quotes** on one page (B06: one at most).
- **Words** (B10): "Wanna Play a Game?", "Wealth Management Made Easy", "See What You Are Worth". "At 20% a year, that pays you about 2,000 EGP a month" reads as a promised return ("Earn 20% a year" is a B10 never).
- "Your money lives in five places", against six on A and B.
- Privacy only appears near the end; no FAQ.

## How It Works

- Strong: the three steps are a real sequence, every screen is real and the minutes add up to thirty.
- Eyebrows, gradient words ("Once a Month.", "Analysis"), all-caps labels ("WHAT YOU DO", "GOOD TO KNOW", "3 MIN") and a vivid segment.
- The logo and Home default to `version-c.html`; Current Status defaults to `index.html`. A first-time visitor gets a different Home from each.
- H1 82px.

## Current Status

- **Wrong question** (B01): nothing on the page says what is built and what is next. The answer exists in the app's Project Overview roadmap (desktop preview 0.4.0b1; next: legacy import, backup restore, ordinary-PC testing).
- **Two goals** (download and feedback); it doesn't end with the signup band, and the B01 goal (Take the survey) is missing.
- Sentence-case H2s ("A better system beats one big hit.", "Can you import?"), em dashes and a placeholder ("WhatsApp beta group · Invite coming soon").
- A one-row table with a "swipe" hint for a single download.
- The founder story is here, while A and B show "[Founder note placeholder]".

## Version D

`version-d.html` (UX-2026.10.03.01) fixes each item above, using only the guideline:

| Guideline | In D |
|---|---|
| B02 headers | No eyebrows, no gradient words, Ink headings, H2 left aligned, Title Case headings, sentence-case buttons without arrows |
| B02 top bar | Same three links on every width (a second row on phones); "Take the survey" as a secondary button |
| B03 colours | Vivid only on the logo and Get early access; green for in and kept, azure for held money, ink with a minus for money out, strong rose only on an error message |
| B04 type | H1 78/46, H2 48/30, card H3 21, result 64/46, body 18/16 |
| B05 layout | H2, one line, one visual; 72px apart (48 on phones); 22px cards; no sideways scroll from 320 to 1280px |
| B06 blocks | Money tiles (azure KPI cards), lead result cards, breakdown lists with result bands, one quote, the signup band |
| B07 screens | Flat browser frames; every number in the copy is on the screen beside it or adds up from Mohab's Overview |
| B08 calculator | Starts at 2,000; result as a lead card with "An illustration, not a forecast." under it and Get early access beside it; the maths once, small |
| B09 dark | Meadow Night tokens; screenshots stay light, dimmed to 90% |
| B10, B11 | No placeholders; the FAQ describes only today's Windows beta |

## Next steps (owner's call)

1. Move How It Works and Current Status onto `css/version-d.css` (archive each first and give it a new ID). Rebuild Current Status around B01: what is built, what is next, the beta download, then Take the survey.
2. Retire A or B: as near copies they split testers without testing a real difference.
3. If A, B and C stay live, fix the 760px overflow and the phone navigation in `css/version-c.css`.
4. Decide the pricing answer and whether the FAQ should name Linux, so every version can say the same thing.

## Version D, audited for flow and readability (UX-2026.10.03.02)

The first D (UX-2026.10.03.01, archived) went from safe to spend straight into "You Don't Suck at Budgeting": product, then philosophy, with no warning. What changed:

- **A label above every section** says what kind of section is next: Personal finance, made for Egypt · One picture · What's really free · What we believe · Try it · Take the tour · Private by design · Good questions · Early access. "What we believe" is the turn from product to belief.
- **The calculator picks up the habit's number**: "Breakfast at home kept 3,000 EGP a month. Pick a regular expense you wouldn't miss and see what it adds up to."
- **No two "Questions" headings**: the tour is now "Every Screen Answers One Question"; the FAQ keeps "Questions, Answered".
- **Plain words**: Mohab is introduced ("Mohab, our sample household") instead of ending a line on a colon; "your register" became "Lightning".
- **Centred hero over a centred trio**: the left-aligned hero sat lopsided over the symmetric screens.
- Order kept: hook (one picture, what's really free), belief, try it (with the CTA beside the result), proof on real screens, trust, questions, signup.

Known, left as is: the six tiles add to 260,566 while "In your accounts" shows 260,565. The app shows the same: it sums in piastres and rounds each balance for display.

## Archive note

`archive/UX-2026.10.02.06.html` loaded `css/...` relative to `archive/` and opened unstyled; it now has `<base href="../">`. With the owner's go-ahead, every snapshot also carries the two-leaf logo and the current testing panel; their content and layout are unchanged.
