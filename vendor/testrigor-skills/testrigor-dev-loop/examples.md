# Runnable examples

Two complete, runnable example projects ship in this skill under [`examples/`](examples/). Each is a real repo layout you can execute end to end to watch the build → run → debug → sync loop. Use them as the canonical templates when scaffolding a new testRigor test repo; copy the structure and adapt the steps. For the file *formats* in isolation (test cases, reusable rules, variables) see the `testrigor-write-tests` skill's `examples.md`.

## `examples/simple-search` — the basic loop

The minimal walkthrough: author `.txt` test cases and reusable rules, then run them against a public demo app so a run **pushes the files into the suite and executes them**. Demonstrates a plain reusable rule and a **parameterized rule as a file** (`search for "query".txt`).

```
examples/simple-search/
  test-cases/
    search-echoes-query.txt           # enter a term → "search: laptop"
    empty-search-shows-no-value.txt   # submit empty → "search: no value"
    search-via-parameterized-rule.txt # uses the `search for "query"` rule
  rules/
    open-search-page.txt              # plain reusable rule (navigate + verify)
    search for "query".txt            # parameterized reusable rule (file-based)
```

Run it (auth + default suite already configured):

```bash
cd examples/simple-search
mkdir -p .run
testrigor test-suite run \
  --test-cases-path "test-cases/**/*.txt" \
  --rules-path "rules/**/*.txt" \
  --junit-report-save-path .run/report.xml
```

See [`examples/simple-search/README.md`](examples/simple-search/README.md) for the full walkthrough.

## `examples/shop-checkout` — localhost tunnel + the extras

The fuller example: test a site running on **your machine** through the `--localhost` tunnel. It also exercises everything the basic example doesn't — **`.yaml` test cases with labels**, **`--labels` filtering**, a **`variables.json`** consumed by a reusable rule, and **negative tests** that prove the mandatory checkout fields actually block submission.

```
examples/shop-checkout/
  test-cases/
    checkout-happy-path.yaml          # list → View → Buy → fill form → Purchase → thank-you
    product-page-details.yaml         # product details visible
    cancel-returns-to-list.yaml       # Cancel returns to the list
    checkout-requires-all-fields.yaml # negative: a missing Expiration is blocked
    checkout-blocks-empty-form.yaml   # negative: an empty form is blocked
  rules/
    fill-checkout-form.txt            # fills the form from variables.json
  variables.json                      # email / card / fullName / crc / expiration
```

Run it through the tunnel, filtered to the `shop` label:

```bash
cd examples/shop-checkout
# serve the app's static root first, e.g.:
python3 -m http.server 8421 --directory /path/to/testsite/public
mkdir -p .run
testrigor test-suite run \
  --localhost --url "http://localhost:8421/test-web-app/checkout/index.html" \
  --test-cases-path "test-cases/**/*.yaml" \
  --rules-path "rules/**/*.txt" \
  --variables-path variables.json \
  --labels shop \
  --junit-report-save-path .run/report.xml
```

See [`examples/shop-checkout/README.md`](examples/shop-checkout/README.md) for the full walkthrough.

## What each one teaches

| Concept | simple-search | shop-checkout |
|---------|:-------------:|:-------------:|
| `.txt` test cases & rules | ✅ | |
| Parameterized rule as a file | ✅ | |
| `.yaml` test cases with `labels` | | ✅ |
| `--labels` filtering | | ✅ |
| `variables.json` / `stored value` | | ✅ |
| Negative tests (prove blocking) | | ✅ |
| `--localhost` tunnel | | ✅ |
| Run pushes files into the suite | ✅ | ✅ |
