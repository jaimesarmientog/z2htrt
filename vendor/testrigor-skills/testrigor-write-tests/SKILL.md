---
name: testrigor-write-tests
description: Author testRigor automated test cases in plain-English commands — navigation, clicks, typing, assertions, reusable rules, variables, data-driven tests, API steps (`call api`/`mock api`), and login/email/SMS/2FA flows. Use when writing, editing, or converting manual test steps into testRigor test cases (as `test-cases/*.txt` files or steps pasted into the testRigor app), or when asked how to express a step in testRigor's language. Full command catalog in `reference.md`; worked authoring examples in `examples.md`; API steps in `api-testing.md`. To run suites use the `testrigor-cli` skill.
---

# Writing testRigor Test Cases

testRigor tests are written in **plain English**, one command per line, from the perspective of an end user. There are no CSS/XPath selectors — you refer to elements by the text the user sees ("Sign in", "Email", "Add to Cart").

This skill covers authoring. For the **complete command catalog** read [reference.md](reference.md); for **API steps** (`call api` / `mock api`) read [api-testing.md](api-testing.md). To **execute** what you write, use the `testrigor-cli` skill.

**Before authoring a test repo, read [examples.md](examples.md)** — a complete worked mini-project (every file type assembled) that you should use as the template for the files you create.

## The golden rules

1. **One action per line.** Each step is a command on its own line.
2. **Describe what a user sees**, not the DOM. `click "Add to Cart"`, never a selector.
3. **Quote everything the user reads.** Element captions, input text, and expected text all go in `"double quotes"`.
4. **Assert often.** After meaningful actions add a `check that ...` so failures are pinpointed. A test with no assertions proves nothing.
5. **Prefer built-in reusable rules** (`login`, `fill out form`, `purchase "X"`) over re-implementing flows by hand.
6. **Use variables for anything generated or reused** (`save as`, `grab ... and save it as`, `stored value "..."`) — never hard-code a value you produced earlier. Interpolate a variable into a string only with `string with parameters "...${var}..."`; a bare `"..."` is **not** interpolated — for assertions use `string with parameters` or `stored value from`.
7. **Don't `open url` the app under test.** The suite's start URL (or the CLI `--url`) opens automatically at the start of every test; hard-coding a URL breaks runs across environments (local / staging / prod). Navigate *within* the app by clicking links, and choose the environment via the suite config or `--url` — not in the test.

## Most-used commands (the 90% you'll write daily)

The suite's start URL is already open, so a test begins with an **action**, not a navigation. (`open url` is the rare exception — see the note below.)

```
click "Sign in"
click on the 2nd "Edit"
enter "user@test.com" into "Email"
enter stored value "password" into "Password"
select "United States" from "Country"
type "free text"                      // types into the focused field

check that page contains "Welcome back"
check that page contains "Order #" using OCR    // text baked into an image/canvas
check that "Cart" contains "3 items"
check that button "Checkout" is disabled

scroll down until page contains "Footer"
hover over "Account"
wait 3 seconds                        // max 2 minutes; avoid unless necessary

save value "Acme Corp" as "company"
grab value from "Total" and save it as "orderTotal"
generate unique email, then enter into "Email" and save as "newEmail"
```

```
open url "https://example.com"        // EXCEPTION: only to reach a NEW, external page —
                                      // never the app under test (rule #7)
```

## Referring to elements precisely

