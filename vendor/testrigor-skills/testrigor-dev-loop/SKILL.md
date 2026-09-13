---
name: testrigor-dev-loop
description: End-to-end playbook for developing testRigor tests as code with the CLI — build test cases and reusable rules as local files, run them against a local app via the testRigor tunnel, debug from the JUnit report and exit code, and update the remote suite simply by re-running (file mutations). Use this when the goal is to author, run, debug, and iterate on testRigor tests from a repo/terminal (not the web UI). Pulls in `testrigor-write-tests` for the language, `testrigor-cli` for flag details, and its `api-testing.md` for API steps. Two complete runnable example projects ship in `examples/`, documented in `examples.md`.
---

# testRigor dev loop (tests as code)

A repeatable loop for building testRigor tests **from a repo**, driving them with the `testrigor` CLI, and iterating until green. This skill is the **orchestration layer** — it sequences the others and links out for detail rather than repeating them:

- **`testrigor-write-tests`** — the plain-English language and the on-disk file formats (`.txt`/`.yaml` test cases, reusable rules, `variables.json`). API steps live in its `api-testing.md`.
- **`testrigor-cli`** — every CLI flag, auth, and mechanic in detail.

**Two complete runnable example projects ship with this skill** — read [examples.md](examples.md) and copy the closest one (`examples/simple-search` for the basic loop, `examples/shop-checkout` for the localhost tunnel + labels/variables/negative tests) as your starting template.

## The one mental model that matters

There is **no separate "deploy" step.** When you run with `--test-cases-path` / `--rules-path`, the CLI parses those local files and sends them to testRigor as part of triggering the run. So **running = push your files into the remote suite + execute them.** Your local files are the source of truth; the remote suite is updated to match on every run. (Identity is by filename, or by `testCaseUuid` in a `.yaml` — see `testrigor-cli` → "Updating the suite by running".)

**Use one suite per app / environment.** A run applies a single `--url` to *every* test in the suite, and `--explicit-mutations` syncs the suite to exactly your files. So give each app under test its own dedicated suite — don't mix tests for different sites in one suite. Create the suite once in the UI; point the CLI at it via `--default`.

## The loop

```
edit files  →  run (localhost, --test-cases-path/--rules-path)  →  exit code + report.xml
     ▲                                                                      │
     └──────────────────── fix failing steps ◀──────────────────────────────┘
```

Stop when the exit code is `0` and `report.xml` shows no failures.

## 0. One-time setup

Authenticate non-interactively (required for an agent loop) and pick a suite. Full auth details — including why a human may run `testrigor authenticate` once but an agent must not — are in `testrigor-cli` → "Authentication".

```bash
export TESTRIGOR_API_KEY="<YOUR_PAT>"          # app → username (top-right) → API Tokens
export SUITE="<TEST_SUITE_ID>"                 # from the suite's URL
testrigor test-suite config --default "$SUITE" # optional: lets you omit the ID
testrigor --version                            # sanity check
```

## 1. Build — write tests and rules as files

Lay the repo out like this (keep filenames stable — they are the test/rule names):

```
testrigor/
├── test-cases/
│   ├── login.txt
│   └── checkout/place-order.txt
├── rules/
│   ├── login.txt              # reusable rule, invoked by writing `login` in a test
│   └── add-to-cart.txt
├── variables.json             # { "username": "...", "plan": "Pro" }  → stored values
└── settings.yaml              # optional suite settings
```

Write the steps with **`testrigor-write-tests`** — it owns the language and the exact on-disk schema (`.txt` vs `.yaml`, labels, datasets, `testCaseUuid`, reusable-rule and variables files). A test invokes a reusable rule by writing the rule's **filename** as a step (a `login` step runs `rules/login.txt`). For `call api` steps see that skill's `api-testing.md`.

## 2. Run against localhost (with the tunnel)

Start your local app first, then run. `--localhost` spins up the testRigor tunnel so the cloud browsers can reach your machine; `--url` points at the local app. Serve the **same web root the deployed site uses**, so a page lives at the same path locally and in prod.

```bash
mkdir -p testrigor/.run
testrigor test-suite run "$SUITE" \
  --localhost --url "http://localhost:3000" \
  --test-cases-path "testrigor/test-cases/**/*.{txt,yaml,yml}" \
  --rules-path "testrigor/rules/**/*.{txt,yaml,yml}" \
  --variables-path testrigor/variables.json \
  --explicit-mutations \
  --junit-report-save-path testrigor/.run/report.xml
```

This one command pushes the files (updating the suite) **and** runs them against your local app. Quote the globs so the CLI expands them, not the shell. Tunnel mechanics and every flag are in `testrigor-cli`.

Iterate fast on a single failing test (skip the full suite):

```bash
testrigor test-suite run "$SUITE" --localhost \
  --url "http://localhost:3000" --test-case-uuid "<TEST_CASE_UUID>"
```

## 3. Debug — read the signals

The CLI runs synchronously (don't pass `--async` while debugging) and gives you the **exit code** (`0` = all passed), the **JUnit report** (which `<testcase>` has a `<failure>` and its message), and the printed **run URL** (step-level screenshots/video for a human). How to parse the report and the run-status codes are in `testrigor-cli` → "Reading results / debugging a run".

```bash
grep -A2 '<failure' testrigor/.run/report.xml      # quick look at failures + reason
```

Then fix the offending `.txt`/`.yaml` file and go back to step 2. Because re-running re-pushes the files, your fix updates the remote test automatically.

> **Cheap pre-check (runs take minutes).** After changing the app or a test, `grep` the page for the exact text and controls your tests assert before burning a full run — `grep -F "Thank you for your purchase!" end.html`. Catching a renamed label or a removed button statically is far faster than waiting on the cloud run.

## 4. "Update remote" is just re-running

There is nothing else to do. Editing files and re-running step 2 updates the matching remote tests/rules. To run the now-updated suite against the **deployed** site, drop `--localhost` and point `--url` at the real environment (or omit `--url` to use the suite's configured URL):

```bash
testrigor test-suite run "$SUITE" \
  --test-cases-path "testrigor/test-cases/**/*.{txt,yaml,yml}" \
  --rules-path "testrigor/rules/**/*.{txt,yaml,yml}" \
  --explicit-mutations \
  --labels smoke \
  --junit-report-save-path testrigor/.run/report.xml
```

## Prefer the MCP server?

For a purely agent-driven loop you can run and inspect via testRigor's **MCP server** instead of parsing JUnit — see `testrigor-cli` → "MCP server" and https://testrigor.com/how-to-utilise-testrigors-mcp-server/. The file-push (mutation) workflow above remains a CLI feature.

## Gotchas specific to this loop

(General CLI gotchas — globs, JUnit-needs-sync, `--localhost` requires `--url` — are in `testrigor-cli`.)

- **Keep filenames stable** — renaming a file creates a *new* remote test/rule and orphans the old one (unless you pin identity with `testCaseUuid` in `.yaml`).
- **Don't `open url` the app under test.** The suite's URL (or `--url`) opens automatically; hard-coding it breaks other environments. Navigate by clicking links; select the environment via the suite config or `--url`.
- A forced `--url` applies to *every* test in the run — scope with `--labels` so tests written for other URLs don't fail against it. (`.txt` test cases can't carry labels — only `.yaml` can.)
- The tunnel only reaches *your* local app — keep the suite pointed at that one app; tests that navigate to unrelated external URLs through the tunnel are unreliable.
