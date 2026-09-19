/**
 * generate.ts — takes tmp/inventory.json (written by crawl.ts) and asks
 * Claude to propose real testRigor test cases + reusable rules, written
 * to test-cases/generated/ and rules/generated/.
 *
 * Architecture (locked across design discussion — see project memory):
 * - One Claude call per "flow" (2 web flows + 4 API endpoints = 6 calls),
 *   never one big call covering everything.
 * - Each call may propose local rule candidates alongside its test
 *   cases. A final, separate synthesis call only dedupes/merges rule
 *   candidates across flows (e.g. PUT's and DELETE's independently
 *   proposed "get admin token" rules) — it never rewrites test case
 *   bodies. generate.ts applies the resulting name mapping itself via
 *   plain string substitution.
 * - One output file per test case. Output directories are wiped and
 *   rewritten wholesale on every run (no diffing against prior output).
 * - On a malformed/failed Claude response: retry once, then skip that
 *   unit, log it, and continue with the rest.
 *
 * ⚠️ REVIEW: crawl.ts and generate.ts currently duplicate the inventory
 * shape as hand-written interfaces. If the two ever drift, generate.ts
 * will fail confusingly at runtime rather than at compile time. Worth
 * extracting to a shared src/inventory-types.ts once the shape stabilizes.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const MODEL = "claude-sonnet-5";
// Base output budget for a normal, non-truncated call. Sonnet 5 runs
// adaptive thinking on by default, and thinking tokens count against
// this same budget — see ESCALATED_MAX_TOKENS below for how a call that
// still doesn't fit is handled, rather than us guessing an ever-bigger
// fixed number through repeated live runs.
const MAX_TOKENS = 16000;
// Retry budget used ONLY when a call's first attempt is truncated
// (stop_reason=max_tokens) — confirmed to happen even at 16000 for at
// least one unit (api:POST /booking) in real runs. 64000 is comfortably
// under the model's 128k ceiling while keeping worst-case cost bounded
// (~$0.64 at $10/MTok output for that one retried call).
const ESCALATED_MAX_TOKENS = 64000;

const INVENTORY_PATH = path.join(process.cwd(), "tmp", "inventory.json");
const TEST_CASES_DIR = path.join(process.cwd(), "test-cases", "generated");
// ⚠️ REVIEW: rules/generated mirrors test-cases/generated for
// consistency, but the exact directory the testRigor CLI expects for
// rules (push-and-run.yml's flags) hasn't been independently confirmed
// in this session — check the CLI invocation before the first real push.
const RULES_DIR = path.join(process.cwd(), "rules", "generated");
const VENDOR_SKILLS_DIR = path.join(process.cwd(), "vendor", "testrigor-skills");

// ⚠️ REVIEW: arbitrary caps to keep prompts affordable. If generated
// test cases seem to be missing grounding detail, or the vendored
// skills directory grows a lot, revisit these.
const MAX_VENDOR_SKILLS_CHARS = 20_000;
const MAX_GENERATED_TYPES_CHARS = 8_000;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------
// Inventory shape (mirrors crawl.ts's output — see ⚠️ REVIEW above)
// ---------------------------------------------------------------------

interface FieldInfo {
  label: string;
  role: string;
  type?: string;
}

interface ActionInfo {
  label: string;
  role: string;
}

interface ValidationObservation {
  scenario: string;
  inputs: Record<string, string>;
  resultText: string | null;
}

interface WebFlow {
  name: string;
  url: string;
  fields: FieldInfo[];
  actions: ActionInfo[];
  observedValidation: ValidationObservation[];
  notes?: string[];
}

interface ApiProbeObservation {
  scenario: string;
  requestSummary: string;
  status: number;
  responseText: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  authRequired: boolean;
  authNote?: string;
  observedProbes: ApiProbeObservation[];
}

interface ApiSurface {
  specSource: string;
  generatedTypes: string;
  endpoints: ApiEndpoint[];
}

interface Inventory {
  generatedAt: string;
  webFlows: WebFlow[];
  apiSurface: ApiSurface;
}

// ---------------------------------------------------------------------
// Generation units — the thing each Claude call is scoped to
// ---------------------------------------------------------------------

type UnitKind = "UI" | "API";

interface GenerationUnit {
  id: string;
  kind: UnitKind;
  /** Used in output filenames, e.g. "AdminLogin", "BookingUpdate". */
  featureLabel: string;
  /** The slice of inventory.json this unit's prompt is built from. */
  payload: unknown;
}

