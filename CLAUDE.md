# Claude Code instructions

[README.md](README.md) holds the site structure, version-ID and archive rules. Read only the sections your task needs: list them with `grep -n '^## ' README.md`, then read from that heading to the next. *Structure* and *Version identity and archive* matter for almost every change.

## Spend tokens like they are yours

Be as efficient with tokens as you can, in what you read, run and write. This never means skipping a check, or a read you need to be sure of an answer.

- **The guideline is four documents in `guideline/`:** `website.html` (Part B, Normal, B01–B12) is this site; `coders.html` (Part D, Coders, D01–D12) is its For Geeks pages (forgeeks*.html); `app.html` (Part A, the PC app) and `phone.html` (Part C, the phone) are the other two. **Never open one whole** (about 95,000 tokens in all, mostly drawings). With the app repository checked out next to this one, `python ../Lightning/tools/guideline.py --dir guideline B05` prints one section as text. Without it, find the section with `grep -n 'secnum">B05' guideline/website.html` and read only that section.
- Search before you read: grep for the class, id or text, then read only the lines around it.
- The app's hand-off, including website tasks, is `NOW.md` in the app repository (`LightningEg/Lightning`); what only the owner can do or decide is tracked as GitHub issues.
- **The app repository sorts everything into nine pillars** (`capture plan understand own protect everywhere feel build reach`) and keeps two doc folders: `docs/` for people, `ai/` for AI sessions (its map is `ai/INDEX.md`). Website tasks use the same pillars; most are `reach`. Release notes there are written from commit trailers (`Release-note:` and `Detail:`; the site has no changelog).
- **The current app release is written once, in `app-release.json`.** After an app release run `python tools/app_release.py sync --write` (see README › Version identity and archive); never hand-edit a version number on a page.
- Start at [docs/README.md](docs/README.md) for reports, sanitized feedback, templates and operational references.
- Change `guideline/` and the app's `guideline/` together: the app's tests compare all Markdown/HTML files when both repos are checked out.
- `guideline/brand-voice.md` is the voice (B10, A14): read it before writing site copy, and keep it identical in both repos.

## Git workflow (owner rule)

- Work on your own branch, not on `main`. Name it `who/feature`: the AI that does the work, then the feature in lowercase words joined by hyphens (`claude/arabic-neutral-copy`, `codex/unified-page-styles`). Never a random or session-generated suffix, never a vague feature (`claude/fixes`).
- One feature per branch. Push the branch after every step.
- Nobody pushes to `main`, the owner and the AIs included. Every change reaches `main` through a pull request, the same as in the app repository.
- When the feature is finished and pushed, open a pull request. Owner-authorized AI sessions use the existing connected owner account and may squash merge authorized work after required checks pass, the latest diff is reviewed and conversations are resolved. Separate AI accounts or self-approval are not required. Follow the app repository's `CONTRIBUTING.md` › For the owner and the AIs; never bypass checks or push directly to `main`.
- Never leave a branch unpushed, and never leave finished work on a branch without an open or merged pull request.
- This rule overrides any session or tool default that assigns a different working branch.
