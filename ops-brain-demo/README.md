# Ops Brain demo: meeting note → proposed tasks

Turns one meeting note into tasks with owner, due date, goal link and dependencies. Every task is *Proposed*: a person approves it before anyone is assigned work. All sample data is fictional.

## Run it

```bash
npm install
cp -n .env.example .env   # (won't overwrite an existing .env) then paste your OpenRouter key into .env
npm run extract -- --note fixtures/meeting-2026-11-17-launch-sync.md --context fixtures/context.json
```

`.env` is optional. The CLI loads it if it exists; otherwise set the variables in your shell. Only `OPENROUTER_API_KEY` is needed for a run without `--notion`.

**Guided walkthrough:** `npm run demo` runs every step in order (note → tasks with a live timer while the model thinks → duplicate rerun refused → you approve, edit or reject the flagged tasks → approval rate → run log), pausing for Enter between steps.

Add `--notion` to also create the tasks in a test Notion Tasks database (see below).

- Output: `out/<runId>.json`
- Run log (prompt version, model, tokens, cost): `runs/runs.jsonl`. Its `reviewStatus` always stays `pending`; review outcomes are recorded in `runs/reviews.jsonl`, keyed by run id, via `npm run review` (see below).
- Change the prompt: edit `config/prompts/extract-tasks.md` and bump `version`
- Change the model: edit `config/models.json`

### Which model

By default it uses a **free** model, `nvidia/nemotron-3.5-super-vl:free`. You need a free OpenRouter account and key, but no credit. Free models have daily request limits, and their providers may log prompts, so only send fictional or non-sensitive notes. For production quality, use the paid route. `extract_tasks_paid` in `config/models.json` is a reference entry that nothing reads; to switch, copy its values (`anthropic/claude-haiku-5.5`, about $0.10 / $0.50 per million tokens) into `extract_tasks`. A run costs a fraction of a cent. The free Nemotron model "thinks" before answering: the sample run used about 5.5k output tokens for a 750-token note, so expect tens of seconds per run on the free tier. Free models come and go; to see which are live, open https://openrouter.ai/models?max_price=0.

## Accuracy eval

```bash
npm run eval                                   # all cases, model from config/models.json
npm run eval -- --model google/gemma-4-31b-it:free   # try another OpenRouter model
npm run eval -- --case launch-sync             # one case (no report written)
npm run eval -- --rescore                      # re-score stored outputs, no model calls
```

Three fictional notes live in `eval/cases/<name>/` (`note.md`, `context.json`, `expected.json`): `launch-sync` (Hinglish), `ops-review-gujarati` (Gujarati script + Hinglish + English) and `vendor-call-ambiguous` (two people called Priya, an impossible date, an idea that must not become a task). The eval runs the real pipeline and scores the resulting tasks in `src/eval.ts`. A predicted task matches an expected one when its title contains all of the expected keywords. It scores:

- **Tasks found**: expected tasks matched to a predicted task.
- **Fields**: owner, due date, goal, and dependencies (compared as sets). Fields marked `"any"` in `expected.json` are not scored; a field can also list several acceptable answers (e.g. `["G1", "G2", null]`, or a list of acceptable dependency sets) where the note genuinely allows more than one reading. A task can also carry `expectFlag`, a review flag it must get (e.g. the ambiguous "Priya" must be flagged as matching more than one person); it is scored as one more field. A missed task's scored fields all count as wrong.
- **Matching**: when several predicted titles contain an expected task's keywords, the one with the most correct fields is used (ties go to the earlier title); `not` keywords keep overlapping tasks apart.
- **Extras**: predicted tasks that match no expected task. **Parked leaks**: parked or idea-only items that became tasks.

Each run writes a report to `eval/results/`; raw runs go to `eval/runs.jsonl` and `eval/out/` (git-ignored). `--rescore` takes each model's latest successful stored run per case (matched by the note's SHA-256), scores it again with the current expected answers, and rewrites the reports without calling any model.

**Held out vs dev.** `launch-sync` is a dev case, marked `"dev": true`: it is byte-identical to `fixtures/meeting-2026-11-17-launch-sync.md`, prompt v2 was built against that note, and a real run on it was committed (`examples/sample-run-free-model.txt`) before the eval existed. Only `ops-review-gujarati` and `vendor-call-ambiguous` are held out. Reports give held-out and all-case totals separately; quote the held-out figure.

| Model | Held out (2 notes): tasks found · fields right · extras | All 3 notes: tasks found · fields right · extras | Parked leaks | Report |
|---|---|---|---|---|
| nvidia/nemotron-3.5-super-vl:free (shipped default) | 8/8 · 32/33 · 0 | 13/13 · 51/52 · 0 | 0 | [report](eval/results/nvidia_nemotron-3.5-super-vl_free.md) |
| baidu/ernie-5.5-flash-preview:free | 8/8 · 32/33 · 0 | 13/13 · 51/52 · 1 | 0 | [report](eval/results/baidu_ernie-5.5-flash-preview_free.md) |

