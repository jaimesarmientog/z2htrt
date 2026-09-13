/**
 * generate.ts — calls Claude to propose test cases from inventory.json,
 * grounded in TestRigor's syntax docs and the vendored official skill
 * files (see vendor/testrigor-skills/), and writes them as one file per
 * test case under test-cases/ and rules/, following the official file
 * format:
 *   - test-cases/<title>.txt  — plain steps, filename is the title
 *   - test-cases/<title>.yaml — same, plus labels/dataset/UUID when needed
 *   - rules/<name>.txt        — reusable rule, same one-file-per-rule pattern
 *
 * The agent is propositive (design doc Section 4): it decides how many
 * happy/negative/edge cases each flow warrants, it is not given a fixed
 * checklist.
 *
 * TODO (next build step, design doc Section 9 step 5):
 *   1. Read inventory.json.
 *   2. Load grounding context from vendor/testrigor-skills/testrigor-write-tests/
 *      and the project's TestRigor documentation.
 *   3. Call the Anthropic API (ANTHROPIC_API_KEY) with that grounding,
 *      asking for test cases scoped to the auth + booking flows.
 *   4. Parse the response and write one file per proposed test case.
 *
 * Intentionally left as a stub — this is the scaffolding step, not the
 * generation implementation.
 */

async function main(): Promise<void> {
  throw new Error("generate.ts not yet implemented — see TODO above");
}

main();
