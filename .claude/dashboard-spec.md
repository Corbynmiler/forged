# Forged dashboard spec

Single source of truth for the audit-report contract that `/forged-dashboard` parses, **and** for the layout of the generated `dashboard.md`.

Two halves:
- **Input contract** — what every audit report must contain so the dashboard can read it.
- **Output contract** — what `dashboard.md` must look like so it's actually useful to a founder.

If a future audit command or the dashboard command drifts from this file, fix the command, not the spec.

---

## Part 1 — Input contract (audit reports)

### File naming

Every audit report writes to:

```
.claude/reports/<YYYY-MM-DD>-<audit-slug>.md
```

Where `<audit-slug>` is one of:

| Slug         | Produced by                  |
| ------------ | ---------------------------- |
| `ux-audit`   | `/forged-ux-audit`           |
| `product-audit` | `/forged-product-audit`   |
| `bug-risk`   | `/forged-bug-risk-audit`     |
| `mobile-pwa` | `/forged-mobile-pwa-audit`   |
| `marketing`  | `/forged-marketing-audit`    |
| `retention`  | `/forged-retention-audit`    |
| `tech-debt`  | `/forged-tech-debt-audit`    |
| `daily`      | `/forged-daily`              |

Files outside this naming pattern are ignored by the dashboard.

### Required headings

Every audit report MUST contain these three lines, in this order, near the top:

```
# Forged <human name> audit — <date>

Risk: <L|M|H>
One-line headline: <text under ~100 chars>
```

The dashboard parser uses literal string matching on `Risk:` and `One-line headline:`. Do not abbreviate, do not bold, do not use a different colon style.

### Risk rubric

- **L** — informational. Read when convenient. No action required this week.
- **M** — should look at this week. Not breaking anything, but accumulating cost / debt / drift.
- **H** — look at this today. User-visible bug, cost regression, broken invariant, or safety issue.

If an audit produces multiple findings of mixed severity, the report's overall `Risk:` is the highest individual finding.

### Suggested-action sections

Each audit ends with a section whose heading starts with `## Suggested` and contains a bulleted list. Recognised forms:

- `## Suggested fixes (do NOT apply)`
- `## Suggested actions (do NOT apply)`
- `## Suggested next moves (do NOT apply)`

The "(do NOT apply)" suffix is mandatory on L1 audits — it reminds the running session that nothing under this heading is autonomous.

---

## Part 2 — Output contract (`dashboard.md`)

The dashboard is a **builder's command centre**, not a technical report. A founder should be able to open it in 30 seconds and know what to do next.

### Writing style

- Plain English first, technical detail second.
- Short bullets. No long paragraphs.
- Avoid scary phrasing unless something genuinely needs action today.
- Translate audit jargon ("Bearer token extraction duplication") into builder-speak ("the auth helper across API routes is copy-pasted").
- Each section uses a single emoji label (see below). Don't sprinkle emoji elsewhere.
- Stay under 350 lines total — collapse if needed.

### Section labels

| Emoji | Section | Purpose |
| ----- | ------- | ------- |
| _(none)_ | Today's Readout | 30-second summary, 4–6 bullets |
| 🔥 | Do First | Max 3 highest-leverage actions |
| ⚡ | Quick Wins | Max 5 safe, small changes |
| 🛡 | Risks To Watch | Grouped by category — Security/auth/cost, Product/retention, Mobile/PWA, Tech debt |
| 🧠 | Product Signals | Retention, feature gaps, positioning, roadmap signals |
| 📣 | Content Ideas | Drafts, easy to copy, founder voice |
| 🧾 | Audit Reports | Reference table — at the bottom, not the main view |

### Required structure

`dashboard.md` MUST contain these H2 sections in this order:

1. `## Today's Readout`
2. `## 🔥 Do First`
3. `## ⚡ Quick Wins`
4. `## 🛡 Risks To Watch`
5. `## 🧠 Product Signals`
6. `## 📣 Content Ideas`
7. `## Recent Changes`
8. `## 🧾 Audit Reports`

A header block precedes section 1 with: refresh timestamp, overall risk, last full daily sweep, audits run in the last 7 days, commits in the last 7 days.

### Per-section rules

**Today's Readout** — 4–6 bullets, no sub-bullets. Cover:
- overall risk (in plain language — "calm week" / "watch a couple of things" / "act today")
- what changed in the last 7 days (one sentence)
- biggest risk (one sentence)
- best quick win (one sentence)
- best product/marketing opportunity (one sentence)
- suggested focus for next session (one sentence)

**🔥 Do First** — exactly **up to 3** items. Each item:
- Plain-English one-line title (no API filenames in the title)
- _Why it matters_ (one sentence, founder-level)
- _Suggested action_ (one sentence)
- Risk badge (`H` / `M` / `L`)
- Link to source report

**⚡ Quick Wins** — up to **5** items. Tag each item with exactly one of:
- **safe doc/copy** — text-only edits
- **safe code** — mechanical, low-blast-radius change
- **needs care** — straightforward but warrants a quick review

Each is one line: title, what it does, tag, source link.

**🛡 Risks To Watch** — group by these four buckets; omit empty buckets. Each item is one bullet, plain English first, technical detail in parens or after an em dash. Link to source report at the end.
- _Security / auth / cost_
- _Product / retention_
- _Mobile / PWA_
- _Tech debt_

**🧠 Product Signals** — bullets that affect the roadmap, not the codebase. Drawn primarily from product / retention / marketing audits. Each bullet: one short observation + the implication.

**📣 Content Ideas** — extract verbatim from the most recent `*-marketing.md`'s "Drafts" section. Three social posts, one changelog, one IG caption. Surrounded by a single instruction sentence ("Sign off before posting."). No audit framing around the drafts themselves — they should be copy-paste ready.

**Recent Changes** — short. Commits count + 3–5 highlight bullets in plain English. Not the raw `git log`. If there are more than 5 notable shippings, link to `/forged-daily` for the full breakdown.

**🧾 Audit Reports** — compact reference table at the bottom: one row per slug, most recent only, with date, risk, plain-English headline, link. Older reports collapsed in `<details>`.

### Edge cases

- **No reports exist yet.** Write a minimal dashboard that says so plus the available audit commands. Don't fail.
- **A report is missing `Risk:` or `One-line headline:`.** Mark it `Risk: ?` and `Headline: (missing — re-run the audit)`. Do not invent content.
- **Git log fails** (shallow clone). Write `_git log unavailable_` in Recent Changes and continue.
- **No marketing report.** Content Ideas section reads `_No marketing drafts on file — run /forged-marketing-audit_`.
- **No H findings anywhere.** Today's Readout phrases overall risk as "calm" / "watch a couple of things". Do First can still surface the top 3 M findings if H is empty.

### Inputs / outputs

`/forged-dashboard`:
- READS: every file in `.claude/reports/` matching the naming pattern above.
- READS: `git log --since="7 days ago" --no-merges --pretty="%h %s"`.
- READS: the most recent `*-marketing.md`.
- WRITES: a single file at `.claude/reports/dashboard.md`.
- DOES NOT write anywhere else, modify app code, push, or commit.

The dashboard file is tracked in git (per `.gitignore`). Individual reports remain gitignored.