You target an element by the **text the user sees on it**. When a caption is ambiguous (it appears more than once, or is generic like "Edit"), narrow it down with a qualifier. The full grammar — element types, ordinals, relative position, scope, exact/case-sensitive matching, regex/template — is in [reference.md](reference.md#element-reference-grammar); the everyday qualifiers:

```
click "Delete" below "Invoice #42"          // relative position (anchor by nearby text)
click "Submit" in the context of "Billing"  // scope to a section/container
click the 3rd "Remove"                       // by index / ordinal
click button "Save"                          // by element type (button/link/input/checkbox/dropdown...)
click exactly "Save"                         // exact, case-sensitive match
click "Continue" if exists                   // conditional — no failure if absent
```

Match form fields by their **visible label** (`into "Email address"`), not a placeholder — placeholders are often vague or repeated across fields, so they can match the wrong input.

## Reusable rules

A reusable rule is a named block of steps you invoke by writing its name as a single step — so a flow you use everywhere (login, checkout) is written once and called like a sentence.

### Built-in rules

testRigor ships rules for common flows — call them by name:

```
login                       // uses the suite's username/password credentials
logout
sign up with email confirmation
purchase "Wireless Mouse"
fill out form               // also: fill out required fields in form / with generated values
```

### Custom rules (parameterized)

Define your own rule, then call it like a sentence. **The quoted words in the rule's name are its parameters** — inside the rule, reference each by `stored value`:

```
Rule name:  go to checkout for "product"
Steps:      login
            search for "product"
            click "product"
            click "Add to Cart"
            click "Checkout"
```

Invoke it with a **hard-coded** value, or with a **stored value** you captured earlier — both work the same way:

```
go to checkout for "Wireless Mouse"                 // hard-coded parameter
go to checkout for stored value "selectedProduct"   // parameter from a saved variable
```

### Reusable rules as files

To keep rules in your repo, store **each rule as its own file**. The filename (without extension) **is the rule's name** — i.e. the keyword you invoke it by — which is exactly how the CLI's `--rules-path` parses them. Add as many rule files as you like; each becomes a separately-invokable rule.

`.txt` — the whole file is the steps:

```
# file: rules/complete-checkout-as-returning-customer.txt
# → rule invoked by writing `complete-checkout-as-returning-customer` in a test
login
click "Cart"
click "Checkout"
fill out the rest of the required fields in form
click "Place Order"
check that page contains "Thank you for your order"
```

`.yaml` — when the rule needs labels:

```yaml
# file: rules/complete-checkout-as-returning-customer.yaml
steps: |
  login
  click "Cart"
  click "Checkout"
  fill out the rest of the required fields in form
  click "Place Order"
  check that page contains "Thank you for your order"
labels: [checkout]         # optional
```

Then any test invokes it by that filename:

```
# file: test-cases/returning-customer-buys.txt
complete-checkout-as-returning-customer    // runs the rule file above
grab value of "Order #\d+" and save it as "orderId"
check that email to stored value "username" was received
```

> **Parameterized rules as files** work (verified) by putting the quoted placeholder in the filename — a file `rules/search for "query".txt` containing `enter stored value "query" into "Search"` is invoked as `search for "laptop"`. But that filename has `"` and spaces, which is **invalid on Windows** and awkward in shells. For cross-platform repos, keep file-based rules fixed-name (like `open-search-page`) and define parameterized rules in the suite's *Reusable Rules* UI.

## Data-driven tests

Drive one test with many values by storing them in a **variables file** and referencing each by name as `stored value "..."`. The file is a flat JSON object — each key becomes a stored value; pass it with the CLI `--variables-path`:

```json
// file: variables.json
{
  "billingEmail": "qa+billing@acme.test",
  "cardNumber": "4111 1111 1111 1111",
  "cardExpiration": "12/29",
  "plan": "Pro",
  "expectedConfirmation": "Subscription activated"
}
```

Reference those keys inside any test or rule:

```
enter stored value "billingEmail" into "Email"
enter stored value "cardNumber" into "Card number"
enter stored value "cardExpiration" into "Expiration"
select stored value "plan" from "Plan"
check that page contains stored value from "expectedConfirmation"
```

Run it (the CLI pushes the variables with the run):

```bash
testrigor test-suite run "$SUITE" \
  --test-cases-path "test-cases/**/*.{txt,yaml,yml}" \
  --rules-path "rules/**/*.{txt,yaml,yml}" \
  --variables-path variables.json
```

For true row-per-run data sets (a table of many rows), attach a **dataset** to a `.yaml` test case via `datasetName:` (see "Test cases as files" below) and reference its columns the same way — `stored value "columnName"`.

## A complete example test

```
// Login and place an order, verifying each stage
login
check that page contains "My Account"

click "Catalog"
click "Wireless Mouse"
click "Add to Cart"
check that "Cart" contains "1"

click "Checkout"
generate unique email, then enter into "Email" and save as "buyerEmail"
fill out the rest of the required fields in form
click "Place Order"

check that page contains "Thank you for your order"
grab value of "Order #\d+" and save it as "orderId"
check that email to stored value "buyerEmail" was received
```

## Make a test actually prove something (avoid false passes)

A green run only means *no assertion failed* — not that the feature works. A test can pass while silently doing nothing useful. Guard against it:

- **Assert the consequence, not just the navigation.** "Reached the Thank-you page" is a weak check if the button is really a link — it passes even with an empty/unfilled form. Assert the state that *proves* the action worked (an order number, a sent email, an updated total).
- **Test the negative, not only the happy path.** To prove a field is required, a button disables, or input is rejected, do the *wrong* thing and assert it's blocked:
  ```
  enter "buyer@test.com" into "Email address"
  // deliberately leave "Expiration" empty
  click "Purchase"
  check that page contains "Checkout"                          // still on the form
  check that page doesn't contain "Thank you for your purchase!"
  ```
- **A skipped or mis-targeted step won't always fail.** If an `enter ... into "X"` is omitted or matches the wrong field, the test still passes unless a later assertion depends on it — so assert intermediate state where it matters.
- **The app must actually enforce what you test.** A test can't catch validation the page never performs; if "required" matters, the markup must enforce it *and* the negative test above keeps it honest.

## Test cases as files

To keep tests in a repo and drive them with the CLI, store **each test case as its own file**. The filename (without extension) **is the test case's title**, exactly how the CLI's `--test-cases-path` parses it. Accepted extensions: `.txt` and `.yaml`/`.yml` for test cases and rules; `.json` for variables; `.yaml`/`.yml`/`.json` for settings.

A repo typically looks like:

```
test-cases/
  login.txt
  checkout/place-order.txt
rules/
  open-search-page.txt
  complete-checkout-as-returning-customer.txt
variables.json
```

### `.txt` test case — the whole file is the steps

```
# file: test-cases/login.txt   →   test case named "login"
login                              // the suite's start URL opens automatically — no `open url`
check that page contains "My Account"
```

### `.yaml` test case — when you need labels, a dataset, or to pin identity

```yaml
# file: test-cases/login.yaml   →   test case named "login"
customSteps: |
  login
  check that page contains "My Account"
labels: [smoke, auth]      # optional — required if you want to filter with --labels
datasetName: "Users"       # optional — bind a data set for data-driven runs
testCaseUuid: "..."        # optional — update THIS existing test case instead of matching by name
```

> `.txt` test cases can't carry labels — only `.yaml` can. If you need `--labels` to run a subset, use `.yaml`. To run **only your one test** (not the whole suite), it must be `.yaml` with a `labels:` entry, then run with the CLI `--labels <label>` — otherwise a plain push is additive and executes the entire suite against the single `--url`. See the `testrigor-cli` skill (`--labels`).

To **run** these files (a run also pushes them into the remote suite, updating it), see the `testrigor-cli` skill and the full build → run → debug → update loop in `testrigor-dev-loop`.

## API steps

To call REST endpoints, extract JSON, assert on status codes, chain API + UI, or mock a dependency — all inside the same test case — see [api-testing.md](api-testing.md).

## When you're unsure of the exact keyword

Read [reference.md](reference.md) — it lists every command category with exact syntax. testRigor is forgiving about phrasing, but using the documented keywords (`click`, `enter ... into ...`, `check that page contains ...`, `grab ... and save it as ...`) is the most reliable. If a step is genuinely visual or ambiguous, add `using AI` (e.g. `check that page "shows a success banner" using ai`).
