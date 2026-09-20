/**
 * Confirmed testRigor syntax, verified directly against testRigor's
 * official documentation during this project (not relied on from
 * training data) — shared between generate.ts and refine.ts so the two
 * can't drift out of sync the way crawl.ts/generate.ts's duplicated
 * Inventory types could. Kept here as a guaranteed baseline even if a
 * vendored skills directory is missing or incomplete in a given
 * environment.
 */
export const CONFIRMED_SYNTAX_NOTES = `
# Confirmed testRigor syntax (verified against official documentation)

- Comments start with \`//\`. The first comment line of a test case file
  is its human-readable description and must be preserved as the file
  header exactly as written.
- Reusable rules are defined once (name + steps) and invoked elsewhere
  by writing the rule's name as a bare line, e.g. a rule named
  \`go to checkout page\` is invoked with the line \`go to checkout page\`.
  Rules can take dynamic parameters via quoted tokens in the rule's own
  name, bound inside the rule body with \`stored value "paramName"\`.
- Case-sensitive element matching: \`click exactly "Book now"\`.
- Retry-wait synchronization pattern:
  \`wait 1 sec up to 10 times until page contains "Cancel" below "Reserve Now"\`
- API calls:
  \`call api <method> "<url>" with headers "a:b" and "c:d" and body "..." and get "$.jsonPath" and save it as "varName" and then check that http code is 200\`
  All HTTP verbs are supported: get, post, put, patch, head, delete, options, trace.
  A previously saved API result can be checked directly:
  \`check that stored value "createdName" itself contains "James"\`
  For any JSON request body, NEVER write it as an escaped single-line
  string (e.g. \`body "{\\"key\\":\\"value\\"}"\`) — always save it as its own
  named step first using the multi-line block, then reference that
  variable in the call:
  \`save text starting from next line and ending with [END]\n{\n  "key": "value"\n}\n[END] as "body"\`
  \`call api post "<url>" with headers "..." and body with parameters \${body} and get ...\`
  If the JSON block itself contains a \${var} placeholder (e.g. a value
  coming from another stored value), mark the save step itself with
  "with parameters" too:
  \`save text with parameters starting from next line and ending with [END]\n{\n  "firstname": "\${generatedName}"\n}\n[END] as "body"\`
  ⚠️ This exact composition (multi-line save step + "with parameters"
  reference) is not directly confirmed in the docs read so far — flag it
  for verification in the next real run rather than asserting it
  silently works.
  Variable interpolation ("parameters") is confirmed but its exact
  phrasing differs per argument type — do not generalize one form to
  another:
  - URL (confirmed from official docs): the method itself takes the
    modifier, e.g. \`call api post from the string with parameters "\${homePrefix}/api/v1/create" with headers ...\`
  - Inline multi-line body (confirmed from official docs): \`body from the string with parameters text starting from next line and ending with [END]\n{...}\n[END]\`
  - Headers (confirmed via direct domain knowledge, not the docs read so
    far): \`with headers with parameters "Cookie:token=\${authToken}"\`
  - Plain assertions (confirmed via direct domain knowledge): \`check that page contains string with parameters "My name is \${myName}"\`
  An argument with no \${} in it is written normally, with no "with
  parameters"/"from the string with parameters" modifier at all.
- Reusable rule naming convention: every rule name MUST be prefixed
  with "RR - " (e.g. "RR - Navigate to user profile",
  "RR - Authenticate as admin via API"). This prefix is part of the
  rule's actual name — it must appear both in the rule definition and
  in every bare-line invocation of that rule, exactly matching.
- Golden rules: one action per line; quote everything the user/tester
  reads; assert (check) often, not just at the very end; prefer
  built-in reusable rules over repeating steps; use variables/stored
  values instead of hard-coded data; never hard-code the app's base
  URL inline in a step if it can be avoided.
`.trim();
