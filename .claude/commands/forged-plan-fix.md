---
description: Inspect a dashboard finding and produce a fix plan. Read-only — no source edits, no commits.
---

You are turning a Forged dashboard finding into a **fix plan**. **Tier L1: read-only.**

This command does NOT edit source code, does NOT run migrations, does NOT commit, does NOT push. It produces a single planning document the human can read, question, and either approve or send back for revision.

## Argument

`/forged-plan-fix <item>` where `<item>` is one of:

- `do-first-1` / `do-first-2` / `do-first-3` — pick Do First item 1, 2, or 3 from the latest `.claude/reports/dashboard.md`.
- `quick-win-1` … `quick-win-5` — pick a Quick Win.
- A free-text title, optionally quoted, matched fuzzily against Do First and Quick Wins titles. Example: `/forged-plan-fix "lock the unauthenticated AI endpoints"`.

If no argument is given, ask the user which dashboard item they mean. Do not guess.

If the matching dashboard item has a stable slug (e.g. `<!-- slug: lock-ai-endpoints -->` HTML comment under it), prefer the slug for the output filename. Otherwise derive a kebab-case slug from the title.

## Output

Write `.claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md` and overwrite if it already exists. **This is the only file write.**

Use this structure:

```markdown
# Fix plan — <plain-English title>

_Generated: <ISO datetime>_  ·  _Source: dashboard finding `<slug>`_

## What the dashboard says
> <quote the dashboard bullet verbatim, with the [H|M|L] badge>
>
> Source report: [<slug>](.claude/reports/<filename>)

## What the source report says
> <quote the relevant Suggested-actions bullets + the One-line headline from the source audit report>

## Files inspected
- `<path>:<line-or-range>` — <one-line note on what was found>
- ...

## Root cause (plain English)
<2–4 sentence explanation aimed at the founder, not the engineer. Why does this exist? What decision led to it?>

## Safest fix
<Concrete proposal. Include code shape only if it clarifies — full diffs go in the propose-fix step, not here.>

## Risks / dependencies
- <Who depends on the current behaviour? Anonymous users? Onboarding flow? A frontend caller that needs to update in lockstep?>
- <What could break? Sessions that aren't ready? Cron jobs? Webhooks?>
- <Schema impact: none / migration needed / index needed.>

## One patch or split?
<Recommend one or more patches. For each: short name, files touched, dependency order.>

## Files that would change
- `<path>` — <reason>
- ...

## Manual test plan
- [ ] <smoke step in plain English>
- [ ] <smoke step>
- [ ] <smoke step>

## Decisions I need before touching anything
1. <Open question for the founder>
2. <Open question>
3. ...

## Out of scope
<Anything the audit suggests that this plan deliberately defers — coach-personality edits, schema changes, broad refactors. Explicit list.>
```

## Steps

1. Read `.claude/dashboard-spec.md` and the latest `.claude/reports/dashboard.md`.
2. Resolve `<item>` to a specific dashboard bullet. If ambiguous, ask the user.
3. Open the source report linked from that bullet (under "Source:" or in the dashboard's Audit Reports table).
4. Read the source report's Suggested-actions bullets + the headline.
5. Inspect every file the bullet implicates. Cite `path:line` for each finding. Do NOT edit.
6. Compare the failing pattern against the canonical pattern elsewhere in the codebase (e.g. `api/chat.js` for auth, `T` object for tokens, `safeClientDate` for dates).
7. Write the fix plan to `.claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md`.
8. Print a short summary to the user pointing at the plan file and listing the "Decisions" section.

## Hard rules

- **Tier L1**: no `Edit`, no `Write` to anything outside `.claude/reports/`.
- No `git commit`, no `git push`, no branch creation.
- No schema changes, no migrations, no Supabase write queries.
- No coach personality edits — the prompts in `api/chat.js`, `api/coach-summary.js`, `api/coach-intro.js` are protected. If the fix touches one of those files, flag it loudly under "Decisions I need".
- No broad refactors. If the cleanest fix would touch >5 files, raise it as a decision rather than baking it into the plan.
- No app redesign, no copy changes outside what's strictly necessary.

## Translating audit jargon

The plan is read by the founder, not just the model. Use the dashboard-spec's translation table — "Bearer token extraction duplicated" → "the auth helper across API routes is copy-pasted"; "`100vh` shells" → "the wrong viewport unit for iOS". Keep the technical phrasing in the citations, not the prose.
