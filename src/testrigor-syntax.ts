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
  header exactly as written. Do NOT also include this description (or
  any restatement of it) as the first element of a steps array — the
  header and the steps are two separate things; repeating it produces a
  duplicated comment line in the output file.
- There is NO \`go to "<url>"\` command — this does not exist in
  testRigor and must never be used for navigation. The only place "go
  to" appears in official examples is as part of a user-CHOSEN rule
  NAME (e.g. a rule literally named "go to checkout page", invoked by
  writing that exact name as a bare line) — it is not a built-in verb.
  To navigate to a URL, always use \`open url "<url>"\`.
- Reusable rules are defined once (name + steps) and invoked elsewhere
  by writing the rule's name as a bare line, e.g. a rule named
  \`go to checkout page\` is invoked with the line \`go to checkout page\`.
- Case-sensitive element matching: \`click exactly "Book now"\`.
- Retry-wait synchronization pattern:
  \`wait 1 sec up to 10 times until page contains "Cancel" below "Reserve Now"\`
- STORED VALUES — two genuinely different mechanisms, both confirmed
  from official docs. Do not conflate them or default to one for
  everything:
  1. WHOLE-VALUE substitution — use when a step's ENTIRE argument is
     exactly one previously stored/saved value, with no other literal
     text mixed in. The general pattern, confirmed across MANY commands
     in the official docs, is \`from stored value "varName"\`:
     \`open url from stored value "testSuiteRunExecutionUrl"\`
     \`upload file from stored value "file.txt"\`
     \`send sms from stored value "allocatedNumber" to stored value "answerPhoneNumber"\`
     \`check that page contains text from stored value "expectedText"\`
     ⚠️ \`enter\` is a confirmed EXCEPTION to this general pattern — it
     omits "from": \`enter stored value "username" into "username_field"\`
     (multiple identical confirmed examples, not a one-off). Do not
     generalize \`enter\`'s missing "from" to other commands, and do not
     drop "from" elsewhere just because \`enter\` doesn't use it.
     NO \${} and NO "with parameters" anywhere in this whole-value form,
     regardless of command.
  2. COMPOSITE templating — use ONLY when a stored value is being
     COMBINED with other literal text inside the same argument (e.g.
     a base URL concatenated with a path). Written with \${varName}
     placeholders inside a quoted string, but the modifier phrase that
     introduces it is command-specific — confirmed to genuinely differ,
     not a typo to normalize away:
     - \`enter\` and \`call api <method>\`: "from THE string with
       parameters" (the word "the" is present) — e.g.
       \`enter from the string with parameters "\${homePrefix}/my/path" into "urlPath"\`
       \`call api post from the string with parameters "\${homePrefix}/api/v1/create" with headers ...\`
     - \`open url\`: "from string with parameters" (NO "the") — e.g.
       \`open url from string with parameters "https://\${homeDomain}/cart/checkout/confirm"\`
     - Headers (confirmed via direct domain knowledge, not the official
       docs specifically): \`with headers with parameters "Cookie:token=\${authToken}"\`
     - Plain assertions (confirmed via direct domain knowledge):
       \`check that page contains string with parameters "My name is \${myName}"\`
  Rule of thumb: if the whole argument IS the variable, use form 1
  (stored value). If the variable is glued to other literal text, use
  form 2 (the command-specific composite phrasing above) — never use
  form 2 just because a value happens to come from a variable.
- API calls:
  \`call api <method> "<url>" with headers "a:b" and "c:d" and body "..." and get "$.jsonPath" and save it as "varName" and then check that http code is 200\`
  All HTTP verbs are supported: get, post, put, patch, head, delete, options, trace.
  For any JSON request body, NEVER write it as an escaped single-line
  string (e.g. \`body "{\\"key\\":\\"value\\"}"\`) — always save it as its own
  named step first using the multi-line block, then reference that
  variable in the call:
  \`save text starting from next line and ending with [END]\n{\n  "key": "value"\n}\n[END] as "body"\`
  The \`as "varName"\` clause MUST go on the CLOSING \`[END]\` line, never
  on the opening trigger line (i.e. never \`...ending with [END] as
  "body"\` as the first line) — this has been a real, observed mistake.
  \`call api post "<url>" with headers "..." and body with parameters \${body} and get ...\`
  If the JSON block itself contains a \${var} placeholder (e.g. a value
  coming from another stored value), mark the save step itself with
  "with parameters" too:
  \`save text with parameters starting from next line and ending with [END]\n{\n  "firstname": "\${generatedName}"\n}\n[END] as "body"\`
  ⚠️ This exact composition (multi-line save step + "with parameters"
  reference) is not directly confirmed in the docs read so far — flag it
  for verification in the next real run rather than asserting it
  silently works.
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
