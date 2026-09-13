# Worked authoring examples

A single cohesive mini-project that shows **every file type** working together: `.txt` and `.yaml` test cases, a plain and a parameterized reusable rule, and a `variables.json`. Use it as the template when authoring a test repo — the `SKILL.md` sections explain each piece; this file shows them assembled. For complete *runnable* projects (with run commands and the localhost tunnel) see the `testrigor-dev-loop` skill's `examples.md` and its bundled `examples/`.

## Layout

```
test-cases/
  login.txt                       # plain-text test case
  search-products.yaml            # YAML test case with labels + dataset
  checkout-blocks-empty-form.yaml # negative test (proves blocking)
rules/
  open-account-menu.txt           # plain reusable rule
  search for "query".txt          # parameterized reusable rule (file-based)
variables.json                    # stored values for data-driven steps
```

Remember: **the filename (without extension) is the name** — a test case's title, or the keyword you invoke a rule by. No step ever `open url`s the app under test; the suite's start URL (or `--url`) opens automatically.

## Test cases

`test-cases/login.txt` — a plain-text test case; the whole file is the steps:

```
# the suite's start URL opens automatically — begin with an action, not navigation
login                              // runs the built-in login rule (suite credentials)
check that page contains "My Account"
open-account-menu                  // runs rules/open-account-menu.txt
check that page contains "Sign out"
```

`test-cases/search-products.yaml` — YAML when you need labels or a dataset:

```yaml
customSteps: |
  search for "Wireless Mouse"      // parameterized rule, hard-coded value
  check that page contains "Wireless Mouse"
  search for stored value "secondQuery"   // same rule, value from variables.json
  check that page contains stored value from "secondExpectation"
labels: [smoke, search]            # lets `--labels smoke` pick this up
datasetName: "SearchTerms"         # optional — bind a data set for row-per-run data
```

`test-cases/checkout-blocks-empty-form.yaml` — a **negative** test that proves the form actually blocks an empty submission (a green run here means the guard works):

```yaml
customSteps: |
  click "Checkout"
  // submit nothing
  click "Purchase"
  check that page contains "Checkout"                       // still on the form
  check that page doesn't contain "Thank you for your purchase!"
labels: [checkout, negative]
```

## Reusable rules

`rules/open-account-menu.txt` — a plain rule, invoked by its filename:

```
hover over "Account"
click "My profile"
check that page contains "Profile"
```

`rules/search for "query".txt` — a **parameterized** rule; the quoted word in the filename is the parameter, referenced inside via `stored value`:

```
click "Search"
enter stored value "query" into "Search"
click "Go"
```

Invoke it with a hard-coded value (`search for "Wireless Mouse"`) or a saved one (`search for stored value "secondQuery"`). Note the quotes/spaces in this filename are invalid on Windows — for cross-platform repos define parameterized rules in the suite's *Reusable Rules* UI and keep file-based rules fixed-name.

## Variables

`variables.json` — a flat object; each key is referenced as `stored value "key"`, and pushed to the run with `--variables-path variables.json`:

```json
{
  "secondQuery": "Mechanical Keyboard",
  "secondExpectation": "Mechanical Keyboard",
  "billingEmail": "qa+billing@acme.test",
  "cardNumber": "4111 1111 1111 1111",
  "cardExpiration": "12/29"
}
```

## How they connect

- `login.txt` invokes the built-in `login` rule **and** the local `open-account-menu` rule by writing its filename as a step.
- `search-products.yaml` invokes the parameterized `search for "query"` rule both ways — hard-coded and via a `stored value` from `variables.json`.
- `checkout-blocks-empty-form.yaml` asserts the *negative* so a pass actually proves the form's validation.
- `labels:` on the YAML cases let a run target a subset with `--labels` (a `.txt` case can't carry labels).

To run any of this, see the `testrigor-cli` and `testrigor-dev-loop` skills.
