# Eval: nvidia/nemotron-3.5-super-vl:free

- Original run date: 2026-11-19 (runs: run_20261119T181336_623a, run_20261119T181419_9095, run_20261119T181453_9807)
- Re-scored from stored outputs on 2026-11-20 with the current expected answers and scoring (no model calls)
- Model: nvidia/nemotron-3.5-super-vl:free
- Prompt: extract-tasks v2
- Cases: launch-sync, ops-review-gujarati, vendor-call-ambiguous (one run each)
- Dev case (not held out; the prompt was built against it): launch-sync. The other cases are held out.

| case | set | tasks found/expected | extras | parked leaks | owner | due | goal | deps | flag | total |
|---|---|---|---|---|---|---|---|---|---|---|
| launch-sync | dev | 5/5 | 0 | 0 | 5/5 | 5/5 | 4/4 | 5/5 | - | 19/19 |
| ops-review-gujarati | held out | 4/4 | 0 | 0 | 4/4 | 4/4 | 4/4 | 4/4 | - | 16/16 |
| vendor-call-ambiguous | held out | 4/4 | 0 | 0 | 4/4 | 4/4 | 4/4 | 4/4 | 0/1 | 16/17 |

Held out (2 cases): tasks found 8/8, fields correct 32/33 (97%), extras 0, parked leaks 0

All cases (3 cases): tasks found 13/13, fields correct 51/52 (98%), extras 0, parked leaks 0

## Misses

- vendor-call-ambiguous / quote: flag expected a flag containing "matches more than one" got "AI found no owner. Check the note"

## Extra tasks

None.
