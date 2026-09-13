---
name: testrigor-cli
description: Run testRigor test suites from the command line with the `testrigor` CLI — authenticate, set a default suite, run suites (sync or async), filter by labels, override URL, tunnel to localhost, upload mobile app builds, push file-based test cases/rules/variables, and save JUnit reports for CI/CD. Use when asked to run, trigger, or schedule testRigor tests from a terminal or pipeline, set up testRigor CI, or manage testRigor auth/config. To author the tests themselves, use `testrigor-write-tests`.
metadata:
  {
    "openclaw":
      {
        "emoji": "🧪",
        "requires": { "bins": ["testrigor"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "@testrigor/testrigor-cli",
              "bins": ["testrigor"],
              "label": "Install testRigor CLI (npm)",
            },
          ],
      },
  }
---

# testRigor CLI

`testrigor` triggers testRigor test-suite runs from a terminal or CI pipeline. The suite lives in testRigor's cloud; a run can **push local test files into it** (updating the suite) and pull back a JUnit report.

This skill is the flag-level reference. To **write** test cases use `testrigor-write-tests`; for the full **build → run → debug → update loop** (the recommended way to develop tests as code) follow `testrigor-dev-loop`.

> Official CLI docs: https://testrigor.com/command-line/

## Install & verify

Requires Node.js ≥ 18.

```bash
npm install -g @testrigor/testrigor-cli
testrigor --version          # e.g. @testrigor/testrigor-cli/0.0.49-beta
testrigor --help
```

## Authentication

The CLI authenticates with a **Personal Authentication Token (PAT)** — your personal token. Get it in the app: *username (top-right) → API Tokens → Generate New Token*.

Provide it one of three ways; the CLI resolves in this priority order (first hit wins):

1. **`TESTRIGOR_API_KEY` env var** — fully non-interactive; **use this for agents/CI**.
2. **`--auth-token <PAT>` flag** — per-command.
3. **`~/.testrigor/testrigor.yml`** — written once by `testrigor authenticate`.

```bash
export TESTRIGOR_API_KEY="<YOUR_PAT>"      # non-interactive; highest priority
```

`testrigor authenticate` prompts for the PAT and stores it in `~/.testrigor`. It's an **interactive** prompt, so:

- **A human running setup may use it once** — it then persists, and later commands need no token. Good for a local workstation.
- **An agent/CI loop must not call it** — the hidden prompt will hang. There, set `TESTRIGOR_API_KEY` (or pass `--auth-token`) instead.

Suite ID resolves from the positional arg, else the stored default. Set a default (non-interactive) so you can omit it afterward — the ID is in the suite's URL:

```bash
testrigor test-suite config --default <TEST_SUITE_ID>
testrigor test-suite config --show
testrigor test-suite config --delete
```

`TESTRIGOR_CLI_HOME` overrides the config/cache dir (default `~/.testrigor`).

## Running a suite

```bash
# Uses default suite ID + PAT from the environment
testrigor test-suite run

# Explicit suite ID
testrigor test-suite run <TEST_SUITE_ID>

# Explicit suite + per-command PAT
testrigor test-suite run <TEST_SUITE_ID> --auth-token <PAT>
```

Exit status reflects the run: a **non-zero exit means the run failed** (sync mode), so the command works directly as a CI gate. Each run also **auto-cancels the previous run** of the same suite.

## Updating the suite by running (mutations)

There is no separate "deploy" step. The file-push flags below are parsed locally and sent with the run request, so **running updates the remote suite to match your files**:

| Flag | Sent to the API as | Effect |
|------|--------------------|--------|
| `--test-cases-path "<glob>"` | `baselineMutations[]` | create/update test cases |
| `--rules-path "<glob>"` | `ruleMutations[]` | create/update reusable rules |
| `--variables-path file.json` | `storedValues` | set variables for the run |
| `--settings-path file.{yaml,json}` | `settings` | apply suite settings |
| `--explicit-mutations` | `explicitMutations: true` | treat your files as the authoritative set |

**Identity** — how a file maps to a remote object:

- A test case is matched by its **filename** (→ `description`/name), or by a `testCaseUuid` field inside a `.yaml` file (pins to one existing test case).
- A rule is matched by its **filename** (→ rule name).

Worked example — **match by filename** (the common case):

```bash
# test-cases/checkout.txt  → a test case named "checkout"
testrigor test-suite run "$SUITE" --test-cases-path "test-cases/**/*.txt"
# Edit checkout.txt, re-run → the remote "checkout" test is UPDATED in place.
# Rename it to checkout-flow.txt, re-run → a NEW "checkout-flow" test is created and the
# old "checkout" is left behind (orphaned).
```

Worked example — **pin by `testCaseUuid`** (rename-safe):

```yaml
# test-cases/checkout.yaml
customSteps: |
  login
  click "Checkout"
  check that page contains "Thank you for your order"
testCaseUuid: "a1b2c3d4-...."   # the exact remote test case to update
```