function apiFeatureLabel(endpoint: ApiEndpoint): string {
  // "PUT /booking/{id}" -> "BookingUpdate", "DELETE /booking/{id}" ->
  // "BookingDeletion", "POST /auth" -> "Auth", "POST /booking" ->
  // "BookingCreationApi". ⚠️ REVIEW: this mapping is hand-coded for the
  // current fixed 4-endpoint scope — it will need extending (or a more
  // generic derivation) if the API surface grows.
  const key = `${endpoint.method} ${endpoint.path}`;
  const labels: Record<string, string> = {
    "POST /auth": "Auth",
    "POST /booking": "BookingCreationApi",
    "PUT /booking/{id}": "BookingUpdate",
    "DELETE /booking/{id}": "BookingDeletion",
  };
  return labels[key] ?? key.replace(/[^a-zA-Z0-9]+/g, "");
}

function buildGenerationUnits(inventory: Inventory): GenerationUnit[] {
  const webUnits: GenerationUnit[] = inventory.webFlows.map((flow) => ({
    id: `web:${flow.name}`,
    kind: "UI",
    featureLabel: flow.name.replace(/[^a-zA-Z0-9]+/g, ""),
    payload: flow,
  }));

  // Only the relevant type slice would be ideal per endpoint, but with
  // just 4 hand-authored endpoints the full generatedTypes block is
  // small enough that per-endpoint slicing isn't worth the parsing
  // complexity yet — truncated wholesale instead. ⚠️ REVIEW if the
  // OpenAPI spec grows.
  const truncatedTypes =
    inventory.apiSurface.generatedTypes.length > MAX_GENERATED_TYPES_CHARS
      ? `${inventory.apiSurface.generatedTypes.slice(0, MAX_GENERATED_TYPES_CHARS)}\n// … truncated …`
      : inventory.apiSurface.generatedTypes;

  const apiUnits: GenerationUnit[] = inventory.apiSurface.endpoints.map((endpoint) => ({
    id: `api:${endpoint.method} ${endpoint.path}`,
    kind: "API",
    featureLabel: apiFeatureLabel(endpoint),
    payload: {
      specSource: inventory.apiSurface.specSource,
      relevantTypes: truncatedTypes,
      endpoint,
    },
  }));

  return [...webUnits, ...apiUnits];
}

// ---------------------------------------------------------------------
// Grounding context
// ---------------------------------------------------------------------

async function readVendorSkills(): Promise<string> {
  const chunks: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist locally — not fatal, just no extra grounding
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = await fs.readFile(fullPath, "utf8");
        chunks.push(`--- ${path.relative(VENDOR_SKILLS_DIR, fullPath)} ---\n${content}`);
      }
    }
  }

  await walk(VENDOR_SKILLS_DIR);

  if (chunks.length === 0) {
    console.warn(
      `readVendorSkills: no .md files found under ${VENDOR_SKILLS_DIR} — proceeding with only the ` +
        "embedded CONFIRMED_SYNTAX_NOTES for grounding. Generated test cases may be lower quality."
    );
    return "";
  }

  const combined = chunks.join("\n\n");
  return combined.length > MAX_VENDOR_SKILLS_CHARS
    ? `${combined.slice(0, MAX_VENDOR_SKILLS_CHARS)}\n… truncated …`
    : combined;
}

