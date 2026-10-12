# Lightning website

The marketing site for **Lightning**, a personal wealth app made in Egypt.

> Study Your Patterns. Control Your Future.

Built in the **Meadow** identity: meadow green for growth, azure for clarity, and a deep Nile anchor for actions. Headings and big numbers use Bricolage Grotesque; text and figures use Manrope; on Arabic pages Readex Pro shows and IBM Plex Sans Arabic reads. Open the [Lightning guideline](guideline/) (3.27, three documents in `guideline/`) for the complete system: [app.html](guideline/app.html) is Part A, the app, [website.html](guideline/website.html) is Part B, this site, and [phone.html](guideline/phone.html) is Part C, the app on a phone. `app-ar.html`, `website-ar.html` and `phone-ar.html` are the same three documents in Egyptian Arabic: same sections, layout and drawings, mirrored right to left. The English documents stay the authority, except the Arabic type (B04) and words (B10) in `website-ar.html`, which govern the Arabic pages; change both copies, here and in the app repository.

## Structure

```
index.html          the home page, the only live landing page: phone and PC connected, and every number shows its working (guideline Part B)
version-b.html      redirect to index.html (Version B is archived)
version-c.html      redirect to index.html (the old Version C address; its design is now the home page)
how-it-works.html   the monthly 30-minute routine: upload, adjust, analyse
release-log.html    release log: what changed build by build (landing system; css/release-log.css)
current-status.html shared beta hub: status, safe sample CSVs, builds and app feedback
sample-profiles.html four fictional Egyptian 2026 sample ledgers and the financial question each explores
versions.html       release registry and visible IDs for every testable experience
version-registry.json machine-readable release IDs and archive locations
survey.html         optional personal finance survey (the landing system: the same top bar without the button, hero, card, tagline and footer; always light)
features.html       Features: the five things it does best (each with a Mohab number), then all 94 features in eleven groups, the phone and PC second, with a jump to each (css/features.css)
guides.html         Guides: the one library page, two cards (Using Lightning: the seven guides below; Budgeting basics: the five articles), each a list of the readers' questions linked to the page that answers it (css/guides.css `.g-lib`)
*-egypt.html, net-worth-tracker.html, cash-flow-planner.html, bank-statement-budgeting.html, offline-personal-finance-app.html
                    the guides: one search question each, answered with Mohab's year (see Search below)
ar/                  Egyptian Arabic home page, Features, How It Works, Current Status («التنزيل»), Guides («مقالات»), seven guides and Release Log: the English design system, written for Egypt; each language switch opens the matching page
blog.html           redirect to guides.html (the blog index is retired; the library is Guides). The five English articles (blog-*.html: salary-runs-out, budget-20000-egp, track-expenses, emergency-fund, irregular-income-budget); each has its own canonical URL, BlogPosting, BreadcrumbList and FAQPage data, and css/blog.css
ar/blog.html         redirect to ar/guides.html; the five articles in Egyptian Arabic (same file names under ar/); written for Egypt, not translated, with reciprocal hreflang and a language switch to the English page
css/arabic.css       loaded last on ar/ pages: the Arabic faces at the English sizes and weights (B04, A06.2), the right-to-left gradient and the few x-axis movements that dir="rtl" can't flip
assets/fonts/       Readex Pro (variable, to 700) and IBM Plex Sans Arabic 400–700 (Arabic subset only) and their OFL licenses, for the Arabic pages
robots.txt          crawl rules and the sitemap's address
sitemap.xml         every page that should be in search, and nothing else
css/styles.css      shared styles
css/version-b.css   Version B's own sections (builds on css/version-c.css)
js/version-b.js     Version B calculator with an adjustable return rate
css/version-c.css   the old Version C system, still used by App Feedback, Versions and the Arabic How It Works and Current Status
js/version-c.js     the old Version C script, still used by How It Works
css/landing.css     the landing pages: self-contained, guideline tokens and building blocks only
css/home.css        the home page's own sections, loaded after css/landing.css
css/guides.css      the guide pages' few extras, loaded after css/home.css
css/signup-band.css the signup band, the same on every page (guideline 3.20). It is the only gradient call-out card: any other closing prompt is a plain section (B06). Buttons: vivid only in the hero and for the band's survey, Nile primary elsewhere, 48px (top bar 40, inside tables 36)
js/signup.js        the signup form on pages whose own script doesn't handle it (Current Status)
js/landing.js       the landing pages: calculator, tabs, lightbox and signup
css/version-d.css   Version D's stylesheet, kept for the Arabic release log page
css/how-it-works.css, css/status.css (Current Status), css/sample-profiles.css, css/release-log.css
                    the four English pages that now sit on the landing system (header, hero, headings, cards, signup band and footer are the home page's): only their own components live here
js/analytics.js     GoatCounter page views and one event per download
audit/              website audits against the guideline
css/theme.css       light/dark switch
css/motion.css      small motion on the home page, Features, How It Works, Current Status and the guides (see Motion below)
js/motion.js        count-up figures, the rolling calculator answer, lists arriving item by item and scroll reveal
test.html           private test page, not indexed or linked: the two-screen ledger handoff follows the hero; its one-time animation has a Hand back control and a static reduced-motion state; the six-places wow still plays
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
guideline/            Lightning guideline 3.30 in three documents: app.html (A, the PC app), website.html (B, this site) and phone.html (C, the phone); same folder as the app's guideline/
```

