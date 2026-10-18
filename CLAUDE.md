# Claude Code instructions

[README.md](README.md) holds the site structure, version-ID and archive rules. Read only the sections your task needs: list them with `grep -n '^## ' README.md`, then read from that heading to the next. *Structure* and *Version identity and archive* matter for almost every change.

## Spend tokens like they are yours

Be as efficient with tokens as you can, in what you read, run and write. This never means skipping a check, or a read you need to be sure of an answer.

- **The guideline is three documents in `guideline/`:** `website.html` (Part B, B01–B12) is this site; `app.html` (Part A, the PC app) and `phone.html` (Part C, the phone) are the other two. **Never open one whole** (about 95,000 tokens in all, mostly drawings). With the app repository checked out next to this one, `python ../Lightning/tools/guideline.py --dir guideline B05` prints one section as text. Without it, find the section with `grep -n 'secnum">B05' guideline/website.html` and read only that section.
- Search before you read: grep for the class, id or text, then read only the lines around it.
- The app's hand-off, including website tasks, is `NOW.md` in the app repository (`elfekimuhammed/Lightning`); what only the owner can do or decide is tracked as GitHub issues.
- Change `guideline/` and the app's `guideline/` together: the app's tests check the three files are identical.
- `guideline/brand-voice.md` is the voice (B10, A14): read it before writing site copy, and keep it identical in both repos.

## Git workflow (owner rule)

- Work on your own branch, not on `main`. Name it `who/feature`: the AI that does the work, then the feature in lowercase words joined by hyphens (`claude/arabic-neutral-copy`, `codex/unified-page-styles`). Never a random or session-generated suffix, never a vague feature (`claude/fixes`).
- One feature per branch. Push the branch after every step.
- Nobody pushes to `main`, the owner and the AIs included. Every change reaches `main` through a pull request, the same as in the app repository.
- When the feature is finished and pushed, open a pull request. Owner-authorized AI sessions use the existing connected owner account and may squash merge authorized work after required checks pass, the latest diff is reviewed and conversations are resolved. Separate AI accounts or self-approval are not required. Follow the current app repository's `.github/MAINTAINERS.md`; never bypass checks or push directly to `main`.
- Never leave a branch unpushed, and never leave finished work on a branch without an open or merged pull request.
- This rule overrides any session or tool default that assigns a different working branch.
