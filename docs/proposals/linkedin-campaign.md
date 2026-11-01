# LinkedIn campaign: why Lightning

Status: post 1 designed, awaiting the owner. Branch `claude/linkedin-campaign`.

## The idea

Tell it like the home page: the problem first, the answer once, at the end. No product tour and no screenshots; people see the app on the website. Each post is one argument, headed by its conclusion (an action title), with one drawn exhibit and its source. Arabic on top, English below (owner's reference, 2026-11-01).

**Storyline (situation, complication, resolution).** Your money is in many places (situation). The balance you can see is not what you own, it doesn't know what's coming, and money in Egypt isn't only in a bank (complications). One ledger on your phone counts all of it (resolution).

## The series

| # | Post | Action title (Arabic · English) | Exhibit |
|---|---|---|---|
| 1 | **Why Lightning** (the whole case, five slides) | معاك كام فلوس؟ بالرقم. · How Much Do You Have? In One Number. | The carousel in `assets/brand/linkedin/01-intro/` |
| 2 | Many places | فلوسك في أماكن كتير. · Your Money Is in Many Places. | Mohab's nine places, then the owner's log story |
| 3 | Own versus hold | رصيدك مش هو ثروتك. · Your Balance Is Not Your Wealth. | 100,000 → 65,000, an illustration |
| 4 | The months ahead | رصيدك ميعرفش إن الإيجار جاي. · Your Balance Doesn’t Know the Rent Is Due. | The runway, lowest point 101,534 in 2026-11 |
| 5 | Money in Egypt | فلوس مصر مش في البنك بس. · Money in Egypt Isn’t Only in a Bank. | Gold, certificate, dollars at your rate, gam’eya |
| 6 | The answer | فلوسك كلها. في صورة واحدة. · All Your Money. One Clear Picture. | Free today, no bank login, no server; download |

Two posts a week (Tuesday and Thursday, 9:00–11:00 Cairo), three weeks. Posts 2–6 reuse post 1's slides as their cover and go one level deeper.

## Rules for every post

- From the owner's account, in the founder voice (brand-voice.md): honest about the problem, specific about the fix. Facts about the owner come only from *What My Own Numbers Taught Me* on Downloads.
- Problem first. Lightning appears once, in the last lines.
- Only what the app does today (B10). Kinds of tool, never a named product. No "most apps", no exclamation marks, no hype words.
- Mohab's figures only as README › Landing pages lists them; anything else is labelled an illustration.
- The link goes in the first comment, with `utm_source=linkedin&utm_medium=social&utm_campaign=li-<nn>-<topic>`; the site's analytics records all three.
- Slides 1080 × 1350, built like B11 (the hero's canvas, lockup and type; Readex Pro and Noto Sans Arabic for Arabic). Render with `node render.js`; upload `carousel.pdf` as a document post.

## Post 1: copy

**English (post text)**

> How much money do you have, in one number?
>
> For years I couldn’t answer that. I logged every pound since I graduated and reviewed it each week, and the log still never showed everything in one place.
>
> Because money here doesn’t sit in one place. A salary account, a certificate, shares, gold at home, a few dollars, a gam’eya.
>
> And even the balance you can see isn’t the answer. Part of it is someone else’s. Part of it is already owed. And it doesn’t know the rent is due next week.
>
> So we built Lightning: one encrypted ledger on your phone that counts everything you own, keeps what you hold for others apart, and shows the months ahead. No bank login, no server. Free today.
>
> Five slides make the case. The app is at lightningeg.com, link in the first comment.
>
> #PersonalFinance #Egypt #Fintech

**Arabic (post text, or the Arabic post)**

> معاك كام فلوس؟ بالرقم.
>
> سنين مكنتش أعرف أجاوب. كنت بكتب كل جنيه من ساعة ما اتخرّجت وبراجعه كل أسبوع، وبرضه عمري ما شفت كله في مكان واحد.
>
> عشان الفلوس هنا مش في مكان واحد: حساب المرتب، وشهادة، وأسهم، ودهب في البيت، وشوية دولارات، وجمعية.
>
> وحتى الرصيد اللي قدامك مش هو الإجابة. جزء منه بتاع حد تاني، وجزء عليك أصلاً، وهو ميعرفش إن الإيجار جاي الأسبوع الجاي.
>
> عشان كده عملنا لايتنينج: سجل واحد مشفّر على موبايلك، بيحسب كل اللي تملكه، ويفصل اللي شايله لغيرك، ويوريك الشهور الجاية. من غير كلمة سر البنك، ومن غير سيرفر. ببلاش النهارده.
>
> الخمس صفحات بيشرحوا الفكرة. والتطبيق على lightningeg.com، واللينك في أول كومنت.

**First comment**

> Download Lightning free: https://lightningeg.com/?utm_source=linkedin&utm_medium=social&utm_campaign=li-01-why

**Document title (shown on the carousel):** Why Lightning · ليه لايتنينج

## Measure

After a week: impressions, saves and reposts on LinkedIn; on the site, sessions with `utm_campaign=li-01-why` and their clicks to Downloads. Compare each post with post 1.

## Open for the owner

- B11 lists banners and link cards, not post carousels. If this design is approved, add a row (LinkedIn carousel · 1080 × 1350 · Arabic on top, exhibit, English, footer with progress) to B11 in both repos.
