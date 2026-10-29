# DevLens evaluation

Scores DevLens's own heuristics against ground truth, before and after the fixes in this folder's commit. The harness
loads DevLens's real modules (`src/scanner.ts`, `src/git.ts`, `src/analyze.ts`) and runs them unchanged; it can point at any
DevLens checkout, so the old and new versions are scored by the same code on the same files.

Every number below comes from `results/` (`before_cb80731.json`, `after.json`, `comparison.json`).

## Corpus

| Set | Repos (pinned in `corpus.json`) | Files | LOC | Commits | Labelled commits |
|---|---|---|---|---|---|
| **dev**: used while fixing the heuristics | axios, commitizen, vite | 1,933 | 158,885 | 14,696 | 8,299 |
| **held-out**: not looked at until the code was final | vuejs/core, semantic-release, python-semantic-release | 765 | 207,962 | 11,322 | 5,508 |
| personal: the author's own repos | 3 repos | 82 | 7,006 | 271 | – |

## Ground truth

- **Test files**: standard naming conventions, relative to the repo root (`test/`, `tests/`, `__tests__/`, `spec/` folders; `test_*.py`,
  `*_test.go`, `*.test.ts`, `*.spec.js`, `*Test.java`, ...). The fixed DevLens path rule uses the same conventions, so its test-file
  score is partly by construction; what it measures is that the content check no longer adds false positives.
- **Error handling**: syntax trees. Python files are parsed with `ast` (`try`/`except`), JS/TS files with the TypeScript compiler
  (`try`/`catch` or a `.catch()` call). Other languages are not scored.
- **Commit type**: [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat`, `fix`, `refactor`, `test`, `docs`).
  The classifier is scored on the description with the prefix removed, since the new version reads the prefix directly when present.

## Results (before = `cb80731`, after = this version)

95% CIs: percentile bootstrap over files/commits (10,000 resamples, seed 42). p-values: exact McNemar test on per-item correctness.

| Metric | Set | Before | After | p |
|---|---|---|---|---|
| Error-handling precision | dev | 47.8% [43.6, 52.1] | **98.1%** [96.2, 99.6] | 5e-82 |
| | held-out | 31.3% [26.3, 36.3] | **95.5%** [91.2, 99.1] | 5e-69 |
| Error-handling F1 (recall 100% in all runs) | dev | 64.7% | **99.0%** | |
| | held-out | 47.6% | **97.7%** | |
| Test-file precision (recall 100% in all runs) | dev | 81.5% | 100% | 3e-42 |
| | held-out | 78.7% | **96.8%** [94.9, 98.4] | 1e-26 |
| Commit type, prefix removed: accuracy | dev | 29.3% | 43.9% | 3e-134 |
| | held-out | 36.7% | **52.1%** [50.8, 53.4] | 1e-90 |
| Commit type, prefix removed: macro-F1 | held-out | 38.0% | **48.0%** | |
| Commits parsed (default settings) | dev | 4,850 | **14,696** (all) | |
| | held-out | 4,085 | **11,322** (all) | |

- Error-handling rate reported by DevLens vs the truth (held-out): 44.3% before, 14.5% after, true rate 13.9%.
- The commit classifier is still a keyword heuristic. On held-out data it now **ties** always guessing "bugfix" on accuracy
  (52.1% vs 52.3%) and beats it on macro-F1 (48.0% vs 13.7%), because the majority guess never predicts the other four types.
- Path robustness: scanning the same repo through a parent folder named `latest-projects` flagged 13/13 files as tests before
  (9/13 from its real path); after, 4/13 from both paths.
- Personal repos: test-file precision 30.8% → 80.0%, error-handling precision 59.3% → 88.9%.

### Performance (after; median of 3 scans; Intel Core Ultra 7 155H, warm file cache)

| Set | Scan | Files/s | LOC/s | Full git history |
|---|---|---|---|---|
| dev | 975 ms | 1,982 | 162,942 | 14,696 commits in 11.0 s |
| held-out | 617 ms | 1,239 | 336,784 | 11,322 commits in 7.6 s |

### LLM report (llama3 8B via Ollama, RTX 4070 Laptop GPU, personal repos, 3 runs)

- 12.9 s and 13.5 s per report with the model loaded; 24.7 s on the first run, which included 9.2 s of model loading. 49 tokens/s.
- Grounding: 57 of 60 numbers in the reports (95.0%) appear in the data DevLens gave the model or are correct percentages of it.
  This checks values, not attribution: a correct number attached to the wrong language still passes.

## Bugs fixed

1. `git log` ran through `execSync` with Node's 1 MB default buffer; larger histories failed silently and reported 0 commits.
2. The test check matched "test" anywhere in the absolute path, so a parent folder like `latest-projects` made every file a test.
3. `/describe\(|it\(/` matched `split(`, `exit(`, `init(`.
4. `/try|...|error/` matched `entry`, `retry`, `country` and any identifier containing "error".
5. "deletions > 0.6 × additions → refactoring" overrode keywords; most such commits were fixes or docs edits.
6. The report renderer ignored `*` bullets and `#` headings, wrapped everything between the first and last bullet in one list, and
   did not escape HTML.

Each has a regression test in `tests/` that fails on `cb80731` and passes now.

## Rerun

Needs Node 20+, git, and Python 3 (for `py_try.py`). Ollama with `llama3` only for `--llm-runs`.

```bash
node eval/setup_corpus.js                                    # clones the 6 repos into eval/corpus at pinned commits
git worktree add ../devlens-before cb80731                   # the old version, for comparison
node eval/bench.js --corpus=eval/corpus --devlens=../devlens-before --out=eval/results/before_cb80731.json
node eval/bench.js --corpus=eval/corpus --personal=<your projects folder> --llm-runs=3 --out=eval/results/after.json
node eval/compare.js eval/results/before_cb80731.json eval/results/after.json
```

The old checkout needs `node_modules`: run `npm install` in it, or link it to this repo's.

## Limitations

- Ground truth is itself a convention (test files) or a narrow definition (error handling = `try`/`catch`/`.catch()`); Go/Rust/Java
  error handling is detected by DevLens but not scored.
- Commit labels are the authors' own prefixes. Six repos, mostly JS/TS tooling, with uneven class sizes.
- Timing is from one laptop and varies run to run (the dev scan took 0.79–0.98 s across runs today).
