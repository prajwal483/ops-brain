# Ops Brain — Just Sortd take-home (PRD 1)

Ops Brain turns meeting decisions into owned, dated, dependency-linked work. This repo holds the submission for **PRD 1 — Ops Brain**.

| | |
|---|---|
| **Build plan (one page)** | [build-plan/ops-brain-build-plan.pdf](build-plan/ops-brain-build-plan.pdf) (Markdown: [ops-brain-build-plan.md](build-plan/ops-brain-build-plan.md)) |
| **Working demo** | [ops-brain-demo/](ops-brain-demo/): a meeting note becomes *Proposed* tasks with owners, dates, goal links and dependencies |
| **Accuracy eval** | [ops-brain-demo/eval/results/](ops-brain-demo/eval/results/): 32/33 fields right on 2 held-out notes (two free models) |
| **Sample real run** | [ops-brain-demo/examples/sample-run-free-model.txt](ops-brain-demo/examples/sample-run-free-model.txt) |

## What the demo proves

The take-home asks to *"turn one sample meeting note into structured tasks your system could use, including owners, dates, goal links and dependencies."* The riskiest part is getting that right from messy Hindi/Gujarati/English notes without guessing:

- The AI only **proposes**. Every task starts as `Proposed`, and anything doubtful becomes a review flag: no owner, an ambiguous owner, an impossible date, a quote not in the note, a dependency due later, a cycle.
- **Model-agnostic:** any model through OpenRouter. The prompt and model routes are versioned config files.
- **Every run is logged** with its prompt version, model, tokens and cost. Approved / edited / rejected is recorded per task.
- **Failures are explained in plain language** and point to a runbook entry. Re-running the same note is refused, so no duplicate tasks get created.

## Quick start

Needs Node ≥ 20.12 and a free [OpenRouter](https://openrouter.ai/keys) key.

```bash
cd ops-brain-demo
npm install
cp -n .env.example .env        # paste your OpenRouter key into .env
npm test                        # 107 tests, no network
npm run extract -- --note fixtures/meeting-2026-11-17-launch-sync.md --context fixtures/context.json
```

See [ops-brain-demo/README.md](ops-brain-demo/README.md) for the review command, the eval, the Notion option, the runbook, and what is planned for v1 but not built in the demo.

## Sample data

All meeting notes, names and companies are made up. There is no real or private data.
