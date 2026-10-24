# Lightning website

The marketing site for **Lightning**, a personal wealth app made in Egypt.

> Study Your Patterns. Control Your Future.

Built in the **Meadow** identity: meadow green for growth, azure for clarity, and a deep Nile anchor for actions. Headings and big numbers use Bricolage Grotesque; text and figures use Manrope; on Arabic pages Readex Pro shows and Noto Sans Arabic reads. Open the [Lightning guideline](guideline/) (3.33, three documents in `guideline/`) for the complete system: [app.html](guideline/app.html) is Part A, the app, [website.html](guideline/website.html) is Part B, this site, and [phone.html](guideline/phone.html) is Part C, the app on a phone. `app-ar.html`, `website-ar.html` and `phone-ar.html` are the same three documents in Egyptian Arabic: same sections, layout and drawings, mirrored right to left. The English documents stay the authority, except the Arabic type (B04) and words (B10) in `website-ar.html`, which govern the Arabic pages; change both copies, here and in the app repository.

## Licence

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to read, run and change for
personal and other non-commercial use. Commercial use needs the owner's written permission: ask in a
[GitHub issue](https://github.com/elfekimuhammed/Lightning_website/issues). Contributions are welcome by pull request;
by sending one you grant the owner the right to use and relicense it as part of the site. Fonts keep their own licences.

## Structure

```
index.html          the home page, the only live landing page: phone and PC connected, and every number shows its working (guideline Part B)
version-b.html      redirect to index.html (Version B is archived)
version-c.html      redirect to index.html (the old Version C address; its design is now the home page)
how-it-works.html   the monthly 30-minute routine: upload, adjust, analyse
release-log.html    release log: what changed build by build (landing system; css/release-log.css)
current-status.html Downloads («التنزيل»): Download Lightning. Free., with the Windows and Android files straight in the hero, then the builds table, safe sample CSVs and app feedback
sample-profiles.html four fictional Egyptian 2026 sample ledgers and the financial question each explores
contribute.html     Contribute («ساهم معانا»; ar/contribute.html): the plain contribute path in the landing system, for people who are not developers too: Pick a task (good first issues), the three steps (/take, change it in a Codespace, open a pull request), where to ask, security reports in private, the full CONTRIBUTING.md, app feedback for non-coders and one small Discord line. Linked from the top bar, the footer (Explore) and Home's Help Build Lightning section; developers go on to For Geeks › contribute (forgeeks-guide.html), which says the same three steps. Keep it in step with the app repo's CONTRIBUTING.md
versions.html       release registry and visible IDs for every testable experience
version-registry.json machine-readable release IDs and archive locations
survey.html         optional personal finance survey (the landing system: the same top bar without the button, hero, card, tagline and footer; always light)
forgeeks.html       For Geeks home, the developer page (for-geeks.html redirects here): where we need you and the three steps right after the hero, then mission (with a hidden [secret] toggle), principles, the live terminal, the stack and what isn't done yet. Its own design, guideline Part D, Coders (guideline/coders.html), not Part B: fixed particle terrain that never rebuilds while you scroll, faint between the hero and the closing (strikes there are softer), current running through the pixel grid, twelve themes in a picker window. Indexed, in the sitemap and llms.txt, linked from every footer (More). for-geeks-2.html, for-geeks-3.html and for-geeks-4.html keep earlier concepts
forgeeks-guide.html Contribute, the one contribution page (top bar "contribute"): Pick it. Change it. Send it. The three steps first, each click in plain words, then six GitHub words, what happens after a pull request, common snags, ground rules and licence, who does what and the merge gates (people and AI), what Lightning is, how it is built (the four things to know; the layers and stack are Home's, linked) and where the glossary and AGENTS.md live; the footers' Architecture, Ground rules and Who does what link here (Glossary opens docs/GLOSSARY.md), and so do the "full guide" links on Contribute (English and Arabic). From the app repo's CONTRIBUTING.md and AGENTS.md: keep it in step with them. Old forgeeks.html#build links forward to #path
forgeeks-collaborate.html redirect to forgeeks-guide.html, mapping its old sections (#flow → #path, #who, #gates, #ai → #team, #rules → #rules); not in the sitemap
forgeeks-roadmap.html For Geeks roadmap: M1 core and open-source workflow (its items carry the plan codes, 2C, 7B…, and it says how a task code like [3C] reads), M2 Google Play, M3 App Store, each with done, now, next and later items, then one closing that sends you to a task or the three steps. Keep it in step with the app repo's NOW.md and issues/INDEX.md
tools/geeks_stats.py recounts the code figures For Geeks quotes (lines, tests, migrations, contracts) from the app checkout beside this one and writes them into forgeeks.html; --check fails when they drift (D10)
tools/geeks_shell.py the For Geeks top bar (home · contribute · roadmap, app on wider screens) and footer, written into the three pages from one source; it also sets the forgeeks.css and forgeeks.js versions. Edit it, run it, commit; tools/site_check.py fails when a page has drifted
css/forgeeks.css, js/forgeeks.js the For Geeks pages' shared styles and script: themes, top bar, the rail (down the left edge from 1300px, a strip of the page's sections under the top bar below that), reveal and the field with its lightning
features.html       Features: the five things it does best (each with a Mohab number), then all 102 features in twelve groups, the phone and PC second, with a jump to each (css/features.css)
guides.html         Guides: the map. Start here (the all-in-one answer), then four topic cards, each with its answer line, its guides as rows (title and one-line answer) and a link to its topic page (css/guides.css `.g-lib`)
budget-your-salary.html, see-where-your-money-goes.html, know-what-you-own.html, your-data-and-devices.html
                    the four topic pages (ar/ mirrors, same names): hero with the answer, the picture (Mohab's sum beside its screen, or three steps), one anchored card per guide under it, a short FAQ of questions only the whole topic answers (not the data page), the other topics. Each guide links up ("Part of ...") and across to its two nearest guides; breadcrumbs Home > Guides > Topic > page
*-egypt.html, net-worth-tracker.html, cash-flow-planner.html, bank-statement-budgeting.html, offline-personal-finance-app.html
                    the guides: one search question each, answered with Mohab's year (see Search below)
ar/                  Egyptian Arabic home page, Features, How It Works, Downloads («التنزيل»), Guides («مقالات»), Contribute («ساهم معانا»), seven guides, Release Log, Sample Profiles, Survey and App Feedback (the last two noindex; their scripts switch to Arabic on `lang="ar-EG"`; form values stay English so answers sort together): the English design system, written for Egypt; each language switch opens the matching page
blog.html           redirect to guides.html (the blog index is retired; the library is Guides). The four English articles (blog-*.html: salary-runs-out, budget-20000-egp, emergency-fund, irregular-income-budget; blog-track-expenses.html redirects to expense-tracker-egypt.html, canonical there, out of the sitemap); each has its own canonical URL, BlogPosting, BreadcrumbList and FAQPage data, and css/blog.css
ar/blog.html         redirect to ar/guides.html; the four articles in Egyptian Arabic (same file names under ar/); written for Egypt, not translated, with reciprocal hreflang and a language switch to the English page
css/arabic.css       loaded last on ar/ pages: the Arabic faces at the English sizes and weights (B04, A06.2), the right-to-left gradient and the few x-axis movements that dir="rtl" can't flip
assets/fonts/       Readex Pro (variable, to 700) and Noto Sans Arabic (variable, 400–700, Arabic subset only) and their OFL licenses, for the Arabic pages
robots.txt          crawl rules and the sitemap's address
sitemap.xml         every page that should be in search, and nothing else
css/styles.css      old shared styles, kept for archived snapshots only (no live page loads it)
css/version-b.css   Version B's own sections, archived snapshots only
js/version-b.js     Version B calculator, archived snapshots only
css/version-c.css   the old Version C system, still used by App Feedback (English and Arabic) and Versions
js/version-c.js     the old Version C script, archived snapshots only
css/landing.css     the landing pages: self-contained, guideline tokens and building blocks only
css/home.css        the home page's own sections, loaded after css/landing.css
css/guides.css      the guide pages' few extras, loaded after css/home.css
css/signup-band.css the signup band, the same on every page (guideline 3.20): Take the survey, or an email with **Get build news** («ابعتلي أخبار النسخ»; owner, 2026-10-15, the beta being public). It is the only gradient call-out card: any other closing prompt is a plain section (B06). Buttons: vivid only in the hero and for the band's survey, Nile primary elsewhere, 48px (top bar 40, inside tables 36)
js/signup.js        the old standalone signup form, archived snapshots only
js/landing.js       the landing pages: calculator, tabs, lightbox and signup
css/version-d.css   Version D's stylesheet, archived snapshots only
css/how-it-works.css, css/status.css (Downloads), css/sample-profiles.css, css/release-log.css
                    the four English pages that now sit on the landing system (header, hero, headings, cards, signup band and footer are the home page's): only their own components live here
js/analytics.js     analytics in two tiers and the consent bar (see Analytics and consent below)
css/consent.css     the consent bar and the two choice buttons
privacy.html        Privacy Notice: plain and neutral like terms of use (owner, 2026-10-13): numbered sections, one point per bullet, the article layout (css/blog.css), no hero, cards or signup band; ar/privacy.html in Arabic
css/footer.css       the site footer (Contact Us, then brand and links): self-contained tokens, light and dark, English and Arabic
tools/footer.py     writes the footer into every page from one source: contact details, links and words in one place (the testers' chat row links WhatsApp and Discord, owner 2026-10-15). Run `python tools/footer.py` after changing them (`--check` lists pages that are out of date). Its Explore column ends with Contribute, and the Arabic one links the Arabic Contribute page. The footer is shared site chrome, so a footer change needs no new release IDs
tools/release.py    archives pages and gives them new release IDs before you change them (see Version identity and archive)
tools/site_check.py checks links, JSON-LD, snapshots, the Version Archive against the registry, and title and description lengths; run it before every push
analytics/          goatcounter_daily.py (sends GoatCounter's totals to the private receiver) and dashboard.html (reads everything behind the key; noindex). No data files: nothing analytical is committed
audit/              website audits against the guideline
css/theme.css       light/dark switch
css/motion.css      small motion on the home page, Features, How It Works, Downloads and the guides (see Motion below)
js/motion.js        count-up figures, the rolling calculator answer, lists arriving item by item and scroll reveal
test.html           private test page, not indexed or linked: the same two-screen ledger handoff as Home follows the hero; its one-time animation has a Hand back control and a static reduced-motion state; the six-places wow still plays
css/wow.css, js/wow.js the wow moment on the home page and test.html (see Motion below)
js/vendor/          GSAP 3.15 and ScrollTrigger, hosted here; js/wow.js fetches them after the page loads
css/dev-dock.css    testing panel (page version + UX test)
js/dev-dock.js      builds the testing panel on every version
js/theme.js         picks and remembers the theme
assets/app/mohab/    app screenshots from the built-in sample household (python -m lightning --demo)
css/ux-test.css     shared UX test feedback rail
js/ux-test.js       shared UX test behavior
js/current-status.js multi-ticket app feedback form behavior
apps-script/        Apps Script receiver patches
assets/samples/     fictional Mohab CSV files for safe beta imports
assets/brand/       the two-leaf logo and icons (see Logo below); social-card.png is the 1200 × 630 link preview
guideline/            Lightning guideline 3.30 in four documents: app.html (A, the PC app), website.html (B, Normal: this site except For Geeks), phone.html (C, the phone) and coders.html (D, Coders: the For Geeks pages); same folder as the app's guideline/
```

It's a static site with no build step and no dependencies. Fonts load from Google Fonts; the Arabic pages add Readex Pro and Noto Sans Arabic, hosted here.

**Arabic pages are built for Egypt, not translated.** An `ar/` page uses the English page's design system (the same stylesheets, components and class names, with `lang="ar-EG" dir="rtl"`, `../` paths and `css/arabic.css` last; no Testing panel), but its words, examples, order and number of sections are written for an Egyptian reader, in Egyptian Arabic, with the same facts and screens. The voice, fixed words and Arabic type are in `guideline/website-ar.html` B04 and B10. The shared stylesheets write left and right as logical properties (`margin-inline-start`, `inset-inline-end`, `text-align:start`), so the same CSS lays out both directions: keep it that way. When an English page's facts change, change its `ar/` page too. Visible numbers use Arabic-Indic digits (٢١٥٬٦٥٧ جنيه); the scripts read and write them on `lang="ar-EG"` pages. Dates stay yyyy-mm-dd inside `<bdo dir="ltr">` (٢٠٢٦-١٠-٠٤), so the Arabic-Indic digits are not reversed. Keep URLs, IDs, attribute values and technical color codes unchanged.

## Main-site membership

Account and marketplace are available as main-site surfaces at `account.html` and `marketplace.html`, using the same identity and wallet as For Geeks. Public navigation links both. The home invitation is dismissible and never required to download or use the app. Backend top-up and signed-restore setup, current limits and remaining launch requirements: [Supabase README](supabase/README.md).

## Proposed community features

[For Geeks accounts, Lightning Coins and cosmetics](docs/proposals/forgeeks-accounts-lightning-coins.md) records the proposed member access, per-issue rewards, leaderboard and cosmetics marketplace, with implementation milestones and open decisions. Status: built. Member pages: `forgeeks-account.html`, `forgeeks-tasks.html`, `forgeeks-market.html`, `forgeeks-leaderboard.html` (indexed), `forgeeks-profile.html`, `forgeeks-admin.html` (owner); shared sign-in `js/forgeeks-auth.js`; database and setup in `supabase/`.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```
python -m http.server 8000
```

## Publish with GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.

## Collect survey responses

GitHub Pages is static. The survey and both landing pages send responses to the configured Google Apps Script endpoint, which writes to Google Sheets. The survey posts `form_type=survey`; the email signup posts `form_type=signup`. The calculator runs in the browser.

The calculator on B shows the capital that would pay what you keep each month: monthly amount × 12 ÷ the yearly return (2,000 EGP a month = 120,000 EGP at 20%). It is one split card: inputs on the left, the answer on the vivid gradient on the right, with one chip, Kept each year. No explanation notes or field hints: if something needs a description, rewrite it.

## UX test responses

Every landing page includes the same scroll-aware UX feedback rail. It sends an internal release identifier rather than the visible landing-page name:

- `UX-2026.09.28.01` — `index.html` (before the hybrid)
- `UX-2026.10.01.06` — `index.html` (hybrid)
- `UX-2026.09.28.02` — `version-b.html` (before the rebuild)
- `UX-2026.09.30.05` — `version-b.html` (rebuilt)
- `UX-2026.09.30.03` — `version-c.html`
- `UX-2026.10.03.01` — `version-d.html` (guideline 3.6)
- `UX-2026.10.03.02` — `version-d.html` (guideline 3.7)
- `UX-2026.10.03.03` — `version-d.html` (guideline 3.8)
- `UX-2026.10.04.01` — `index.html` (A · Product)
- `UX-2026.10.04.02` — `version-b.html` (B · Philosophy)
- `UX-2026.10.04.03` — `index.html` (A · Product, three advantages)
- `UX-2026.10.04.04` — `version-b.html` (B · Philosophy, new screens)
- `UX-2026.10.04.05` — `release-log.html` (guideline 3.10 gradient)
- `UX-2026.10.04.06` — `version-b.html` (B · capital-equivalent calculator)
- `UX-2026.10.04.07` — `index.html` (A · no explanation captions)
- `UX-2026.10.04.08` — `index.html` (A · what Lightning does, no comparisons)
- `UX-2026.10.04.09` — `version-b.html` (B · split game card)
- `UX-2026.10.04.10` — `index.html` (A · sign-off ending)
- `UX-2026.10.04.11` — `version-b.html` (B · sign-off ending)
- `UX-2026.10.04.12` — `index.html` (A · phones first)
- `UX-2026.10.04.13` — `version-b.html` (B · phones first)
- `UX-2026.10.04.14` — `index.html` (A · Mohab's year)
- `UX-2026.10.04.15` — `version-b.html` (B · Mohab's year)
- `UX-2026.10.04.17` — `index.html` (A · screens open themselves)
- `UX-2026.10.04.19` — `index.html` (A · the calculator is back)
- `UX-2026.10.04.20` — `version-b.html` (B · breakfast, counted honestly)
- `UX-2026.10.04.21` — `index.html` (A · like having it in the bank)
- `UX-2026.10.04.22` — `version-b.html` (B · like having it in the bank)
- `UX-2026.10.04.18` — `version-c.html` (C · trust: added up right)
- `UX-2026.10.04.23` — `version-c.html` (C · readable on phones)
- `UX-2026.10.04.24` — `version-c.html` (C · one voice)
- `UX-2026.10.04.25` — `index.html` (A · beta, and ready to use)
- `UX-2026.10.04.26` — `version-b.html` (B · beta, and ready to use)
- `UX-2026.10.04.27` — `version-c.html` (C · beta, and ready to use)
- `UX-2026.10.04.28` — `current-status.html` (Downloads · beta, and ready to use)
- `UX-2026.10.04.29` — `release-log.html` (Release Log · beta, and ready to use)
- `UX-2026.10.04.30` — `release-log.html` (Release Log · one card per build)
- `UX-2026.10.04.31` — `index.html` (A · beta testers wanted)
- `UX-2026.10.04.32` — `version-b.html` (B · beta testers wanted)
- `UX-2026.10.04.33` — `version-c.html` (C · beta testers wanted)
- `UX-2026.10.04.34` — `how-it-works.html` (How It Works · beta testers wanted)
- `UX-2026.10.04.35` — `current-status.html` (Downloads · beta testers wanted)
- `UX-2026.10.04.36` — `release-log.html` (Release Log · beta testers wanted)
- `UX-2026.10.04.37` — `index.html` (A · beta testers, in the signup)
- `UX-2026.10.04.38` — `version-b.html` (B · beta testers, in the signup)
- `UX-2026.10.04.39` — `version-c.html` (C · beta testers, in the signup)
- `UX-2026.10.04.40` — `how-it-works.html` (How It Works · beta testers, in the signup)
- `UX-2026.10.04.41` — `current-status.html` (Downloads · no strip)
- `UX-2026.10.04.42` — `release-log.html` (Release Log · beta testers, in the signup)
- `UX-2026.10.04.43` — `index.html` (A · one signup everywhere)
- `UX-2026.10.04.44` — `version-b.html` (B · one signup everywhere)
- `UX-2026.10.04.45` — `version-c.html` (C · one signup everywhere)
- `UX-2026.10.04.46` — `how-it-works.html` (How It Works · one signup everywhere)
- `UX-2026.10.04.47` — `current-status.html` (Downloads · one signup everywhere)
- `UX-2026.10.04.48` — `release-log.html` (Release Log · one signup everywhere)
- `UX-2026.10.04.49` — `version-c.html` (C · one clear picture)
- `UX-2026.10.04.50` — `current-status.html` (Downloads · what my own numbers taught me)
- `UX-2026.10.04.51` — `version-c.html` (C · six places, with a header)
- `UX-2026.09.30.04` — `how-it-works.html` (six steps)
- `UX-2026.10.01.07` — `how-it-works.html` (monthly routine)
- `UX-2026.10.04.16` — `how-it-works.html` (Mohab's year)
- `UX-2026.10.03.04` — `current-status.html` (downloads table links to the release log)
- `UX-2026.10.03.06` — `current-status.html` (separate permanent 0.5 and 0.4 downloads)
- `UX-2026.10.03.07` — `release-log.html` (0.5.0 development milestone; no public download)
- `UX-2026.10.03.08` — `app-feedback.html` (0.5 and 0.4 build selection)
- `UX-2026.10.05.01` — `index.html` (the home page, the only live landing page)

The rail discovers each top-level section automatically, so a future landing page only needs the shared CSS and JS includes plus `data-ux-version` and `data-ux-endpoint` on its `<body>`. Responses are posted in one batch and stored as one row per rated section in the `UX Tests` Sheet tab.

UX responses go to the survey sheet until the Apps Script receiver routes them. To fix it, follow the steps at the top of [apps-script/UXTestsReceiverPatch.gs](apps-script/UXTestsReceiverPatch.gs):

1. Paste the file into the receiver's Apps Script project.
2. Make `if (e && e.parameter && e.parameter.form_type === 'ux_test') return saveUxTest_(e.parameter);` the first line of `doPost(e)`.
3. Deploy → Manage deployments → edit the existing deployment → New version → Deploy. Saving alone does not change the live web app.
4. Run `testUxRoute` once from the editor and check that a row appears in the **UX Tests** tab (created automatically if missing).

## Downloads and app feedback

[Downloads](current-status.html) is the shared downloads hub for both landing pages. It keeps beta orientation, harmless Mohab sample CSVs, release notes/download links and app feedback in one predictable place. The header and the **Testing** panel both link to it. Home on this shared page returns to the landing version a visitor most recently viewed.

The app feedback form accepts multiple tickets at once, with up to five screenshots per ticket and ten per submission. Testers can choose PNG, JPEG or WebP images, or paste them into a ticket description. PNG screenshots are re-encoded losslessly at their original dimensions; the smaller encoding is kept only when it actually saves space. JPEG and WebP files are sent unchanged. The browser prepares each image as soon as it is attached, then sends the images with the tickets in one `form_type=app_feedback` request. Submitting gives the form back at once: the request runs in the background (the page asks before closing while it does), and if it fails the tickets and images return to the form.

The receiver expands the request into **one row per ticket** in the **App Feedback** tab and stores each screenshot in a private Drive folder owned by the Apps Script deployment account. It adds Drive links to the ticket row and does not change file sharing. A source image can be up to 10 MiB; after processing, each attachment must be 5 MiB or smaller and all attachments in one submission must total 12 MiB or less. To activate screenshot storage, replace or add the contents of [apps-script/AppFeedbackReceiverPatch.gs](apps-script/AppFeedbackReceiverPatch.gs) in the existing receiver, route `form_type=app_feedback` to `saveAppFeedback_`, run `setupAppFeedbackDrive()` once from the Apps Script editor as the deployment owner to authorize Drive and create the folder, then deploy a new version. Keep the existing `/exec` URL. The pre-created **App Feedback** tab is in [Lightning-survey-responses](https://docs.google.com/spreadsheets/d/1rmV9GtffAJByilsxre0bQBMm-cza1uCXBwDbjuD_ffc/edit).

The included `assets/samples/mohab-2026-full-year.zip` is Mohab’s full fictional 2026 sample pack: eight CSVs for accounts, CIB payroll, Vodafone Cash, cash wallet, gold, certificate, THNDR and prices. It lets a tester explore the complete import and analysis flow without entering their own data.

## Analytics and consent

**Security deployment (2026-10-18).** `apps-script/WebsiteReceiver.gs` supplies the complete router and validated survey/signup handlers. Use `python tools/deploy_receiver.py` to build one complete Apps Script file, or add `--apply --script-id EXISTING_PROJECT_ID --deployment-id EXISTING_DEPLOYMENT_ID` to back up and replace the existing project's source and update the same deployment. The original response tabs are preserved; new survey/signup rows use separate v2 tabs. The source bundle replaces old entry points; never install both the bundle and duplicate legacy patch files. The deployment script requires your authenticated clasp CLI and Google Apps Script API access. For a standalone project set the private Script Property `WEBSITE_FORMS_SPREADSHEET_ID`; bound scripts use their existing spreadsheet. Deploy the receiver before publishing the updated website.

All four forms use literal-cell escaping, strict field validation, duplicate suppression, per-session and shared server-side quotas. The browser waits for a readable JSON confirmation instead of treating an opaque no-cors response as success. Anonymous session metadata and timing are forgeable; these controls bound spam and storage use but cannot eliminate determined bots. App/UX feedback retain their row/image caps. The receiver's analytics read key is accepted only in POST bodies and kept only in the dashboard's page memory, never logged or persisted by the page. After deployment run `rotateAnalyticsReadKey` in the Apps Script editor, then privately update the GitHub **website-analytics** environment secret. The complete owner setup and rollout are documented in the app repository's [CONTRIBUTING.md](https://github.com/LightningEg/Lightning/blob/main/CONTRIBUTING.md) › For the owner and the AIs; its `tools/security_setup.py` configures settings and migrates known secrets without printing their values.

Run `node apps-script/tests/feedback-security.test.js` and `node apps-script/tests/website-receiver.test.js` for backend security regressions. `node apps-script/tests/forms-browser.test.js` checks actual form submissions against a mocked receiver (requires Playwright). The GitHub `website-security` job runs backend regressions, analytics rules/receiver tests and site validation on every PR. Live Google deployment/CORS and final spreadsheet writes still require a dummy-data acceptance check after deployment.


`js/analytics.js` is loaded on every page (not the brand guideline). It counts in two tiers; [privacy.html](privacy.html) and [ar/privacy.html](ar/privacy.html) tell visitors exactly what each one counts, so change them together with the script.

**The consent bar.** The bar is short and general (owner, 2026-10-13: essential cookies make the site work; analytics cookies, the only optional one, show what's popular; you decide once); the Privacy Notice it links to carries every specific, which is what makes the consent informed. Keep it that way. On a first visit `js/analytics.js` adds a slim bar along the bottom edge (at most 56px on a computer, so it never covers the first screen's buttons; `css/consent.css`, loaded only then) with two identical buttons, *Keep essential only* and *Allow all*. Neither is pushed: same style, same size, nothing pre-selected, and essential is what counts until a choice is made. The choice is saved as `localStorage['lightning-consent'] = {choice, policy, date}`. Raise `POLICY` in the script when what Allow all adds changes (essential-tier fields, such as the page of this site you came from, do not raise it; it is 2 since the page-view record, which also made the notice Version 2: `privacy.html`, `ar/privacy.html`), and everyone is asked again. A browser that sends Global Privacy Control gets essential only and no bar. Every footer links *Privacy* (Arabic «الخصوصية»), and the script adds it only to a page that still has an older footer; the privacy pages carry the same two buttons, so the bar stays off there. Like the testing panel, the bar is site chrome: adding it needs no new release IDs.

**Essential, for everyone, two streams. Nothing is stored on the device.**

1. *GoatCounter*: page views and counted events (below). An ad blocker can stop it: that is why stream 2 exists.
2. *The page-view record* (`js/analytics.js` → the receiver, version 2 payload): one anonymous row per page view in the private sheet's **Page views** tab, sent when the page is left. It holds the page and release, language, device class, OS and browser family, referring site and `utm_*`, scroll %, active seconds, load and LCP seconds, and a **timeline** of `code:second` pairs: `reach-<section>`, `seen-<target>` (a button or link that was ≥60% on screen: a Downloads link folded into the closed phone menu is not "seen" until the menu opens), `click-/nav-/foot-/link-<target>`, `menu-open`, `faq-N`, `screen-…`, `calc-used`, `<form>-start/-submit`, `invalid-<field name>`, `dead-<tag>-<section>` (a tap on something that is not interactive), `rage-click`, `js-error-<hash>` / `js-reject-<hash>` / `res-error-<tag>-<file>` (a file that failed to load, including the blocked GoatCounter script: `res-error-script-count-js`). Its random page-view ID lives in memory only and links nothing. The receiver enforces the tier: whatever a client sends, ids are stored only when `consent` is `all`. `consent` is `all`, `essential`, `undecided` or `gpc`. Re-sending the same page view (tab hidden, then shown) updates its row. Limits: 3,000 new page views a day and 100,000 rows; rows are deleted after 90 days.

GoatCounter events:

- `download-app-<version>-<platform>` for an app build, read from any link to the Lightning-downloads repository that ends in `.zip`, `.exe`, `.msi`, `.dmg` or `.AppImage`, or `.apk` (for example `download-app-v1.0.0-beta.1-android`). A new build is counted as soon as its link is on a page; nothing to tag.
- `download-sample-<file>` for the sample pack.
- Every other event is `<event>@<release>`, where the release is the page's `data-ux-version` (the page path on pages without one, such as `ar/index`), so releases can be compared: `reach-<section id>` (a `main section[id]` came into view), `calc-used`, `faq-<n>`, `screen-<image>` (a screenshot enlarged), `click-<target>` (a `.btn`, `.sb-btn` or `.nav-cta` link), `lang-switch`, `download` / `sample`, `<form_type>-start` and `<form_type>-submit` (that a form was started or sent, never what was typed). Nothing to tag: a new section with an `id` is counted as it ships.
- `consent-all` / `consent-essential`: how many people choose each.

**Allow all, only if chosen.** The page-view record plus per-event rows in the **Events** tab, and a random visit number (`sessionStorage`, gone with the tab) and a visitor number (`localStorage`, 90 days), so the pages of one visit can be linked. Each page sends its events once, as it is hidden or left (`sendBeacon`), to the Apps Script receiver as `form_type=event`. The receiver numbers each visitor ID in order (the Events tab's *Visitor no.* column: 1, 2, 3, kept in a Visitors tab, never reused, dropped after 90 days of silence) so one person's rows are easy to follow; *Visit #* says which visit it is, so 2 or more is a return. A number is a browser, not a person: another device or cleared storage is a new visitor. Never sent: field values, amounts, names, emails. Localhost and `file:` previews send nothing, and neither do automated browsers (`navigator.webdriver`) or a browser marked as the owner's: unlocking the dashboard marks that browser (its health strip says so and can undo it), and opening any page with `?notrack` marks another one, such as your phone (`?track` undoes it). Your own visits would otherwise be a large share of 2–25 a day.

**Where it lands.**

```
js/analytics.js ─ essential ─┬─► GoatCounter ─► GitHub job (every 8 hours; also GitHub's download counts) ─┐
                              └─► Apps Script (apps-script/AnalyticsEventsReceiverPatch.gs) ◄───────────────┘
                allow all ─────────► same, plus visit and visitor ids and per-event rows
                private spreadsheet: Page views (all) · Events + Visitors (Allow all) · Daily + Event counts + GitHub downloads
                                   └─► analytics/dashboard.html (you, with the key; nothing committed)
```

**Nothing analytical is committed: this repository is public, so anything in it is readable by anyone.** The dashboard's findability, hesitation, visitor, error and speed sections come live from the Page views tab (`what=insights`); its totals and real-download comparison come from the GitHub job's tabs (`what=counts`). The `Refresh analytics` workflow runs the GoatCounter script every eight hours and sends the totals (visits and downloads per day, event counts per day and release) to the Apps Script receiver, which keeps them in the *Daily* and *Event counts* tabs and replaces the rows of the days it was sent. The script needs two repository secrets: `GOATCOUNTER_API_KEY` and `ANALYTICS_READ_KEY` (the receiver's key, shown in the analytics spreadsheet's *Dashboard key* tab; you can set it to a password of your own under Project Settings › Script Properties). Without the second, the job warns and saves nothing. To fill in history, run the workflow by hand with `days` set to 90 (at most 120). Open `analytics/dashboard.html` on the live site: nothing shows until you enter the key, which stays only in the open page until it is locked or reloaded, and every number then loads from the script. The script merges groups under 5 visits into *Smaller groups*, blanks medians of fewer than 5, and stops storing events past 5,000 rows or 300 new visitors a day (counted, and shown on the dashboard). Updating the receiver is two steps: paste the file, deploy a new version of the same deployment. The first request to a new `ANALYTICS_SCRIPT_VERSION` runs `setupAnalyticsEvents()` by itself (tabs, formats, purge trigger, key), and the spreadsheet ID, once set, is remembered in Script Properties, so a paste with it empty keeps the same spreadsheet. Reads that fail answer in JSON with the reason, which the dashboard shows. The Page views tab started on 2026-10-14; the setup rebuilds earlier Allow-all page views from the Events tab once (no scroll, time on page, speed, OS or browser for those, so they are left out of those figures). Deploying never touches the rows; only the daily 90-day purge deletes. The setup also sets the spreadsheet's time zone to Cairo, so *Received at* shows Cairo time (the stored moment never changes, only how it is shown). Keep the Events and Visitors tabs in their own spreadsheet (`ANALYTICS_SPREADSHEET_ID`), never next to survey or signup rows. `daily.csv`, `events.csv` and `journeys.csv` were public for a few days and are still in git history (owner decided on 2026-10-14 to leave it: a rewrite would break every clone and branch). Never commit analytics data again. Past about a few thousand visits a day Apps Script slows and drops events: move the receiver to a Cloudflare Worker with a database (a plan the owner has not started). With 2–25 visits a day, don't compare page versions yet: wait for a few hundred visits per page.

**The decision dashboard** (`analytics/dashboard.html`, rebuilt 2026-10-14) opens with a data-health strip, then *What To Act On*: up to five verdict cards from the 11 rules in `analytics/rules.js` (pure functions, shared with the tests), each with a Wilson 90% range and a label (Clear: 100 or more page views and a range within 10 points; Early sign: 30 or more; Too early). Below: key numbers against the period before (with spreadsheet formulas that give each one, under *Check these numbers in the spreadsheet*), the path to a download per device, trends with release markers, channels, a fix list, where readers stop, and whether the last release helped; everything else is in one collapsed *Details*. The periods are 7, 14 and 28 days, each compared with the one before (two receiver calls, `days` and 2 × `days`). **The receiver script's version** is `ANALYTICS_SCRIPT_VERSION` in `AnalyticsEventsReceiverPatch.gs` and `EXPECTED_SCRIPT_VERSION` in the dashboard: bump both together, or the health strip turns rose and says to paste the script. The page view's `from` field (last column of the Page views tab) is the page of this site that led here, `outside` for another site, empty for none; never a URL or query string. The dashboard never suggests a download button (owner, 2026-10-14).

**One meaning per number (2026-10-15).** *Download presses* are page views where an app file was pressed; *headed for a download* adds presses of a link to Downloads; the receiver sends counts, never rounded percentages. The path has two tables, each share over its own page views: the pages that lead to Downloads (link on screen, link pressed) and the Downloads page (download pressed), so none can pass 100%. Channels count **arrivals** only (a page view whose `from` is empty or `outside`), with the source folded to one name (`www.google.com`, `google.com.eg` and the Google app are all *google*; `utm_source` wins); a page opened from another page of the site is not "direct". The receiver reports `live_from`, the first day the site filled the Page views tab itself; days before it hold only the rebuilt Allow-all page views, so tiles never compare a period that reaches before it, and the bar charts draw those days grey. A period's real downloads are the last GitHub total in it minus the last one before it.

**Tests.** `node apps-script/tests/receiver.test.js` runs the receiver against a mock of Google Sheets (exit 1 on any failure). `node analytics/tests/rules.test.js` checks every rule and the statistics. `node analytics/tests/gen-data.js /tmp/d.json` feeds 45 days of sample page views through the real receiver code; `node analytics/tests/dashboard-smoke.js /tmp/d.json /tmp` renders the dashboard with that data (phone and desktop, light and dark; an outdated script; no data) and checks it; `node analytics/tests/client-from.js` checks the `from` field in a browser (the smoke and client tests need Playwright). Run all after any analytics change.

**One main source.** The dashboard's tiles, funnel, findability, hesitation, visitors, errors, usage and download-press counts all come from the Page views tab, so they agree with each other. GoatCounter is only a cross-check (the dashboard footer shows its page-view count for the same period) and the stand-in until page views exist.

**A dependency to remember.** The findability numbers watch one page, the Downloads page, `current-status.html` (called Downloads in the menu). Its name is the constant `ANALYTICS_DOWNLOADS_PAGE` in `apps-script/AnalyticsEventsReceiverPatch.gs`. If that page is ever renamed, change that one constant, paste the script into the receiver again and deploy; then change the `current-status` entries in `PAGES` in `analytics/dashboard.html` and in the links of `tools/footer.py`. The codes the script matches are `seen-`, `nav-`, `foot-`, `click-` and `link-` followed by that name, plus any `download-app-…`.

"Unique visitors" in GoatCounter counts browsing sessions, not people: one person who visits in the morning and again after GoatCounter's session window has passed counts twice, so five people can show as up to ten. Read it as visits from distinct sessions or devices.

Read them on the GoatCounter dashboard; events are listed with the pages, filter by `download` or by a release ID. Add `<script src="js/analytics.js?v=20261013-1" defer></script>` before `</head>` on any new page.

## Search (SEO)

Lightning aims to be found first for **free personal finance for Egypt**, then for the wider terms. The home page owns that phrase; each guide owns one question.

- **Every indexable page** has a title and description written for search, an absolute `<link rel="canonical" href="https://lightningeg.com/...">` (the home page is `https://lightningeg.com/`), Open Graph tags with `assets/brand/social-card.png`, and a line in `sitemap.xml`. Add all four to any new public page.
- **Arabic pages** live under `/ar/`, use Egyptian Arabic (`lang="ar-EG"`, `dir="rtl"`), and have their own Arabic title, description, canonical, Open Graph metadata, structured data and sitemap entry. Add reciprocal `hreflang="ar-EG"` and `hreflang="en"` links on both language versions; each language switch opens the same page in the other language. Write for Egyptian search terms such as إدارة المصاريف في مصر and ميزانية شهرية, in natural Egyptian Arabic.
- **Not in search:** survey, app feedback, the two privacy pages, the test page, the version archive, the brand guideline and every `archive/` snapshot carry `<meta name="robots" content="noindex,follow">` and stay out of the sitemap. Add the same line to each new snapshot (the one head change allowed on a snapshot besides brand-wide ones). `version-b.html` and `version-c.html` redirect to the home page and canonicalise to it; `blog.html` and `ar/blog.html` redirect to the Guides pages the same way, and stay out of the sitemap. `robots.txt` blocks only files that are not pages (`audit/`, `analytics/`, `apps-script/`, the READMEs), because a blocked page can't show its noindex.
- **Structured data:** the home page has `Organization`, `WebSite`, `SoftwareApplication` (free, Windows, FinanceApplication) and `FAQPage` (its six visible questions); each guide has `WebPage` and `FAQPage` matching its visible questions; How It Works has `WebPage` and `HowTo` (its three steps); Features, Downloads and the Release Log have `WebPage`; Guides has `CollectionPage`, `BreadcrumbList` and an `ItemList` of every page it links. Each blog article (English and Arabic) has `BlogPosting`, `BreadcrumbList` and `FAQPage` matching its visible questions; their breadcrumb reads Home > Guides > article. Change the structured data whenever the visible text it repeats changes. Only true claims: no ratings, reviews or download counts until real ones exist. Update `softwareVersion` with each app release.
- **The guides** (`guides.html` groups them into four topics, each with its own page; every question has one home, and a guide's FAQ never repeats another's): the all-in-one answer `net-worth-budget-expense-tracker.html` (net worth, budget and expenses from one ledger; 2026-10-20, for AI and web searches such as "net worth, budget and expense tracker"), net worth, budget, expenses, investments, dollar savings and US shares (`dollar-savings-tracker-egypt.html`, 2026-10-15, beside `account-usd.webp` and `a-holdings-usd.webp`), safe to spend, bank statements, privacy. Each is built from the landing building blocks only (hero, a worked example beside its real screen, three cards or steps, good questions, keep reading, the signup band). Every figure comes from Mohab's year on 2026-10-04 and matches the screen beside it, as on the home page; recapture them together. They never mention other apps (B10, B12), so comparison pages are not built.
- **Head-only changes** (title, description, canonical, social tags, structured data) don't change what a visitor sees, so they don't need a new release ID. Visible copy does.
- **AI assistants:** `llms.txt` is a plain summary of what Lightning is, its key facts and every public page, for AI assistants and AI search. Update it when a fact on the site changes (price, platform, version, a new guide). `robots.txt` names the AI crawlers (Claude, ChatGPT, Perplexity, Gemini, Apple and others) to make the welcome explicit; they follow the same rules as everyone. Many AI crawlers do not run JavaScript, so every fact must be in the HTML as written; `js/motion.js` and `js/wow.js` stand down for crawlers, so a crawler that does run scripts also reads every figure as written.
- **IndexNow:** `.github/workflows/indexnow.yml` sends every sitemap address to IndexNow (Bing, which feeds ChatGPT and Copilot search, plus Yandex, Seznam and Naver) after each publish. The key file at the root (`7778af1015309ba6ad3ba3f379bb6811.txt`) must stay. Google reads `sitemap.xml` instead.
- **After publishing:** the owner verifies `lightningeg.com` as a Domain property in Google Search Console (DNS) and in Bing Webmaster Tools, submits `https://lightningeg.com/sitemap.xml` and requests indexing for the home page, How It Works, Downloads and the guides. Then write the next guides from the queries Search Console reports.

## Version identity and archive

Current app release: **v1.4.4** (2026-10-23), matched Windows x64 ZIP and signed, debuggable Android arm64 APK from `f4a52abb`. Buttons download the release files directly; Android needs no ZIP extraction. Checksums and build record accompany the files. English and Arabic downloads and release notes are current; earlier releases remain in the archive.

Every testable web experience has one visible immutable release ID, in the form `UX-YYYY.MM.DD.NN`. Current IDs appear in the Testing panel and on [Version Archive](versions.html); feedback records that same ID. Before a live page changes, copy it and its page-specific CSS/JS to `archive/RELEASE-ID.html` and matching resource snapshots, add the permanent link to `version-registry.json` and `versions.html`, then allocate a new ID to the changed page. Never reuse an ID or overwrite an archived snapshot. `python tools/release.py spec.json` does all of it (its docstring shows the spec); `python tools/site_check.py` confirms the registry and the Version Archive agree. 56 snapshots from 2026-10-09 to 2026-10-13 were saved without `<base href="../">` and show unstyled; repairing them is the owner's call (2026-10-15).

Arabic localized counterparts do not use English UX test release IDs.

Windows and Android app versions are separate from website experience IDs. The Downloads page and [Version Archive](versions.html) link to each app build independently. Keep at least the three newest app versions permanently, add a new row for every release, and never replace an older version's file or link. Published ZIPs, APKs and checksums live in the public [Lightning-downloads repository](https://github.com/elfekimuhammed/Lightning-downloads).

## Status

The website, survey, and Google Sheets receiver are connected. When changing the receiver, update its URL in both landing pages and the survey page, then verify that a submission appears in the destination Sheet.

## Motion

The home page, Features, How It Works, Downloads, Guides and every guide load `css/motion.css` and `js/motion.js` (about 6 KB together, no library). Money figures count up from zero to their exact value as they scroll into view, the calculator answer rolls to each new figure, the items of a list (tiles, breakdown lines, steps, cards side by side, feature bullets) arrive one after another, sections rise in once, real screens lift under the pointer, and pages fade into each other where the browser supports it. Only the home page has a big animation, the wow moment below; secondary pages keep to this small motion (owner's choice, 2026-10-06).

- Only position (`translate`, `transform`) and `opacity` move; nothing on screen at load is hidden or animated, so the first paint is untouched.
- Small motion (counts, the calculator roll, tiles, lines and steps arriving in order) always plays, also with *reduce motion* on (owner's choice, 2026-10-06). Big motion (sections rising, screens lifting, page fades) switches off then.
- Without the script, every figure shows as written.
- Every count ends on the page's own text, so a figure always matches its screen (B07).
- To add it to another page, link both files after the page's own CSS; page fades need both pages to load `css/motion.css`.
- **The wow moment** (`css/wow.css`, `js/wow.js`): in section 1 the six money tiles pour into one sticky *In Your Accounts* figure as you scroll, which adds them up to the first line of the breakdown. Each tile takes 420px of scroll, tiles side by side go 160px apart, and the figure trails the scroll by about a second, so the eye can follow. GSAP + ScrollTrigger (about 46 KB compressed, `js/vendor/`) are fetched only after the page has loaded. `<body data-wow-always>` plays it even with *reduce motion* on: the home page has it (owner's choice, 2026-10-06), and so does `test.html` (`noindex`, not in the sitemap or any menu).

- **The phone-to-PC handoff** (`css/sync-demo.css`, `js/sync-demo.js`; Home and `test.html`): plays once on entry, then the Hand back / Borrow control reverses it. Without JavaScript or with reduced motion, the lent state is shown; the reduced-motion controls switch states immediately.

- **The runway** (`css/runway.css`, `js/runway.js`; Home section "Watch Your Cash Before It Moves", the Arabic Home after "تقدر تصرف كام"; `test.html` keeps a copy): a scene that plays by itself in about 2 seconds when it scrolls into view (and again after you scroll back above it), where a dot rides the cash line across the next three months, events light up as it passes, the figure rolls down to the lowest point and "Safe to spend until payday" appears. The path is illustrative between two real month ends and says so. Without the script the finished picture shows. It plays with reduced motion on too (small motion, owner’s rule). One native animation clock keeps the dot, drawn line, amount and highlights together; the chart can play even when taller than the viewport. It draws the line with `stroke-dashoffset`, which is the one exception to the transform-and-opacity rule above.

**Phone spacing (2026-10-12):** on phones sections are 40 apart, a header sits 20 above its content, cards are 12 apart with 18 padding, and the three phone screens on Home are a swipe strip (`.t-phones`) instead of a stack.

## Dark mode

Both landing pages, How It Works and the brand guidelines support light and dark ("Meadow Night"). The full spec is in section B09 Dark mode of `guideline/website.html`.

- The page is light by default, whatever the device or browser setting; it turns dark only when the visitor uses the switch, and the choice is then remembered in `localStorage` (`lightning-theme`).
- To add dark mode to another page: include `css/theme.css` and `js/theme.js` (in `<head>`, not deferred), add `<button data-theme-toggle></button>` to the top bar, and define the page's dark colors under `:root[data-theme="dark"]`.
- The survey is still light only.

## Header and testing panel

- Every version uses the same header: the logo, six links, **Home · Features · How It Works · Guides · Downloads · Contribute** («ساهم معانا» in Arabic; the owner approved the sixth link on 2026-10-19, replacing the five-link rule of 2026-10-15), and a dark **Download free** button to Downloads (just "Download" on phones, «نزّل ببلاش» in Arabic; owner's request 2026-10-15, after visitors could not find the downloads). The Downloads page keeps **Take the survey** there, so no page links to itself; the survey is also in the signup band on every page. Below 980px the page links fold into one **Menu** button (`js/nav-menu.js`, styles in `css/landing.css`), which also holds the language switch on phones. The header only links to pages, never to a section of the same page. The Downloads page keeps its address `current-status.html`; only its name changed.
- The release ID (linking to the version archive), **Submit UX Test**, and **Submit app feedback** live in the **Testing** tab on the right edge of the screen. On `lightningeg.com` the tab shows only to testers: send them any page with `?testing` (remembered in the browser; `?testing=off` hides it again). Previews and local copies always show it (2026-10-21: a "Testing" tab beside Download free read as unfinished). `js/dev-dock.js` builds it the same way on every page; load it with `defer` before `js/ux-test.js`.
- There is one live landing page, so **Home** always goes to `index.html`. Archived versions are on [Version Archive](versions.html).

## Landing pages

**Since 2026-10-21 (`UX-2026.10.21.27` onward) every live page shows the app of that day:** `assets/app/mohab-year-2026-10-21/` (English) and `ar-2026-10-21/` (Arabic), recaptured with `tools/site_shots.py` from the sample on 2026-10-04 (Get set up dismissed, the mouse parked, the phone's + button between rows; app item 3AA), plus two Overview crops the tool does not yet make, `a-kpis` (savings and investing rates) and `a-sankey` (where money in went). The sample now has nine accounts that hold money and a gam'eya that is owed: in the nine places 995,703 (CIB Payroll 157,582, Cash wallet 10,564, Vodafone Cash 2,455, Dollar savings 51,600, NBE certificate 100,000, THNDR 48,996, Gold at home 110,295, Dollar brokerage 114,211, Family flat share 400,000), less 6,900 held for family = 988,804 owned (cash you own 236,317, holdings value 752,486), less 78,500 owed (loans 52,500, gam'eya 14,000, late rent 12,000) = **net worth 910,304**, up 311,804 this year. Safe to spend 112,288 (free cash 151,701 less 6,460 due before payday, 2,000 gam'eya, 16,558 budget, 5,500 goals, 8,895 emergency fund top-up). Free cash 117,111 at 2026-09, lowest 101,534 in 2026-11, 148,520 in 2026-12 (−39,413 for the rest of 2026-10, −10,754, +46,985). Savings rate 45.4% (262,111 kept of 577,860 money in), investing rate 76.9% (201,450 of what he kept; 60,661 kept as cash). Money out 2026-09 35,268 (Housing & Rent 12,000 = 34%, Other 8,024, Loan payments 7,500, Food & Groceries 5,044, Health 2,700). Portfolio 752,486, net gain +44,559. Dollars: 1,235 (235 brokerage, 1,000 savings) worth 63,726 at 51.60, cost 61,703 (49.96 average), +2,023 not locked in, +971 realized, 1,450 spread paid. The **Budget screens** now use `mohab-year-2026-10-21-v14/` and `ar-2026-10-21-v14/`, recaptured after app item 3AB was fixed: 38,428 planned, 3,410 spent, 35,018 left; 16,558 for everyday spending, about 591 a day for 28 days, 833 over the plan’s pace. How It Works, Budget App Egypt and Net Worth, Budget and Expense Tracker quote these figures. The Arabic pairing screens `sync-pc` and `sync-phone` are the English ones (the Arabic line is English and the lent popup is cut off). The Version Archive row `UX-2026.10.21.33` (Budget App Egypt) records a page that was checked but not changed. Figures above are the map for the older folders; the paragraphs below are history.

**Since 2026-10-15 (`UX-2026.10.15.04`) the home page shows the app of that day:** seven places counted as one (the dollar brokerage, 114,211 EGP, takes the last row of tiles: 602,179 in your accounts, net worth 546,679, up 324,179 this year), then a new section, Hold Dollars. See Them in Pounds. (Mohab's 235 dollars: cost 11,703 at 49.80 on average, +423 not locked in, worth 12,126 at 51.60, +971 realized; beside `a-usd.webp`), then phone and PC. The routine section (A Minute a Day…) left the home page: How It Works is its page. Safe to spend is 192,215 (free cash 231,692 less 4,460, 25,017, an 8,022 emergency fund top-up and 1,978 for the rest of the savings target); the runway runs 197,102 (2026-09) to 181,397 (2026-11) and reads both from `data-from`/`data-to`. The Arabic home mirrors the facts in its own order. `test.html` keeps the 2026-10-07 figures and screens.

**Since 2026-10-07 the home page (`index.html`, `UX-2026.10.07.16`) is the page built on `test.html`:** hero (All Your Money. One Clear Picture., then four notes: phone and PC always in sync, bank SMS read for you, gold, certificates and shares, no bank login and no server), the six places counted as one (the wow moment), phone and PC connected (the PC borrowing beside the phone that lent it, real screens), pair once (three steps), on your phone (three phone screens), numbers you can trust, the next three months, it does the tedious part (six cards), try it, how it works (a minute a day, twenty once a month), our promise, good questions and the signup band. It uses `assets/app/mohab-year-2026-10-07/` and its figures (below). `test.html` keeps the same page for the next experiment; the paragraphs below are history.

**Since 2026-10-05 there is one live landing page: the home page, `index.html` (`UX-2026.10.05.02`).** It grew out of Version C; don't call it C any more. A (`UX-2026.10.04.43`), B (`UX-2026.10.04.44`) and C's last release at `version-c.html` (`UX-2026.10.04.51`) are archived; `version-b.html` and `version-c.html` redirect to the home page. The A and B descriptions below are history.

There are three landing pages, both built only from [guideline 3.9](guideline/website.html) Part B and both loading only `css/landing.css` and `js/landing.js` (plus the shared theme, testing panel and UX rail). Hero and section headers are centred, each section opens with a short label, and every page ends with the same early-access band (white email pill, Get early access, or, a dark Take the survey button) and a sign-off: the mark and "Study Your Patterns. Control Your Future." Fields on the site are white with a hairline, never grey. Phones come first: each hero sentence stays on one line (the h1's `--fit` is its longest line in em), buttons stack full width, the screen trio is one column and fields are 54px tall. Versions A, B, C and D before 2026-10-04 are in the [version archive](versions.html); `version-c.html` and `version-d.html` now redirect.

**A · Product (`index.html`)** shows Lightning's three strengths: everything you own and owe, the next three months, and why it changed. It never compares Lightning with other apps. Order: hero (H1 with its punch line, the screen trio), what Lightning does (three pillar cards), everything you own and owe (six places counted as one net worth), the next three months (safe to spend beside the forecast, then the next 30 days, the loan payoff and the month ahead), analysis (the tour), does the tedious part (bills find their payments, repeats spotted, one balance checks an account, imports ask once per name, beside the Looks recurring screen), how it works (three numbered steps), try it (the calculator), private by design, good questions and the early-access band.

**B · Philosophy (`version-b.html`)** shows why it works, then the product as proof. Order: hero (H1 with its punch line, the story trio: the plan, the 9:40 reality, the habit), a better system (the habit sum: 150 at the café, 50 at home, 100 kept × 20 = 2,000 a month and the page's one quote), try it (the calculator: keeping it each month is like having the capital in the bank), three truths in order, every app sees one corner (six places, then Lightning, beside the Overview screen), private by design and the early-access band.

**The home page (`index.html`, formerly Version C at `version-c.html`)** leads with numbers you can trust. It loads `css/landing.css`, then `css/home.css`, and `js/landing.js`. Order: hero (H1 "All Your Money. One Clear Picture.", the same as A, "Free to use. No card, no account."), everything you own and owe (Your Money Is in Six Places. Lightning Counts It as One.: the six places added up to net worth), numbers you can trust (pick safe to spend, money out in 2026-09 or saved this year; each shows its working beside the screen it comes from, and on phones a See it on the screen button opens that screen full size), the next three months, try it (the calculator), how it works (three steps, text only), our promise (every feature free, pay once when it's worth it, your money stays with you), good questions and the early-access band. Labels are sentence case and the sign-off is ink. Money out in 2026-09 is Housing & Rent 12,000, Food & Groceries 4,644, Health 2,700, Loan payments 2,500 and Other 6,974; saved this year is 577,860 in less 293,274 spent = 284,586, of which 115,450 invested and 169,136 kept.

- `assets/app/mohab-year-2026-10-15/` (English) and `ar-2026-10-15/` (Arabic) hold the set recaptured on 2026-10-15 from the app of that day, still Mohab's 2026 up to 2026-10-04 (`LIGHTNING_PRICES_OFFLINE=1 LIGHTNING_TODAY=2026-10-04 python -m lightning --sample --no-browser`, Chromium at 1440 × 900 and 1.389× for the 2000 × 1250 windows; content crops at 1296 × 810 with the sidebar hidden; section crops such as `a-forecast-ahead`, `a-suggested` and the new `a-usd` (Currencies › USD) are the section header and its card with 13px around). The sample now holds a dollar brokerage: 235 USD and 8 units of a Nasdaq 100 ETF, 114,211 EGP. Net worth 546,679 (596,179 owned, 49,500 owed), in your accounts 602,179, safe to spend 192,215, the forecast's low 181,397 in 2026-11 then 228,318 in 2026-12 (−10,819 and +46,921), the investing rate 75.7% (215,450 of the 284,586 kept; the app counts it against what you kept since 2026-10-14), net gain this year +44,559 (+20.7% growth), portfolio 352,486. The phone and the two devices (`sync-pc`, `sync-phone`) come from two real profiles paired over a local connection, the PC borrowing; the phone shots are 360 × 760 at 2×. The Arabic app still shows the borrowed and lent line in English, so `ar-2026-10-15/` carries the English `sync-*` images. Older folders stay for archived pages and `test.html`.
- `assets/app/mohab-year-2026-10-07/` holds the same set recaptured on 2026-10-07 from the app of that day, plus the phone (`phone-*.webp`, 720 × 1520) and the two devices connected (`sync-pc.webp`: the PC borrowing, `sync-phone.webp`: the phone that lent it). The data is still Mohab's 2026 up to 2026-10-04 (`LIGHTNING_TODAY=2026-10-04`); the app now counts the emergency fund top-up, so safe to spend is 178,423 (free cash 219,566), the investing rate 37.3% (215,450 invested, 69,136 kept). Since 2026-10-07 the sample also plans a yearly English course (2026-11) and year-end bonus (2026-12): `a-forecast-ahead.webp` shows the forecast's lowest point 165,937 in 2026-11, then 211,192 in 2026-12 (−12,485 and +45,255); the older `a-forecast.webp`, `plan.webp`, `a-plan.webp` and the phone shots still show 168,992 in 2026-12. Every live page uses it since 2026-10-07 (home, How It Works, the guides); `mohab-year-2026-10-04/` and older folders stay for archived pages. The Investments screen's net gain this year is now +31,341 (+14.5%). Safe to spend's four-row working sits beside `a-plan-working.webp`, which shows all four rows; `a-plan.webp` stops before the top-up row.
- Screens are in `assets/app/mohab-year-2026-10-04/`, captured 2026-10-04 from Mohab's full 2026 in the app (`python -m lightning --sample`, port 8767). Overview, Investments and Budget show YTD; Expense analysis shows 2026-09 (every section filled); Cash planning shows today. Older folders (`mohab/`, `mohab-2026-10-04/`) stay for archived pages.
- Every figure on A is on the screen beside it or adds up from Mohab's year on 2026-10-04 (487,967 in your accounts, 6,000 held for family, 49,500 owed: the car loan's 37,500 and October's rent due; 432,467 net worth, up 287,067 this year; free cash 199,566 less 4,460 payments and 25,017 budget left = 170,089 safe to spend until 2026-11-01; portfolio 250,401, +14,841 this year; next 30 days −28,460 out; +6,981 expected in 2026-11; car loan paid off 2027-12-05; September money out 28,818, 42% rent). B uses the same household. Recapture the screens and these figures together.
- One quote per page at most (B has James Clear; A has none). No testimonials until there are real ones. No placeholders.
- How It Works, Downloads and the release log are shared; Home on them returns to the landing page the visitor came from.

## Logo

The logo is the two-leaf mark from the guideline (A02): azure is money you hold, green is money that grows. Files are in `assets/brand/`, copied from the guideline:

- `lightning-mark.svg`: the colour mark, used in every header and footer, light and dark.
- `lightning-app-icon.svg`: the mark on a Nile tile, used as the favicon; `lightning-icon-64.png` and `lightning-icon-180.png` (home screen) are rendered from it.
- `lightning-mark-flat.svg`, `lightning-mark-on-dark.svg`, `lightning-mark-nile.svg`, `lightning-mark-white.svg`, `lightning-lockup.svg` and `lightning-lockup-white.svg` for other uses.
- `lightning-logo-gradient.png`, `lightning-logo-gradient-wordmark.png`, `lightning-mark.png`, `icon-512.png` and `linkedin-banner.png` are re-rendered from the SVGs.
- The old ribbon mark and bolt icon are gone; archived pages use the two-leaf mark too.

## App screenshots

All product images come from Mohab's full 2026 in the app (the sample CSVs), loaded up to the capture date:

```
python -m lightning --sample
```

Pick the period that shows each tab at its best: YTD for the Overview and Investments, the month in progress (2026-10) for Budget, where the plan's pace chart is, August 2026 for Expense analysis (one payment of 14,200, 9.5 times the average, Entertainment above its usual range, spending up 21%; September is flat), today for Cash planning. `tools/site_shots.py` in the app repository captures exactly these.

- Full-window screens (2000 × 1250) are used in tours and steps. Content crops without the sidebar (1800 × 1125, named `a-*.webp`) are used where the chart is the message: the hero trio on every version and the analysis grid on How It Works.
- The hero on A shows the trio: Overview in the middle, Investments and Expense analysis beside it. B shows the Overview beside its six corners.
- Quoted figures (net worth 910,304, safe to spend 112,288 and so on) match these screens. Rules are in section B07 Product screens of `guideline/website.html`.

**One home for the screens: `assets/app/shots.json`.** It says which folder holds each screen, per language (`folders`), with exceptions per screen (`shots`) or per page (`pages`, for `test.html`). Pages keep ordinary `<img>` tags; `python tools/shots.py apply` rewrites every screenshot path (images, zoom buttons, JSON-LD) and every image `width`/`height` from it, `check` (also part of `site_check.py`) fails on drift or a missing file. After a recapture: copy the new files into one new `mohab-year-…`/`ar-…` folder, point `folders` at it, empty `shots`, run `apply`. Old folders stay for archived pages. Quoted figures: `python tools/shots.py figures OLD NEW …` shows, and with `--write` makes, whole-figure replacements on live pages and `llms.txt` (Arabic pages in Arabic-Indic digits); sentences whose meaning changed still need a hand edit.

Since 2026-10-21 the Arabic pages use `assets/app/ar-2026-10-21/` (see Landing pages); from 2026-10-15 to 2026-10-20 they used `assets/app/ar-2026-10-15/`. Before that they used `assets/app/ar-2026-10-12/`, the same screens captured in the Arabic UI with the same figures: `LIGHTNING_TODAY=2026-10-04 python -m lightning --sample --no-browser`, then `curl -X POST -d locale=ar http://localhost:8767/settings/locale`, Chromium `--lang=ar` with locale `ar-EG`; full window 2000 × 1250, content crops 1800 × 1125 with `.side{display:none}` and `.shell{grid-template-columns:1fr}` injected (the forecast crop is 1644 × 590). `sync-pc` and `sync-phone` still use the English images: the Arabic app does not yet translate or lay out the borrowed and lent status line.