```bash
testrigor test-suite run "$SUITE" --test-cases-path "test-cases/**/*.yaml"
# Now the filename is irrelevant — the run updates THAT existing test case by UUID, even
# if you rename the file. Use this to keep a stable link to a specific remote test.
```

Two behaviors confirmed against a live suite:

- **A plain push is additive, and the run executes the *whole* suite.** Without `--explicit-mutations`, your files are created/updated by name and any pre-existing test cases remain and **also run** — all against the single `--url` you pass, so tests authored for a *different* app/URL will fail (and failing steps wait for timeouts, making the run much slower). To run only your subset, label your tests and pass `--labels`.
- **Additive push can't delete.** To remove a remote test, either delete it in the UI, or manage the entire suite as files and run with `--explicit-mutations` (your local set becomes authoritative — anything not present is dropped, *including tests you didn't author*, so use it deliberately).

For the on-disk file schema (`.txt` vs `.yaml`, labels, datasets, `testCaseUuid`), see the `testrigor-write-tests` skill; for the whole build → run → debug → update loop, see `testrigor-dev-loop`.

## Command tree

```
testrigor authenticate                 # INTERACTIVE prompt — human-once only; never in automation
testrigor test-suite config             # --default <id> | --show | --delete
testrigor test-suite run [ID] [flags]   # push files + trigger a run
testrigor plugins                       # list installed plugins
testrigor help [command]
```

`test-suite config` manages the **stored default suite** so you don't repeat the ID:

- `--default <id>` saves `<id>` as the default. **After this, `testrigor test-suite run` (no ID) targets that suite** — you don't pass the ID again.
- `--show` prints the current default; `--delete` clears it.

So the usual setup is `config --default <id>` once, then plain `test-suite run` from then on. Passing an explicit ID to `run` always overrides the stored default for that one command.

## `test-suite run` flags

Authentication:

| Flag | Purpose |
|------|---------|
| `--auth-token <value>` | Personal Authentication Token (PAT). Prefer the `TESTRIGOR_API_KEY` env var for automation. |

Run control:

