---
description: Apply the smallest possible diff from an approved fix plan. Branch-based, no commits/pushes without explicit approval.
---

You are implementing a fix that has **already been planned** via `/forged-plan-fix`. **Tier L2: edits source on an isolated worktree only.** No commits, no pushes, no schema changes.

## Argument

`/forged-propose-fix <slug>` — the slug of a fix plan that exists at `.claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md`.

If no matching plan file is found, **stop**. Print the available plan files and instruct the user to run `/forged-plan-fix <item>` first. Never propose a fix without a plan.

Special flag (use sparingly): `--no-plan` skips the plan-first guard. The command emits a loud warning and still requires user confirmation in chat before any edit. Default is plan-required.

## Steps

1. Read `.claude/dashboard-spec.md` and the plan file at `.claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md` (most recent if multiple dates exist).
2. Verify the plan's "Decisions" section has been resolved — if any decision is still open in the plan, refuse and ask the user to update the plan or answer the decisions in chat first.
3. Create a worktree at `.claude/worktrees/fix-<slug>` (the `.claude/worktrees/` path is already gitignored). Use:
   ```
   git worktree add .claude/worktrees/fix-<slug> -b claude/fix-<slug>-<YYYY-MM-DD>
   ```
4. From inside that worktree, apply the smallest possible diff consistent with the plan's "Safest fix" section. Touch only the files listed under "Files that would change".
5. Run `npm run build` in the worktree. Capture exit code and output.
6. If the build fails: stop, report, do NOT commit. The worktree stays around so the user can inspect.
7. If the build passes: stage the changed files (only the ones in the plan — never `git add -A`) and create a single commit on the worktree branch with this shape:
   ```
   <prefix>: <plan title, short>

   <2–4 line summary based on the plan>

   Refs: .claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   ```
   Prefix follows Forged convention (`fix:` / `feat:` / `chore:` / `UX:`). The commit lands on the **worktree branch only** — never on `main`.
8. Write a proposal document at `.claude/reports/<YYYY-MM-DD>-fix-proposal-<slug>.md`:
   ```markdown
   # Fix proposal — <title>

   _Plan: [.claude/reports/<YYYY-MM-DD>-fix-plan-<slug>.md](...)_
   _Worktree: `.claude/worktrees/fix-<slug>`_
   _Branch: `claude/fix-<slug>-<YYYY-MM-DD>`_
   _Build: PASS (<duration>, <modules> modules, <bundle-size>)_

   ## Diff summary
   - <path> — +N / −M
   - ...

   ## Full diff
   ```diff
   <output of `git diff main..claude/fix-<slug>-<YYYY-MM-DD>` in the worktree>
   ```

   ## Manual test checklist
   - [ ] <copied from the plan, expanded if needed>
   - ...

   ## To approve and ship
   1. Review the diff above.
   2. Run the manual tests.
   3. If satisfied, from the worktree path:
      ```sh
      git push origin claude/fix-<slug>-<YYYY-MM-DD>
      gh pr create --base main --head claude/fix-<slug>-<YYYY-MM-DD>
      ```
      (or use `FORGED_OVERRIDE_PROTECTED=1 git push origin <branch>:main` if a direct push to main is explicitly approved.)

   ## To discard
   ```sh
   git worktree remove .claude/worktrees/fix-<slug> --force
   git branch -D claude/fix-<slug>-<YYYY-MM-DD>
   ```
   ```
9. Print a short summary to the user: branch name, build status, the location of the proposal doc, and a one-line reminder that nothing has been pushed.

## Hard rules

- **Never** push. **Never** merge. **Never** commit to `main` from this command.
- **Never** edit files outside the worktree.
- **Never** edit files outside the plan's "Files that would change" list.
- **Never** edit:
  - `supabase/migrations/*` (schema is protected — abort and flag)
  - Coach system prompts in `api/chat.js`, `api/coach-summary.js`, `api/coach-intro.js` (personality is protected — abort and flag)
  - Stripe webhook signature handling in `api/stripe-webhook.js`
  - `is_pro` source-of-truth logic
- If `npm install` would be required, **stop** — installing deps is out of scope for L2.
- If `npm run build` fails: stop, do not commit, do not push, do not retry blindly. Diagnose and report.
- If the plan's "Out of scope" list overlaps with anything you'd need to touch, **stop** and ask.

## When the plan is wrong

If during implementation you discover the plan is incomplete or its safest-fix would actually break something, **stop**, do not commit, write a `## Plan-divergence note` section in the proposal doc explaining what you found, and ask the user whether to:
- Update the plan and re-run `/forged-propose-fix`, or
- Override and proceed (requires explicit `proceed despite divergence` from the user).

## Translating audit jargon

Same rule as `/forged-plan-fix`: the proposal doc is read by the founder. Use plain English in the summary; keep technical detail in the diff and the citations.