Both runs are from 2026-11-19 and were re-scored from the stored outputs on 2026-11-20 after the scoring fixes (alternative answers, best-match, missed tasks counted, `expectFlag`). The one held-out miss for both models is the same: neither returned the ambiguous "Priya" as an owner name, so the task got the generic "AI found no owner" flag instead of "matches more than one team member".

Caveats: one run per model on 2 held-out notes (33 scored fields) is a small sample, so a point or two is noise, and the two models can't be told apart on it. The paid Haiku route (`anthropic/claude-haiku-5.5`) was not evaluated because the account has no credit. `google/gemma-4-31b-it:free` was tried but stayed rate-limited (429), so Ernie was used instead. The expected answers are the author's reading of each note. The two held-out cases were written before seeing any model output on them, and the prompt was not tuned to them. After the first runs, one held-out answer was loosened because its bullet names no goal: the courier SLA task's goal may be G1 or null (null gets flagged). That change was made after seeing Ernie answer null, and it raised Ernie's held-out score by one field. `launch-sync` is not held out (see above).

## Record the review

```bash
npm run review -- --run last --approve all          # "last" = the most recent run
npm run review -- --run <runId> --approve all
npm run review -- --run <runId> --approve T1,T4 --reject T2 --edit T3:due=2026-12-12,owner=aditya --reviewer sam
npm run review -- --stats
```

Every task in the run needs a decision (`--approve`, `--edit` or `--reject`); editable fields are `title`, `owner`, `due`, `goal`, `dependsOn`. Reviews go to `runs/reviews.jsonl`, and re-reviewing a run replaces its earlier review. In v1 this happens automatically when a person approves, edits or rejects in Notion and Slack; the CLI stands in for that in the demo. `--stats` is how the "80% of AI-extracted tasks approved without edits" metric is measured.

## Notion test database

Create a database called **Tasks (test)** with these properties: `Name` (title), `Status` (select with option `Proposed`), `Owner` (person), `Due` (date), `Goal` (relation to a **Goals (test)** database), `Blocked by` (relation to Tasks (test) itself), `AI notes` (text), `Run ID` (text).

Create an internal integration called "Ops Brain" at https://www.notion.so/my-integrations. Add it to both databases (••• → Connections), then put `NOTION_TOKEN` and `NOTION_TASKS_DB_ID` in `.env`. To fill Owner and Goal, add `notionUserId` to each team member and `notionPageId` to each goal in `fixtures/context.json`. Also add `notionPageId` to existing tasks (such as `TASK-101`) so "Blocked by" can link to them; without it, the task's AI notes say "Couldn't link TASK-xxx in Notion (no page id); link it by hand".

## Runbook

| Message mentions | What to do |
|---|---|
| **Setup** | Copy `.env.example` to `.env` and fill in the value the message names. Get an OpenRouter key at https://openrouter.ai/keys |
| **AI key rejected** | Open https://openrouter.ai/keys, create a new key, paste it into `.env` as `OPENROUTER_API_KEY`. |
| **Out of credit** | Wait 5 minutes and retry. If it repeats, add credit at https://openrouter.ai/credits. |
| **AI provider down** | Retry in 10 minutes. If it keeps failing, change `model` in `config/models.json` to another model on openrouter.ai/models. |
| **Bad AI answer** | Retry once. If it fails again, split the note into two shorter notes. If it keeps happening, tell the system owner. The last prompt change may have broken it; roll back: restore the previous prompt with `git checkout HEAD~1 -- config/prompts/extract-tasks.md` (or paste back the old text) and set its version back. |
| **Notion access** | In Notion, open the Tasks database → ••• → Connections → add "Ops Brain". Check `NOTION_TASKS_DB_ID` is the database's id from its URL. Check the property names and types match the list under 'Notion test database'. |

**Re-running a note:** if the exact same note text has already produced tasks, `npm run extract` refuses and names the earlier run, so you don't get duplicate Proposed tasks. Add `--force` to run it anyway (for example after changing the prompt).

## Not in this demo (planned for v1)

The demo covers the riskiest piece: turning a note into checked, Proposed tasks. These parts of the v1 plan ([`../build-plan/ops-brain-build-plan.pdf`](../build-plan/ops-brain-build-plan.pdf)) are designed but not built:

- **Approval in Notion and Slack.** In the demo a person approves with `npm run review`; in v1 they approve with one tap in Slack or by changing Status in Notion. Nothing here sends anything to Slack except failure alerts.
- **Slip forecasting, Slack check-ins, the priority score and goal health.**
- **Retries with backoff and a fallback model.** The demo retries once only when the AI's answer is malformed.
- **Rerun protection keyed on the Notion meeting page, plus a "delete this run's proposals" button.** The demo checks the note text only; every task carries its Run ID so a bad run can be found.
- **Prompts as versioned Notion pages, and run logs in a Notion "AI Runs" database.** The demo keeps both as local files.