| Flag | Purpose |
|------|---------|
| `-w, --async` | Start the run and exit immediately (don't wait for results) |
| `--verbose` | Detailed output for debugging |
| `--url <value>` | Override the suite's target URL for this run |
| `--labels <a,b,...>` | Only run test cases with these labels (comma-separated) |
| `--excluded-labels <a,b,...>` | Skip test cases with these labels |
| `--test-case-uuid <uuid>` | Run a single test case (requires `--url`) |

Local tunneling (test a site not reachable from the internet):

| Flag | Purpose |
|------|---------|
| `--localhost` | Tunnel to a local app (requires `--url`, e.g. `http://localhost:3000`) |
| `--min-port <n>` | Min tunnel port (default 40000) |
| `--max-port <n>` | Max tunnel port (default 50000) |

Mobile / desktop app builds:

| Flag | Purpose |
|------|---------|
| `--file-path <file>` | Upload a local build — accepted: `.zip .exe .msi .apk .aab .ipa`; ignored if `--url` is set |

Git context (annotate the run with branch/commit):

| Flag | Purpose |
|------|---------|
| `--branch <name>` | Branch name (requires `--commit`) |
| `--commit <hash>` | Commit hash (requires `--branch`) |

Pushing local test definitions (store tests in your own repo) — for the per-file schema and worked examples of each file type, see the **`testrigor-write-tests`** skill:

| Flag | Purpose |
|------|---------|
| `--test-cases-path <glob>` | Test-case files, e.g. `"test-cases/**/*.{txt,yaml,yml}"` |
| `--rules-path <glob>` | Reusable-rule files, e.g. `"rules/**/*.yaml"` |
| `--variables-path <file>` | Variables JSON for data-driven runs |
| `--settings-path <file>` | Suite settings (`settings.yaml` / `settings.json`) |
| `--explicit-mutations` | Treat the pushed test-case set as authoritative (sync/replace; use with `--test-cases-path`) |
| `--auto-create-ai-rules` | Let AI auto-generate rules for unknown steps |

Reporting:

| Flag | Purpose |
|------|---------|
| `--junit-report-save-path <file>` | Write a JUnit XML report (sync mode only) |

## Localhost debugging (the tunnel)

`--localhost --url http://localhost:3000` lets testRigor's cloud browsers reach an app running on your machine. Mechanics (so you know what to expect):

- On first use the CLI downloads a small tunnel binary (`trtc`) into `~/.testrigor/trtc/` — needs outbound network the first time.
- It opens a tunnel on a port in `--min-port`..`--max-port` (40000–50000) and routes the run's traffic through it; the tunnel is torn down when the run ends.
- `--url` must be the locally reachable address (`http://localhost:PORT`, `http://127.0.0.1:PORT`). `--localhost` without `--url` is rejected.
- Add `--verbose` to see tunnel steps (download, start, port).

```bash
# start your local app first, then:
testrigor test-suite run "$SUITE" --localhost --url "http://localhost:3000" \
  --test-cases-path "test-cases/**/*.{txt,yaml,yml}" \
  --rules-path "rules/**/*.{txt,yaml,yml}" \
  --junit-report-save-path ./.run/report.xml --verbose
```

## Reading results / debugging a run

In **sync mode** (default — do *not* pass `--async` while debugging) the CLI waits for completion and surfaces:

- **Exit code** — `0` = all passed; non-zero = a test failed/was canceled. Primary gate.
- **Run URL** printed in the output (`https://app.testrigor.com/.../runs/<id>`) — open in a browser for step-level screenshots, video, and the exact failing step. (It's authenticated, so a human opens it; the CLI can't fetch its contents.)
- **JUnit XML** (`--junit-report-save-path`, sync only — produced **even when tests fail**) — the machine-readable signal. testRigor emits standard JUnit: a failing `<testcase status="failure">` carries a `<failure message="..." type="failure"/>` whose `message` names the exact failing command, and `<testsuite failures="N">` holds the count. Each `<testcase>` also includes its `testCaseUuid` — **except in `--labels`-filtered runs**, where (verified) the `<testcase>` name/uuid come back empty (`name="Test Case UUID="`); there, identify failures by the `<failure>` `message` and the run URL, not the testcase name. Parse it:
  ```bash
  mkdir -p ./.run                                                  # parent dir must exist
  xmllint --xpath 'string(//testsuite/@failures)' ./.run/report.xml   # 0 = all passed
  grep -A1 '<failure' ./.run/report.xml                           # failing cases + reason
  xmllint --xpath '//testcase[failure]/@name' ./.run/report.xml   # list failing test names
  ```
- **Iterate on one test** without re-running the suite: grab the failing test's `testCaseUuid` from the report, then `--test-case-uuid <uuid> --url <url>`.

Internally the CLI polls run status every 10s; `200`=passed, `230`=failed, `229`=canceled, `228/227`=running — these map onto the exit code above.

**Expect minutes, not seconds.** Cloud browsers spin up per run, richer pages take longer, and **failing tests are the slowest** because testRigor auto-waits/retries before giving up (a few failing tests can push a run past 5 minutes). When calling the CLI from an agent or CI step, set a generous timeout (≈10 min) and stay in sync mode so the exit code gates the job.

## MCP server (the agent-native alternative)

testRigor also offers an **MCP server** — for an agent, often a better fit than the CLI for running suites and reading results, because it returns **structured data** (no JUnit parsing) and never hits an interactive prompt. Add it to Claude Code with your PAT:

```bash
claude mcp add --transport http testrigor https://api2.testrigor.com/api/v1/mcp \
  --header "personal-access-token: <YOUR_PAT>" -s user
```

Other MCP-capable agents (Cursor, etc.) point their own MCP config at the same endpoint (`https://api2.testrigor.com/api/v1/mcp`) with the `personal-access-token` header. The server exposes tools to list/retrieve test suites & cases, run test cases or a green regression, list runs, and read run failures. Use the MCP when you want programmatic run/inspect from the agent; use this CLI for terminal/CI pipelines and the file-push (mutation) workflow.

> Guide: https://testrigor.com/how-to-utilise-testrigors-mcp-server/

## Recipes

Smoke run gated in CI, with JUnit output:

```bash
testrigor test-suite run "$TEST_SUITE_ID" \
  --labels smoke,critical \
  --junit-report-save-path ./testrigor-report.xml
```

Fire-and-forget (async) — kick off and let the pipeline continue:

```bash
testrigor test-suite run --async
```

Test a local dev server via tunnel:

```bash
testrigor test-suite run --localhost --url http://localhost:3000
```

Run a PR build and tag it with git context:

```bash
testrigor test-suite run \
  --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --commit "$(git rev-parse HEAD)" \
  --url "$PREVIEW_URL"
```

Push repo-managed tests, replacing the suite's current set:

```bash
testrigor test-suite run \
  --test-cases-path "test-cases/**/*.txt" \
  --rules-path "rules/**/*.yaml" \
  --variables-path variables.json \
  --settings-path settings.yaml \
  --explicit-mutations
```

Upload and test a mobile build:

```bash
testrigor test-suite run --file-path ./build/app-release.apk
```

## CI/CD notes

- Provide the PAT via an environment secret (`$TESTRIGOR_API_KEY`), never commit it.
- Use **sync mode** (omit `--async`) when you want the job to pass/fail on results.
- Combine `--junit-report-save-path` with your CI's JUnit ingestion to surface per-test results.
- `--labels` / `--excluded-labels` let one suite power several pipelines (smoke on every push, full regression nightly).

## Troubleshooting

- `testrigor <command> --help` prints exact flags for the installed version.
- Auth errors → confirm `TESTRIGOR_API_KEY` is exported (or `--auth-token` is passed) and the token hasn't expired in *API Tokens*. Don't rely on `testrigor authenticate` in automation — it prompts interactively.
- Globs match nothing → quote them (`"test-cases/**/*.txt"`) so the CLI expands them, not the shell.
- `--junit-report-save-path` produces nothing in `--async` mode (no results yet), and won't create missing parent directories — `mkdir -p` first.
