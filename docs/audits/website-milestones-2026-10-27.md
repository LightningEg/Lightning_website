# Website milestones 1–6: final audit (2026-10-27)

## What changed
| Milestone | Pages | Result |
|---|---|---|
| 1 Top bar | all 68 main-site pages | Home · Features · Community · Marketplace · For Geeks + Download free, one generator (`tools/header.py`) |
| 2 Home | `index.html`, `ar/index.html` | one-sentence hero, PC + phone side by side, real community pulse, five repeated sections cut |
| 3 Features | `features.html`, `ar/features.html` | six-question explorer with real screens; groups fold; PC height ~8,200 → ~4,100 px |
| 4 Community | `community.html` | three ways in, top five builders with GitHub and last merged PR, latest stories |
| 5 Marketplace | `marketplace.html`, `topup.html`, shop scripts | three-step "how buying works" (InstaPay → try on → buy once); explainer lines under each heading cut; currency reads **Cotton Plants** everywhere a member reads it |
| 6 For Geeks + audit | For Geeks footer, this file | For Geeks footer links the Community builders; checks below |

Checks: `tools/site_check.py` 0 errors (14 old warnings), `header.py`, `footer.py`, `shots.py`, `geeks_shell.py` in step; no script errors on Home, Features, Community, Marketplace, Wallet, For Geeks at 1280 px and 390 px, English and Arabic.

## Animations: inventory and verdict
| Where | Motion | Reduced motion | Verdict |
|---|---|---|---|
| Home | wow scene, PC+phone arrive, pulse line fade | yes | keep; the wow scene is the one big moment |
| Features | panel cross-fade 350 ms, group "+" turns to "×" | yes | keep |
| Community | quest cards and builder rows rise in, 70 ms apart | yes | keep |
| Sync demo | packet travels phone ↔ PC, mirrored in Arabic | yes | keep |
| Shared (`motion.js`) | count-up figures, list stagger, section rise | yes | count-up should start from the real figure on reload (earlier "0 EGP" flash) |
| For Geeks | particle field, lightning, terminal blink, run-line | yes | strongest page; phone hero is a full screen before any text, consider 80svh |
| Themes (`textures.css`) | thread shimmer, pigment drift | yes | good, but only on Marketplace previews |

Proposed signature moments still missing:
1. **Leaderboard rank change**: a row slides to its new place when a merge lands (FLIP, 400 ms).
2. **Purchase confirm**: the item card "stitches" into the collection (theme seal press, 300 ms), no confetti.
3. **Try it on**: a soft wipe across the page from the card the member pressed, instead of an instant swap.

## Themes: how to make them better
- **Preview where it matters**: "Try it" should show the theme on a real app Overview screen, not only on this site.
- **One page per theme**: each theme gets a detail page (PC, phone, light, dark, Arabic) from its guideline, so people buy what they saw.
- **Event themes**: one slot per season (Ramadan, Valentine, Sham El-Nessim) with a fixed launch and end date, shown with a quiet date label, never a countdown.
- **Texture strength control**: members choose subtle or full texture; reduced motion keeps the texture still.
- **Contrast badge on every card**: "AA light · AA dark" from the theme check, so trust is visible.

## Missing gaps to build next
1. **InstaPay receipt**: after "I paid", show a receipt with a reference and status (pending, credited, refused) on the Wallet page and by email.
2. **Supporter tiers on profiles**: Bronze, Silver, Gold, Obsidian shown on profile and leaderboard, never amounts (owner, 2026-10-27).
3. **GitHub link prompt**: members with no GitHub login see "Link GitHub to show your work" on their account; today two ranked members show only a name.
4. **Arabic Community and Marketplace**: the Arabic top bar still sends people to English pages.
5. **For Geeks wording**: For Geeks market pages still say "coins"; rename with the database `market_catalog()` output in one change.
6. **Refund window** in the buy dialog (unequipped items, 7 days) is in the plan but not on screen.
7. **Weekly quest**: one rotating small task on Community (e.g. "translate one screen") so returning visitors find something new.
8. **Accessibility pass on real devices**: screen reader and real Android/Windows browsers were not checked.