// Syntax verified directly against testRigor's official documentation
// during this project (not relied on from training data). Kept here as
// a guaranteed baseline even if the vendored skills directory is
// missing or incomplete in a given environment.
const CONFIRMED_SYNTAX_NOTES = `
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
  Variable interpolation ("parameters"): ANY quoted string argument that
  contains a \${varName} placeholder must be explicitly marked with
  "with parameters" right before that argument, per argument — this is
  not automatic just because \${} appears in a string. Confirmed forms:
  \`check that page contains string with parameters "My name is \${myName}"\`
  \`call api put "https://example.com/booking" with headers with parameters "Cookie:token=\${authToken}" and body "..."\`
  Each argument that needs interpolation gets its own "with parameters"
  marker; arguments without \${} in them are written normally, unmarked.
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

// ---------------------------------------------------------------------
// Claude call plumbing
// ---------------------------------------------------------------------

interface ProposedTestCase {
  description: string;
  steps: string[];
}

interface ProposedRuleCandidate {
  name: string;
  steps: string[];
}

interface FlowGenerationResult {
  unit: GenerationUnit;
  testCases: ProposedTestCase[];
  ruleCandidates: ProposedRuleCandidate[];
}

/**
 * Strips a ```json ... ``` fence if present, since models sometimes add
 * one despite being told not to.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/**
 * Thrown when a response is cut off by the token budget (stop_reason ===
 * "max_tokens") rather than by a genuine JSON/prompt problem. Carrying
 * this as a distinct error type (rather than a generic Error) is what
 * lets the retry logic below escalate the budget specifically for this
 * failure mode, instead of retrying identically and failing the same way.
 */
class TruncatedResponseError extends Error {
  constructor(public readonly maxTokensUsed: number) {
    super(`Response was truncated: stop_reason=max_tokens at max_tokens=${maxTokensUsed}.`);
    this.name = "TruncatedResponseError";
  }
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new TruncatedResponseError(maxTokens);
  }

  const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
  return textBlocks.map((block) => block.text).join("\n");
}

/**
 * Calls Claude and parses/validates its response, retrying exactly once
 * on any failure. If the first attempt was truncated specifically
 * (TruncatedResponseError), the retry uses ESCALATED_MAX_TOKENS instead
 * of repeating the same budget that just failed — there's no point
 * retrying a token-budget problem with the same token budget. Any other
 * failure (network error, malformed JSON, a validation error thrown by
 * `parse`) retries once at the normal MAX_TOKENS, unchanged. On a second
 * failure of any kind, logs and returns null so the caller can skip this
 * unit and continue, per the locked "retry once then skip" policy.
 */
async function callClaudeJsonWithRetry<T>(
  label: string,
  system: string,
  user: string,
  parse: (raw: string) => T
): Promise<T | null> {
  let nextMaxTokens = MAX_TOKENS;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callClaude(system, user, nextMaxTokens);
      return parse(raw);
    } catch (err) {
      if (attempt === 2) {
        console.error(`${label}: retry also failed — skipping.`, err);
        return null;
      }
      if (err instanceof TruncatedResponseError) {
        console.warn(
          `${label}: truncated at max_tokens=${nextMaxTokens}, retrying once with ` +
            `max_tokens=${ESCALATED_MAX_TOKENS}.`
        );
        nextMaxTokens = ESCALATED_MAX_TOKENS;
      } else {
        console.error(`${label}: first attempt failed, retrying once.`, err);
      }
    }
  }
  return null; // unreachable — satisfies TypeScript's control-flow analysis
}

function buildSystemPrompt(vendorSkills: string): string {
  return [
    "You are proposing testRigor test cases and reusable rules for the Restful-Booker Platform " +
      "(web UI at automationintesting.online, API at restful-booker.herokuapp.com). You are grounded " +
      "ONLY in the syntax references given below and the real, observed application behavior given in " +
      "the user message — never invent testRigor syntax that isn't shown here.",
    CONFIRMED_SYNTAX_NOTES,
    vendorSkills ? `# Vendored testRigor skill documentation\n\n${vendorSkills}` : "",
    "# Your task\n" +
      "Given one flow's observed data, propose as many happy-path, negative, and edge-case test " +
      "cases as you judge genuinely warranted — there is no fixed count to hit. Ground every " +
      'assertion in the observedValidation/observedProbes data given to you; never invent expected ' +
      "text or status codes that weren't actually observed. If you notice a step sequence that " +
      "would clearly be reused across the test cases you're proposing in THIS call, factor it out " +
      'as a rule candidate instead of repeating it inline. Every rule candidate\'s "name" MUST be ' +
      'prefixed with "RR - " (e.g. "RR - Navigate to user profile"), and any step that invokes a ' +
      "rule must reference that exact prefixed name.\n\n" +
      "Respond with ONLY a single JSON object (no markdown fences, no prose before or after) of " +
      "this exact shape:\n" +
      '{\n  "testCases": [ { "description": string, "steps": string[] } ],\n' +
      '  "ruleCandidates": [ { "name": string, "steps": string[] } ]\n}\n' +
      'Each test case\'s "steps" array should reference a rule candidate by its exact "name" as a ' +
      "bare step where appropriate, rather than repeating that rule's steps inline.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUserPrompt(unit: GenerationUnit): string {
  const kindNote =
    unit.kind === "UI"
      ? "This is a web UI flow. Steps should be element-interaction based (click/enter/check that page contains …)."
      : "This is an API flow. Steps should use the `call api …` syntax shown in the syntax notes. If this " +
        "endpoint requires auth (authRequired: true), assume a reusable rule that authenticates and stores " +
        "a token already exists or will exist — reference it by a clearly-named bare step (e.g. " +
        '"RR - Authenticate as admin via API") rather than inlining the POST /auth call yourself, and ' +
        "propose that authentication step as a rule candidate, using the required \"RR - \" name prefix.";

  return [
    kindNote,
    "Observed data for this flow (from a live crawl/probe — ground your test cases in this, not assumptions):",
    JSON.stringify(unit.payload, null, 2),
  ].join("\n\n");
}

