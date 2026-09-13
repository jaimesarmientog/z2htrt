# API Testing in testRigor

testRigor calls APIs from inside the same plain-English test cases used for UI — so you can seed data, read it back, assert on responses, and feed values into UI steps, all in one test. API steps use the `call api` command; stubs use `mock api`. This is part of the testRigor language (covered by the `testrigor-write-tests` skill); to **run** the tests, use the `testrigor-cli` skill.

## Anatomy of `call api`

A `call api` step chains clauses with `and`:

```
call api <method> "<url>"
  with headers "<H1>" and "<H2>" ...
  and body "<payload>"
  and get "<JSONPath>"
  and save it as "<variable>"
  and then check that http code is <code>
```

Every clause after the URL is optional. `<method>` defaults to GET if omitted.

## GET — fetch and extract a field

```
call api get "https://jsonplaceholder.typicode.com/users/10" with headers "Content-Type:application/json" and "Accept:application/json" and get "$..catchPhrase" and save it as "searchWord" and then check that http code is 200
```

- **Headers**: one quoted `"Name:Value"` per header, joined with `and`.
- **`get "<JSONPath>"`**: extracts part of the JSON response. `$` is the root; `$.data.name` walks keys; `$..field` finds `field` at any depth; `$.items[0].id` indexes arrays (**0-based**: `$[0]` is the first element). You must `save it as` to keep the value. JSONPath also supports **comparison filters** — see "JSONPath in `get`" below.
- **`check that http code is 200`**: asserts the status.

## POST / PUT / DELETE — send a body

```
call api post "https://api.example.com/users" with headers "Content-Type:application/json" and body "{\"name\":\"James\",\"role\":\"admin\"}" and get "$.id" and save it as "newUserId" and then check that http code is 201
```

To target the new user, build the URL from the saved id first (see "Interpolating
variables" below — a bare `${newUserId}` in the URL is **not** expanded), then pass it
as a `stored value`:

```
save string with parameters "https://api.example.com/users/${newUserId}" as "userUrl"
call api put stored value "userUrl" with headers "Content-Type:application/json" and body "{\"role\":\"editor\"}" and then check that http code is 200
call api delete stored value "userUrl" and then check that http code is 204
```

Notes:
- Escape inner quotes in the JSON body (`\"`).
- For a body too large to inline, read it from a variable: `... and body stored value "requestBody" ...`.

### Interpolating variables into a URL or body

**`call api` does not expand `${var}` inside its URL or body string** (verified — a
bare `${id}` is sent literally). Interpolate **first** with `string with parameters`,
then pass the result as a `stored value`:

```
// URL: build it, then call with `stored value`
save string with parameters "https://api.example.com/users/${userId}" as "userUrl"
call api get stored value "userUrl" and get "$.name" and save it as "name" and then check that http code is 200

// Body: build it, then pass via `body stored value`
save value "42" as "qty"
save string with parameters "{\"sku\":\"WM-1\",\"qty\":${qty}}" as "orderBody"
call api post "https://api.example.com/cart" with headers "Content-Type:application/json" and body stored value "orderBody" and then check that http code is 201
```

## Asserting on the response

```
... and then check that http code is 200
check that stored value "searchWord" itself contains "Multi-layered"
```

`get "<JSONPath>" and save it as "x"` captures a field; then assert on it with the standard checks from this skill (`check that stored value "x" itself contains "..."`).

## JSONPath in `get`

The string inside `get "..."` is JSONPath. **Verified** to work in this context:

```
$.store.book[0].title          // key walk + index (arrays are 0-based: $[0] is first)
$..price                       // every `price` at any depth
$[?(@.id == 83)].title         // comparison filter: items where id equals 83
$[?(@.price < 10)]             // <, <=, >, >=, !=, == all work; combine with && / ||
$[?(@.id > 99)].id             // numeric comparison
```

**Not supported here (verified — they silently return nothing, so avoid them):**

- JSONPath **functions** like `length()` (e.g. `$.length()` does **not** return the array size).
- **Regex** match filters (`$[?(@.title =~ /word/)]` does **not** match).

For counting and "matches a pattern", use the working alternatives in the next section.

### Asserting array size / "more than N results"

testRigor checks are substring-based (`... itself contains "..."`) — there is **no**
numeric `>` assertion, and `length()` isn't available in `get`. Verified patterns:

- **"More than N results"** — extract element `$[N]` (0-based, so `$[N]` is the
  (N+1)th item). **Verified:** if the array has fewer than N+1 items the `get` step
  itself **fails**, so the extraction *is* the gate — no extra assertion needed:
  ```
  // passes only if there are more than 50 results (else the `get "$[50]..."` step fails)
  call api get "https://api.example.com/posts" and get "$[50].id" and save it as "item51Id" and then check that http code is 200
  ```
- **At least one item matching a condition** — filter by a comparison, take a field,
  and assert it is present:
  ```
  call api get "https://api.example.com/posts" and get "$[?(@.id == 83)].title" and save it as "title83" and then check that http code is 200
  check that stored value "title83" itself contains "expected words"
  ```
- **Exact count** — there's no native count. If you control the data, assert a known
  boundary instead (e.g. `$[N]` exists but `$[N+1]` doesn't). Note that a substring
  check is loose: `contains "100"` also matches `1000`, so prefer boundary checks.

## Chaining API + UI (the common pattern)

Fetch a value via API, then drive the UI with it:

```
// 1. Pull a value straight from the backend
call api get "https://jsonplaceholder.typicode.com/users/10" with headers "Accept:application/json" and get "$..catchPhrase" and save it as "searchWord" and then check that http code is 200

// 2. Use it in the browser (the suite's start URL is already open — no `open url`)
enter stored value "searchWord" into "Search"
click "Search"
check that page contains "Nothing Found"
```

Or the reverse — set up state via API before a UI test, and verify via API after:

```
call api post "https://api.example.com/cart" with headers "Content-Type:application/json" and body "{\"sku\":\"WM-1\",\"qty\":2}" and then check that http code is 200
check that "Cart" contains "2"
```

## Mocking APIs

Stub a dependency so the UI sees a controlled response (great for error states and flaky third parties):

```
mock api call "https://example.com/api/profile" returning body "{\"name\":\"Test User\"}"

mock api call POST "https://example.com/todos" with headers "Content-Type:application/json" returning payload "Created" and http code 200

mock api call GET "https://example.com/api/balance" returning body "{\"error\":\"service unavailable\"}" and http code 503
```

After mocking, the matching front-end request receives your stub instead of the real response — then assert the UI handled it.

## Tips

- Keep secrets (API keys, tokens) in suite variables and reference them as `stored value "apiKey"` or inside a header string, never hard-coded.
- `$..field` (recursive) is the most forgiving JSONPath when you don't know the exact nesting; tighten to `$.path.to.field` once you do.
- Always assert `http code` on writes (POST/PUT/DELETE) — a 2xx is your proof the call landed.
- Run these tests the same way as any other suite — see the `testrigor-cli` skill.

> Official guide: https://testrigor.com/how-to-articles/how-to-do-api-testing-using-testrigor/
