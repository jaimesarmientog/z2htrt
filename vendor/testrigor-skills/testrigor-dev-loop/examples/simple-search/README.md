# Example: simple search (dev-loop walkthrough)

A complete, runnable example for the [`testrigor-dev-loop`](../../SKILL.md) skill. Tests the public demo app [`search-items`](http://r4d4.info/test-web-app/search-items/index.html) — a one-field "Business Page" that echoes your query back as `search: <text>` (or `search: no value` when empty).

## Layout

```
test-cases/
  search-echoes-query.txt          # enter a term → "search: laptop"
  empty-search-shows-no-value.txt  # submit empty → "search: no value"
  search-via-parameterized-rule.txt# uses the `search for "query"` rule
rules/
  open-search-page.txt             # plain reusable rule (navigate + verify)
  search for "query".txt           # parameterized reusable rule
```

Each test invokes the `open-search-page` rule by name as its first step; the third test additionally calls the parameterized `search for "monitor"` rule.

## Run it

Auth + default suite must already be configured (`TESTRIGOR_API_KEY` or `testrigor authenticate`; `testrigor test-suite config --default <id>`). Then, from this folder:

```bash
mkdir -p .run
testrigor test-suite run \
  --test-cases-path "test-cases/**/*.txt" \
  --rules-path "rules/**/*.txt" \
  --junit-report-save-path .run/report.xml
```

The run pushes these files into the suite (creating/updating the test cases and rules by filename) and executes them against the app. Exit code `0` = all passed; inspect `.run/report.xml` and the printed run URL otherwise.

> Note: `rules/search for "query".txt` contains quotes/spaces in its filename — the only way to express a *parameterized* rule as a file (the filename is the rule name). That filename is invalid on Windows, so for portable repos prefer defining parameterized rules in the suite's Reusable Rules UI and keep file-based rules non-parameterized (like `open-search-page`).