async function generateForUnit(unit: GenerationUnit, systemPrompt: string): Promise<FlowGenerationResult | null> {
  return callClaudeJsonWithRetry(`generateForUnit(${unit.id})`, systemPrompt, buildUserPrompt(unit), (raw) => {
    const parsed = JSON.parse(stripCodeFence(raw)) as {
      testCases?: ProposedTestCase[];
      ruleCandidates?: ProposedRuleCandidate[];
    };
    if (!Array.isArray(parsed.testCases)) {
      throw new Error("response JSON missing a testCases array");
    }
    return {
      unit,
      testCases: parsed.testCases,
      ruleCandidates: Array.isArray(parsed.ruleCandidates) ? parsed.ruleCandidates : [],
    };
  });
}

// ---------------------------------------------------------------------
// Rule synthesis pass
// ---------------------------------------------------------------------

interface RuleSynthesisResult {
  canonicalRules: ProposedRuleCandidate[];
  /** Maps "<unitId>::<originalRuleName>" -> canonical rule name. */
  renameMap: Record<string, string>;
}

async function synthesizeRules(
  flowResults: FlowGenerationResult[],
  systemPrompt: string
): Promise<RuleSynthesisResult> {
  const allCandidates = flowResults.flatMap((result) =>
    result.ruleCandidates.map((rule) => ({ unitId: result.unit.id, ...rule }))
  );

  if (allCandidates.length === 0) {
    return { canonicalRules: [], renameMap: {} };
  }

  const synthesisSystemPrompt =
    "You are deduplicating a list of proposed testRigor reusable-rule candidates gathered from " +
    "several independent generation passes. Your ONLY job is to identify candidates that are " +
    "semantically the same rule (e.g. two independently-named 'get an admin API token' rules) and " +
    "merge each such group into one canonical rule (pick the clearest name and the most complete, " +
    'correct step sequence among the group). Every canonical rule\'s "name" MUST keep the "RR - " ' +
    "prefix (all input candidates already have it). Do not alter rules that are genuinely distinct. " +
    "Do not invent new rules. Respond with ONLY a single JSON object, no markdown fences, of this exact " +
    "shape:\n" +
    '{\n  "canonicalRules": [ { "name": string, "steps": string[] } ],\n' +
    '  "renameMap": { "<unitId>::<originalName>": "<canonicalName>" }\n}\n' +
    'Every input candidate must appear as a key in "renameMap", even ones that were already unique ' +
    "(in which case they map to themselves, unchanged).";

  const userPrompt = `Proposed rule candidates:\n\n${JSON.stringify(allCandidates, null, 2)}`;

  const result = await callClaudeJsonWithRetry("synthesizeRules", synthesisSystemPrompt, userPrompt, (raw) => {
    const parsed = JSON.parse(stripCodeFence(raw)) as {
      canonicalRules?: ProposedRuleCandidate[];
      renameMap?: Record<string, string>;
    };
    if (!Array.isArray(parsed.canonicalRules) || typeof parsed.renameMap !== "object") {
      throw new Error("response JSON missing canonicalRules array or renameMap object");
    }
    return { canonicalRules: parsed.canonicalRules, renameMap: parsed.renameMap ?? {} };
  });

  if (result) return result;

  // Deterministic fallback (per locked "skip and report" failure policy):
  // if synthesis fails twice, don't block the whole run over what is
  // ultimately a readability optimization. Keep every candidate as its
  // own rule, disambiguated by unit id, so nothing collides on write.
  console.error(
    "synthesizeRules: falling back to a no-dedup strategy — every rule candidate becomes its own " +
      "rule file, prefixed by its originating flow. Review the PR for likely-duplicate rules."
  );
  const canonicalRules: ProposedRuleCandidate[] = [];
  const renameMap: Record<string, string> = {};
  for (const candidate of allCandidates) {
    const fallbackName = `${candidate.unitId.replace(/[^a-zA-Z0-9]+/g, "-")}-${candidate.name}`;
    canonicalRules.push({ name: fallbackName, steps: candidate.steps });
    renameMap[`${candidate.unitId}::${candidate.name}`] = fallbackName;
  }
  return { canonicalRules, renameMap };
}