It's a static site with no build step and no dependencies. Fonts load from Google Fonts; the Arabic pages add Readex Pro and IBM Plex Sans Arabic, hosted here.

**Arabic pages are built for Egypt, not translated.** An `ar/` page uses the English page's design system (the same stylesheets, components and class names, with `lang="ar-EG" dir="rtl"`, `../` paths and `css/arabic.css` last; no Testing panel), but its words, examples, order and number of sections are written for an Egyptian reader, in Egyptian Arabic, with the same facts and screens. The voice, fixed words and Arabic type are in `guideline/website-ar.html` B04 and B10. The shared stylesheets write left and right as logical properties (`margin-inline-start`, `inset-inline-end`, `text-align:start`), so the same CSS lays out both directions: keep it that way. When an English page's facts change, change its `ar/` page too. Visible numbers use Arabic-Indic digits (٢١٥٬٦٥٧ جنيه); the scripts read and write them on `lang="ar-EG"` pages. Dates stay yyyy-mm-dd inside `<bdo dir="ltr">` (٢٠٢٦-١٠-٠٤), so the Arabic-Indic digits are not reversed. Keep URLs, IDs, attribute values and technical color codes unchanged.

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
- `UX-2026.10.04.28` — `current-status.html` (Current Status · beta, and ready to use)
- `UX-2026.10.04.29` — `release-log.html` (Release Log · beta, and ready to use)
- `UX-2026.10.04.30` — `release-log.html` (Release Log · one card per build)
- `UX-2026.10.04.31` — `index.html` (A · beta testers wanted)
- `UX-2026.10.04.32` — `version-b.html` (B · beta testers wanted)
- `UX-2026.10.04.33` — `version-c.html` (C · beta testers wanted)
- `UX-2026.10.04.34` — `how-it-works.html` (How It Works · beta testers wanted)
- `UX-2026.10.04.35` — `current-status.html` (Current Status · beta testers wanted)
- `UX-2026.10.04.36` — `release-log.html` (Release Log · beta testers wanted)
- `UX-2026.10.04.37` — `index.html` (A · beta testers, in the signup)
- `UX-2026.10.04.38` — `version-b.html` (B · beta testers, in the signup)
- `UX-2026.10.04.39` — `version-c.html` (C · beta testers, in the signup)
- `UX-2026.10.04.40` — `how-it-works.html` (How It Works · beta testers, in the signup)
- `UX-2026.10.04.41` — `current-status.html` (Current Status · no strip)
- `UX-2026.10.04.42` — `release-log.html` (Release Log · beta testers, in the signup)
- `UX-2026.10.04.43` — `index.html` (A · one signup everywhere)
- `UX-2026.10.04.44` — `version-b.html` (B · one signup everywhere)
- `UX-2026.10.04.45` — `version-c.html` (C · one signup everywhere)
- `UX-2026.10.04.46` — `how-it-works.html` (How It Works · one signup everywhere)
- `UX-2026.10.04.47` — `current-status.html` (Current Status · one signup everywhere)
- `UX-2026.10.04.48` — `release-log.html` (Release Log · one signup everywhere)
- `UX-2026.10.04.49` — `version-c.html` (C · one clear picture)
- `UX-2026.10.04.50` — `current-status.html` (Current Status · what my own numbers taught me)
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

