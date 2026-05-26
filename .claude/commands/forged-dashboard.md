---
description: Aggregate recent Forged audit reports into one founder-friendly dashboard.md. Read-only, no audits re-run.
---

You are generating the **Forged Builder Dashboard**. **Tier L1: read-only.**

This command does NOT re-run audits. It only aggregates what's already in `.claude/reports/`.

Output file: `.claude/reports/dashboard.md` (overwrite).

The dashboard is a **builder's command centre**, not a technical report. It should be scannable in 30 seconds. Plain English first, technical detail second. Read [`.claude/dashboard-spec.md`](../dashboard-spec.md) at the start of every run — it's authoritative for both the audit input contract and the dashboard output contract.

## Inputs

1. Every file in `.claude/reports/` whose name matches `YYYY-MM-DD-<slug>.md` where `<slug>` is one of: `ux-audit`, `product-audit`, `bug-risk`, `mobile-pwa`, `marketing`, `retention`, `tech-debt`, `daily`. Ignore `dashboard.md` itself, `.gitkeep`, and anything starting with `_`.
2. `git log --since="7 days ago" --no-merges --pretty="%h %s"`.
3. The contents of the **most recent** `*-marketing.md` file, if any.

## Steps

1. List `.claude/reports/` and filter to the input set above.
2. For each report, read it and extract:
   - The date (from filename).
   - The audit slug (from filename).
   - The `Risk: <L|M|H>` line (literal match).
   - The `One-line headline: <text>` line (literal match).
   - The bullet items under any `## Suggested *` heading (keep at most 4 per report — you'll cherry-pick the best later).
3. Group reports by slug. Keep only the **most recent** report per slug for the main dashboard. Older same-slug reports go in the collapsed older-reports section at the bottom.
4. Compute:
   - **Overall risk** = highest individual `Risk:` across the latest report per slug. H > M > L. None = `—`.
   - **Audits in last 7 days** = count of (slug × date) pairs within the last 7 calendar days.
   - **Last full daily sweep** = most recent `*-daily.md` date, or `never`.
5. From `git log`:
   - Count total commits.
   - Pull out 3–5 notable shipped changes — features, fixes that affect users, polish that matters. Not internal refactors. Write them in plain English.
6. From the most recent `*-marketing.md`:
   - Extract verbatim the three social drafts + changelog entry + IG caption under "## Drafts (review, do NOT post)".
   - If no marketing report exists, the section reads `_No marketing drafts on file — run /forged-marketing-audit_`.

## Translating audit jargon

This is the single biggest improvement over a raw audit dump. When writing dashboard bullets, translate:

| Audit phrase | Dashboard phrase |
| ------------ | ---------------- |
| "Bearer token extraction duplicated across 10 routes" | "auth boilerplate is copy-pasted across 10 API files" |
| "`api/onboard-chat.js` has no Bearer check" | "the onboarding chat endpoint accepts anonymous calls — anyone can spend your Anthropic budget" |
| "`minHeight:"100vh"` on 11 shell containers" | "11 screens use the wrong viewport unit for iOS — keyboard + URL bar will overlap" |
| "withSentry name missing on journal-generate" | "Sentry errors from the journal route won't be tagged correctly" |
| "AGENTS.md says 10/day, code enforces 3/day" | "the agent doc and the live quota disagree" |
| "`src/utils.js` already has the dates/streaks/push helpers" | "the App.jsx split plan in the doc is out of date — most of it's already done" |

Always prefer the right-hand column on the dashboard. Keep the technical phrasing in the linked report.

## Output format

Write exactly this structure to `.claude/reports/dashboard.md`:

```markdown
# Forged Builder Dashboard

_Refreshed: <local ISO datetime>_
_Overall risk: <L | M | H | —>_  · _Last daily sweep: <YYYY-MM-DD | never>_ · _Audits this week: <N>_ · _Commits this week: <N>_

## Today's Readout
- <plain-English overall-risk sentence — "calm week" / "watch a couple of things" / "act today">
- <one sentence on what shipped this week>
- <one sentence on the biggest risk>
- <one sentence on the best quick win>
- <one sentence on the best product/marketing opportunity>
- <one sentence on what to focus on next session>

## 🔥 Do First

> Three highest-leverage next actions. Nothing has been applied.

1. **<Plain-English title — no filenames in the title>** · `<H|M|L>`
   _Why it matters:_ <one sentence>
   _Suggested action:_ <one sentence>
   _Source:_ [<slug>](.claude/reports/<filename>)
2. ...
3. ...

## ⚡ Quick Wins

Small safe changes. Tag tells you the blast radius.

- **<title>** — <one sentence> · _safe doc/copy_ — [source](.claude/reports/<filename>)
- **<title>** — <one sentence> · _safe code_ — [source](.claude/reports/<filename>)
- **<title>** — <one sentence> · _needs care_ — [source](.claude/reports/<filename>)
- ...

(Max 5 items.)

## 🛡 Risks To Watch

> Grouped by area. Plain English first, technical detail in parens.

**Security / auth / cost**
- <bullet> — [source](.claude/reports/<filename>)

**Product / retention**
- <bullet> — [source](.claude/reports/<filename>)

**Mobile / PWA**
- <bullet> — [source](.claude/reports/<filename>)

**Tech debt**
- <bullet> — [source](.claude/reports/<filename>)

(Omit any group with no items.)

## 🧠 Product Signals

> Observations that affect the roadmap, not the codebase.

- <observation + implication> — [source](.claude/reports/<filename>)
- ...

## 📣 Content Ideas

_Drafts from the latest marketing audit. Sign off before posting._

### Social post 1
<verbatim>

### Social post 2
<verbatim>

### Social post 3
<verbatim>

### Changelog entry
<verbatim>

### IG caption
<verbatim>

## Recent Changes

**<N>** commits this week. Highlights:
- <plain-English bullet>
- <plain-English bullet>
- <plain-English bullet>

_Full list: [latest daily report](.claude/reports/<latest-daily-filename>)._

## 🧾 Audit Reports

| Audit | Date | Risk | Headline | Link |
| ----- | ---- | ---- | -------- | ---- |
| <one row per slug, most recent only>

<details><summary>Older reports — click to expand</summary>

| Audit | Date | Risk | Headline | Link |
| ----- | ---- | ---- | -------- | ---- |
| ...

</details>

---

_Spec: [.claude/dashboard-spec.md](.claude/dashboard-spec.md). Generated by `/forged-dashboard` — re-run, don't hand-edit._
```

## How to choose what goes where

- **🔥 Do First** — pick 3 across **all** audits. Cap at H risk if any exist; otherwise the highest-leverage M items. Each must combine real impact with a clear next step. **Never** more than 3 — being selective is the point.
- **⚡ Quick Wins** — small, safe, mechanical. Tagging rule:
  - **safe doc/copy** — touches only Markdown / comments / copy strings.
  - **safe code** — mechanical find-and-replace, single-file config, or a one-line addition with a known-good pattern (e.g. matching an existing header block).
  - **needs care** — straightforward but warrants a quick review (e.g. adding an auth helper that 10 files will use).
- **🛡 Risks To Watch** — everything M+ that didn't make Do First, plus L items worth knowing about. Group by area. Keep bullets short — link to the report for detail.
- **🧠 Product Signals** — pull from retention / product / marketing audits. Roadmap-shaping observations, not bugs. Example: "Half the user base has never logged a habit — funnel leak between onboarding and first tap" is a signal. "`100vh` on shell containers" is not.
- **📣 Content Ideas** — copy verbatim. Don't editorialise the drafts on the dashboard. If the marketing audit said "do NOT post", that suffix can be dropped on the dashboard since the section header already says "Sign off before posting."
- **Recent Changes** — 3–5 highlight bullets, founder-readable. Skip merge commits, lint sweeps, deps. If a week was dominated by one theme (e.g. "five iOS mic fixes"), say so as one bullet instead of listing each.

## Rules

- **Do not run any audit.** This command aggregates only.
- **Do not modify app source.**
- **Do not push or commit.** Writing `dashboard.md` is the only file write.
- Stay under **350 lines** in the output. If you'd exceed it, collapse more reports into the older-reports `<details>` block and trim the "Risks To Watch" bullets first.
- Cite report paths exactly as `.claude/reports/<filename>` so the user's editor opens them.
- Audit reports themselves stay technical and detailed — the dashboard is only the top layer. Do not edit the underlying reports.