/**
 * Applies the rule-name rename map to a flow's test case steps via
 * plain string substitution — never re-invokes Claude for this. Matches
 * a step line that either equals the old rule name exactly, or starts
 * with the old rule name followed by a space (to allow for testRigor's
 * inline-conditional-on-a-rule syntax, e.g. "My Rule if page contains
 * …"). ⚠️ REVIEW: doesn't handle a rule name that happens to be a
 * prefix of an unrelated step — acceptable risk for the current small,
 * distinctly-named rule set, but worth a real-run check.
 */
function applyRenameToSteps(steps: string[], unitId: string, renameMap: Record<string, string>): string[] {
  return steps.map((step) => {
    const trimmed = step.trim();
    for (const [key, canonicalName] of Object.entries(renameMap)) {
      const [mapUnitId, originalName] = key.split("::");
      if (mapUnitId !== unitId) continue;
      if (trimmed === originalName) return canonicalName;
      if (trimmed.startsWith(`${originalName} `)) {
        return canonicalName + trimmed.slice(originalName.length);
      }
    }
    return step;
  });
}

// ---------------------------------------------------------------------
// File writing
// ---------------------------------------------------------------------

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function slugForFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function writeOutputs(flowResults: FlowGenerationResult[], synthesis: RuleSynthesisResult): Promise<void> {
  await resetDir(TEST_CASES_DIR);
  await resetDir(RULES_DIR);

  let testCaseCounter = 0;

  for (const result of flowResults) {
    for (const testCase of result.testCases) {
      testCaseCounter += 1;
      const renamedSteps = applyRenameToSteps(testCase.steps, result.unit.id, synthesis.renameMap);
      const fileName = `TC${testCaseCounter}-${result.unit.kind}-${result.unit.featureLabel}.txt`;
      const content = [`// ${testCase.description}`, ...renamedSteps].join("\n") + "\n";
      await fs.writeFile(path.join(TEST_CASES_DIR, fileName), content, "utf8");
    }
  }

  for (const rule of synthesis.canonicalRules) {
    const fileName = `${slugForFilename(rule.name)}.txt`;
    const content = rule.steps.join("\n") + "\n";
    await fs.writeFile(path.join(RULES_DIR, fileName), content, "utf8");
  }

  console.log(
    `Wrote ${testCaseCounter} test case file(s) to ${TEST_CASES_DIR} and ` +
      `${synthesis.canonicalRules.length} rule file(s) to ${RULES_DIR}.`
  );
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const inventoryRaw = await fs.readFile(INVENTORY_PATH, "utf8");
  const inventory = JSON.parse(inventoryRaw) as Inventory;

  const vendorSkills = await readVendorSkills();
  const systemPrompt = buildSystemPrompt(vendorSkills);

  const units = buildGenerationUnits(inventory);
  const flowResults: FlowGenerationResult[] = [];
  const skipped: string[] = [];

  // Sequential on purpose: keeps retry/backoff behavior simple and
  // avoids bursting rate limits across 6+ calls at once. ⚠️ REVIEW:
  // revisit with Promise.all + concurrency limiting if generation
  // time becomes a bottleneck.
  for (const unit of units) {
    const result = await generateForUnit(unit, systemPrompt);
    if (result) {
      flowResults.push(result);
    } else {
      skipped.push(unit.id);
    }
  }

  const synthesis = await synthesizeRules(flowResults, systemPrompt);

  await writeOutputs(flowResults, synthesis);

  if (skipped.length > 0) {
    console.error(`The following units were skipped after failing twice: ${skipped.join(", ")}`);
  }

  // Partial failure is tolerated by design (that's the point of retry-once
  // -then-skip-and-continue) — but total failure is a different thing
  // entirely: there's no "rest" to continue with, nothing gets written,
  // and the first live run showed this can otherwise exit 0 with an
  // empty output directory, which create-pull-request then silently
  // interprets as "nothing changed" rather than "generation failed."
  if (flowResults.length === 0 && units.length > 0) {
    throw new Error(
      `All ${units.length} unit(s) failed to generate — nothing was written. See the errors above ` +
        "for the actual per-unit failure cause."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});