## Current Status and app feedback

[Current Status](current-status.html) is the shared beta hub for both landing pages. It keeps beta orientation, harmless Mohab sample CSVs, release notes/download links and app feedback in one predictable place. The header and the **Testing** panel both link to it. Home on this shared page returns to the landing version a visitor most recently viewed.

The app feedback form accepts multiple tickets at once, with up to five screenshots per ticket and ten per submission. Testers can choose PNG, JPEG or WebP images, or paste them into a ticket description. PNG screenshots are re-encoded losslessly at their original dimensions; the smaller encoding is kept only when it actually saves space. JPEG and WebP files are sent unchanged. The browser prepares each image as soon as it is attached, then sends the images with the tickets in one `form_type=app_feedback` request.

The receiver expands the request into **one row per ticket** in the **App Feedback** tab and stores each screenshot in a private Drive folder owned by the Apps Script deployment account. It adds Drive links to the ticket row and does not change file sharing. A source image can be up to 10 MiB; after processing, each attachment must be 5 MiB or smaller and all attachments in one submission must total 12 MiB or less. To activate screenshot storage, replace or add the contents of [apps-script/AppFeedbackReceiverPatch.gs](apps-script/AppFeedbackReceiverPatch.gs) in the existing receiver, route `form_type=app_feedback` to `saveAppFeedback_`, run `setupAppFeedbackDrive()` once from the Apps Script editor as the deployment owner to authorize Drive and create the folder, then deploy a new version. Keep the existing `/exec` URL. The pre-created **App Feedback** tab is in [Lightning-survey-responses](https://docs.google.com/spreadsheets/d/1rmV9GtffAJByilsxre0bQBMm-cza1uCXBwDbjuD_ffc/edit).

The included `assets/samples/mohab-2026-full-year.zip` is Mohab’s full fictional 2026 sample pack: eight CSVs for accounts, CIB payroll, Vodafone Cash, cash wallet, gold, certificate, THNDR and prices. It lets a tester explore the complete import and analysis flow without entering their own data.

## Analytics (GoatCounter)

`js/analytics.js` is loaded on every page (not the brand guideline). It sends page views to [GoatCounter](https://mohamedelfeki.goatcounter.com), which shows visits and unique visitors, and records one event per download:

- `download-app-<version>-<platform>` for an app build, read from any link to the Lightning-downloads repository that ends in `.zip`, `.exe`, `.msi`, `.dmg` or `.AppImage`, or `.apk` (for example `download-app-v1.0.0-beta.1-android`). A new build is counted as soon as its link is on a page; nothing to tag.
- `download-sample-<file>` for the sample pack.

"Unique visitors" counts browsing sessions, not people: one person who visits in the morning and again after GoatCounter's session window has passed counts twice, so five people can show as up to ten. Read it as visits from distinct sessions or devices.

Read them on the GoatCounter dashboard; events are listed with the pages, filter by `download`. GoatCounter ignores localhost, so local previews are not counted. Add `<script src="js/analytics.js?v=20261003-1" defer></script>` before `</head>` on any new page.

## Search (SEO)

Lightning aims to be found first for **free personal finance for Egypt**, then for the wider terms. The home page owns that phrase; each guide owns one question.

- **Every indexable page** has a title and description written for search, an absolute `<link rel="canonical" href="https://lightningeg.com/...">` (the home page is `https://lightningeg.com/`), Open Graph tags with `assets/brand/social-card.png`, and a line in `sitemap.xml`. Add all four to any new public page.
- **Arabic pages** live under `/ar/`, use Egyptian Arabic (`lang="ar-EG"`, `dir="rtl"`), and have their own Arabic title, description, canonical, Open Graph metadata, structured data and sitemap entry. Add reciprocal `hreflang="ar-EG"` and `hreflang="en"` links on both language versions; each language switch opens the same page in the other language. Write for Egyptian search terms such as إدارة المصاريف في مصر and ميزانية شهرية, in natural Egyptian Arabic.
- **Not in search:** survey, app feedback, the test page, the version archive, the brand guideline and every `archive/` snapshot carry `<meta name="robots" content="noindex,follow">` and stay out of the sitemap. Add the same line to each new snapshot (the one head change allowed on a snapshot besides brand-wide ones). `version-b.html` and `version-c.html` redirect to the home page and canonicalise to it; `blog.html` and `ar/blog.html` redirect to the Guides pages the same way, and stay out of the sitemap. `robots.txt` blocks only files that are not pages (`audit/`, `analytics/`, `apps-script/`, the READMEs), because a blocked page can't show its noindex.
- **Structured data:** the home page has `Organization`, `WebSite`, `SoftwareApplication` (free, Windows, FinanceApplication) and `FAQPage` (its seven visible questions); each guide has `WebPage` and `FAQPage` matching its visible questions; How It Works has `WebPage` and `HowTo` (its three steps); Features, Current Status and the Release Log have `WebPage`; Guides has `CollectionPage`, `BreadcrumbList` and an `ItemList` of every page it links. Each blog article (English and Arabic) has `BlogPosting`, `BreadcrumbList` and `FAQPage` matching its visible questions; their breadcrumb reads Home > Guides > article. Change the structured data whenever the visible text it repeats changes. Only true claims: no ratings, reviews or download counts until real ones exist. Update `softwareVersion` with each app release.
- **The guides** (`guides.html` lists them as questions): net worth, budget, expenses, investments, safe to spend, bank statements, privacy. Each is built from the landing building blocks only (hero, a worked example beside its real screen, three cards or steps, good questions, keep reading, the signup band). Every figure comes from Mohab's year on 2026-10-04 and matches the screen beside it, as on the home page; recapture them together. They never mention other apps (B10, B12), so comparison pages are not built.
- **Head-only changes** (title, description, canonical, social tags, structured data) don't change what a visitor sees, so they don't need a new release ID. Visible copy does.
- **AI assistants:** `llms.txt` is a plain summary of what Lightning is, its key facts and every public page, for AI assistants and AI search. Update it when a fact on the site changes (price, platform, version, a new guide). `robots.txt` names the AI crawlers (Claude, ChatGPT, Perplexity, Gemini, Apple and others) to make the welcome explicit; they follow the same rules as everyone. Many AI crawlers do not run JavaScript, so every fact must be in the HTML as written; `js/motion.js` and `js/wow.js` stand down for crawlers, so a crawler that does run scripts also reads every figure as written.
- **IndexNow:** `.github/workflows/indexnow.yml` sends every sitemap address to IndexNow (Bing, which feeds ChatGPT and Copilot search, plus Yandex, Seznam and Naver) after each publish. The key file at the root (`7778af1015309ba6ad3ba3f379bb6811.txt`) must stay. Google reads `sitemap.xml` instead.
- **After publishing:** the owner verifies `lightningeg.com` as a Domain property in Google Search Console (DNS) and in Bing Webmaster Tools, submits `https://lightningeg.com/sitemap.xml` and requests indexing for the home page, How It Works, Current Status and the guides. Then write the next guides from the queries Search Console reports.

## Version identity and archive

Every testable web experience has one visible immutable release ID, in the form `UX-YYYY.MM.DD.NN`. Current IDs appear in the Testing panel and on [Version Archive](versions.html); feedback records that same ID. Before a live page changes, copy it and its page-specific CSS/JS to `archive/RELEASE-ID.html` and matching resource snapshots, add the permanent link to `version-registry.json` and `versions.html`, then allocate a new ID to the changed page. Never reuse an ID or overwrite an archived snapshot.

Arabic localized counterparts do not use English UX test release IDs.

Windows and Android app versions are separate from website experience IDs. The Current Status page and [Version Archive](versions.html) link to each app build independently. Keep at least the three newest app versions permanently, add a new row for every release, and never replace an older version's file or link. Published ZIPs, APKs and checksums live in the public [Lightning-downloads repository](https://github.com/elfekimuhammed/Lightning-downloads).

## Status

The website, survey, and Google Sheets receiver are connected. When changing the receiver, update its URL in both landing pages and the survey page, then verify that a submission appears in the destination Sheet.

## Motion

The home page, Features, How It Works, Current Status, Guides and every guide load `css/motion.css` and `js/motion.js` (about 6 KB together, no library). Money figures count up from zero to their exact value as they scroll into view, the calculator answer rolls to each new figure, the items of a list (tiles, breakdown lines, steps, cards side by side, feature bullets) arrive one after another, sections rise in once, real screens lift under the pointer, and pages fade into each other where the browser supports it. Only the home page has a big animation, the wow moment below; secondary pages keep to this small motion (owner's choice, 2026-10-06).

- Only position (`translate`, `transform`) and `opacity` move; nothing on screen at load is hidden or animated, so the first paint is untouched.
- Small motion (counts, the calculator roll, tiles, lines and steps arriving in order) always plays, also with *reduce motion* on (owner's choice, 2026-10-06). Big motion (sections rising, screens lifting, page fades) switches off then.
- Without the script, every figure shows as written.
- Every count ends on the page's own text, so a figure always matches its screen (B07).
- To add it to another page, link both files after the page's own CSS; page fades need both pages to load `css/motion.css`.
- **The wow moment** (`css/wow.css`, `js/wow.js`): in section 1 the six money tiles pour into one sticky *In Your Accounts* figure as you scroll, which adds them up to the first line of the breakdown. Each tile takes 420px of scroll, tiles side by side go 160px apart, and the figure trails the scroll by about a second, so the eye can follow. GSAP + ScrollTrigger (about 46 KB compressed, `js/vendor/`) are fetched only after the page has loaded. `<body data-wow-always>` plays it even with *reduce motion* on: the home page has it (owner's choice, 2026-10-06), and so does `test.html` (`noindex`, not in the sitemap or any menu).

- **The runway** (`css/runway.css`, `js/runway.js`; Home section "Watch Your Cash Before It Moves", the Arabic Home after "تقدر تصرف كام"; `test.html` keeps a copy): a scene that plays by itself in about 2 seconds when it scrolls into view (and again after you scroll back above it), where a dot rides the cash line across the next three months, events light up as it passes, the figure rolls down to the lowest point and "Safe to spend until payday" appears. The path is illustrative between two real month ends and says so. Without the script the finished picture shows. It plays with reduced motion on too (small motion, owner’s rule). It draws the line with `stroke-dashoffset`, which is the one exception to the transform-and-opacity rule above.

**Phone spacing (2026-10-12):** on phones sections are 40 apart, a header sits 20 above its content, cards are 12 apart with 18 padding, and the three phone screens on Home are a swipe strip (`.t-phones`) instead of a stack.

## Dark mode

Both landing pages, How It Works and the brand guidelines support light and dark ("Meadow Night"). The full spec is in section B09 Dark mode of `guideline/website.html`.

- The page follows the device setting until the visitor uses the switch; the choice is then remembered in `localStorage` (`lightning-theme`).
- To add dark mode to another page: include `css/theme.css` and `js/theme.js` (in `<head>`, not deferred), add `<button data-theme-toggle></button>` to the top bar, and define the page's dark colors under `:root[data-theme="dark"]`.
- The survey is still light only.

## Header and testing panel

- Every version uses the same header: the logo, **Home · Features · How It Works · Current Status**, and a dark **Take the survey** button (just "Survey" on phones). The header only links to pages, never to a section of the same page.
- The release ID (linking to the version archive), **Submit UX Test**, and **Submit app feedback** live in the **Testing** tab on the right edge of the screen. `js/dev-dock.js` builds it the same way on every page; load it with `defer` before `js/ux-test.js`.
- There is one live landing page, so **Home** always goes to `index.html`. Archived versions are on [Version Archive](versions.html).

## Landing pages

**Since 2026-10-07 the home page (`index.html`, `UX-2026.10.07.16`) is the page built on `test.html`:** hero (All Your Money. One Clear Picture., then four notes: phone and PC always in sync, bank SMS read for you, gold, certificates and shares, no bank login and no server), the six places counted as one (the wow moment), phone and PC connected (the PC borrowing beside the phone that lent it, real screens), pair once (three steps), on your phone (three phone screens), numbers you can trust, the next three months, it does the tedious part (six cards), try it, how it works (a minute a day, twenty once a month), our promise, good questions and the signup band. It uses `assets/app/mohab-year-2026-10-07/` and its figures (below). `test.html` keeps the same page for the next experiment; the paragraphs below are history.

**Since 2026-10-05 there is one live landing page: the home page, `index.html` (`UX-2026.10.05.02`).** It grew out of Version C; don't call it C any more. A (`UX-2026.10.04.43`), B (`UX-2026.10.04.44`) and C's last release at `version-c.html` (`UX-2026.10.04.51`) are archived; `version-b.html` and `version-c.html` redirect to the home page. The A and B descriptions below are history.

There are three landing pages, both built only from [guideline 3.9](guideline/website.html) Part B and both loading only `css/landing.css` and `js/landing.js` (plus the shared theme, testing panel and UX rail). Hero and section headers are centred, each section opens with a short label, and every page ends with the same early-access band (white email pill, Get early access, or, a dark Take the survey button) and a sign-off: the mark and "Study Your Patterns. Control Your Future." Fields on the site are white with a hairline, never grey. Phones come first: each hero sentence stays on one line (the h1's `--fit` is its longest line in em), buttons stack full width, the screen trio is one column and fields are 54px tall. Versions A, B, C and D before 2026-10-04 are in the [version archive](versions.html); `version-c.html` and `version-d.html` now redirect.

**A · Product (`index.html`)** shows Lightning's three strengths: everything you own and owe, the next three months, and why it changed. It never compares Lightning with other apps. Order: hero (H1 with its punch line, the screen trio), what Lightning does (three pillar cards), everything you own and owe (six places counted as one net worth), the next three months (safe to spend beside the forecast, then the next 30 days, the loan payoff and the month ahead), analysis (the tour), does the tedious part (bills find their payments, repeats spotted, one balance checks an account, imports ask once per name, beside the Looks recurring screen), how it works (three numbered steps), try it (the calculator), private by design, good questions and the early-access band.

**B · Philosophy (`version-b.html`)** shows why it works, then the product as proof. Order: hero (H1 with its punch line, the story trio: the plan, the 9:40 reality, the habit), a better system (the habit sum: 150 at the café, 50 at home, 100 kept × 20 = 2,000 a month and the page's one quote), try it (the calculator: keeping it each month is like having the capital in the bank), three truths in order, every app sees one corner (six places, then Lightning, beside the Overview screen), private by design and the early-access band.

**The home page (`index.html`, formerly Version C at `version-c.html`)** leads with numbers you can trust. It loads `css/landing.css`, then `css/home.css`, and `js/landing.js`. Order: hero (H1 "All Your Money. One Clear Picture.", the same as A, "Free to use. No card, no account."), everything you own and owe (Your Money Is in Six Places. Lightning Counts It as One.: the six places added up to net worth), numbers you can trust (pick safe to spend, money out in 2026-09 or saved this year; each shows its working beside the screen it comes from, and on phones a See it on the screen button opens that screen full size), the next three months, try it (the calculator), how it works (three steps, text only), our promise (every feature free, pay once when it's worth it, your money stays with you), good questions and the early-access band. Labels are sentence case and the sign-off is ink. Money out in 2026-09 is Housing & Rent 12,000, Food & Groceries 4,644, Health 2,700, Loan payments 2,500 and Other 6,974; saved this year is 577,860 in less 293,274 spent = 284,586, of which 115,450 invested and 169,136 kept.

- `assets/app/mohab-year-2026-10-07/` holds the same set recaptured on 2026-10-07 from the app of that day, plus the phone (`phone-*.webp`, 720 × 1520) and the two devices connected (`sync-pc.webp`: the PC borrowing, `sync-phone.webp`: the phone that lent it). The data is still Mohab's 2026 up to 2026-10-04 (`LIGHTNING_TODAY=2026-10-04`); the app now counts the emergency fund top-up, so safe to spend is 178,423 (free cash 219,566), the investing rate 37.3% (215,450 invested, 69,136 kept). Since 2026-10-07 the sample also plans a yearly English course (2026-11) and year-end bonus (2026-12): `a-forecast-ahead.webp` shows the forecast's lowest point 165,937 in 2026-11, then 211,192 in 2026-12 (−12,485 and +45,255); the older `a-forecast.webp`, `plan.webp`, `a-plan.webp` and the phone shots still show 168,992 in 2026-12. Every live page uses it since 2026-10-07 (home, How It Works, the guides); `mohab-year-2026-10-04/` and older folders stay for archived pages. The Investments screen's net gain this year is now +31,341 (+14.5%). Safe to spend's four-row working sits beside `a-plan-working.webp`, which shows all four rows; `a-plan.webp` stops before the top-up row.
- Screens are in `assets/app/mohab-year-2026-10-04/`, captured 2026-10-04 from Mohab's full 2026 in the app (`python -m lightning --sample`, port 8767). Overview, Investments and Budget show YTD; Expense analysis shows 2026-09 (every section filled); Cash planning shows today. Older folders (`mohab/`, `mohab-2026-10-04/`) stay for archived pages.
- Every figure on A is on the screen beside it or adds up from Mohab's year on 2026-10-04 (487,967 in your accounts, 6,000 held for family, 49,500 owed: the car loan's 37,500 and October's rent due; 432,467 net worth, up 287,067 this year; free cash 199,566 less 4,460 payments and 25,017 budget left = 170,089 safe to spend until 2026-11-01; portfolio 250,401, +14,841 this year; next 30 days −28,460 out; +6,981 expected in 2026-11; car loan paid off 2027-12-05; September money out 28,818, 42% rent). B uses the same household. Recapture the screens and these figures together.
- One quote per page at most (B has James Clear; A has none). No testimonials until there are real ones. No placeholders.
- How It Works, Current Status and the release log are shared; Home on them returns to the landing page the visitor came from.

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

Pick the period that shows each tab at its best: YTD for the Overview, Investments and Budget, a whole month for Expense analysis, today for Cash planning.

- Full-window screens (2000 × 1250) are used in tours and steps. Content crops without the sidebar (1800 × 1125, named `a-*.webp`) are used where the chart is the message: the hero trio on every version and the analysis grid on How It Works.
- The hero on A shows the trio: Overview in the middle, Investments and Expense analysis beside it. B shows the Overview beside its six corners.
- Quoted figures (net worth 432,467, savings rate 49.2%, safe to spend 170,089 and so on) match these screens. Rules are in section B07 Product screens of `guideline/website.html`.

The Arabic pages (`ar/`) use `assets/app/ar-2026-10-12/`, the same screens captured in the Arabic UI with the same figures: `LIGHTNING_TODAY=2026-10-04 python -m lightning --sample --no-browser`, then `curl -X POST -d locale=ar http://localhost:8767/settings/locale`, Chromium `--lang=ar` with locale `ar-EG`; full window 2000 × 1250, content crops 1800 × 1125 with `.side{display:none}` and `.shell{grid-template-columns:1fr}` injected (the forecast crop is 1644 × 590). `sync-pc` and `sync-phone` still use the English images: the Arabic app does not yet translate or lay out the borrowed and lent status line.
