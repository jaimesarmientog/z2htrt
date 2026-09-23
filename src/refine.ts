/**
 * refine.ts — runs after a generate.ts PR merges to main. Reads every
 * test case in test-cases/generated/ (now with full visibility across
 * ALL flows at once, unlike generate.ts's per-flow calls) and:
 *
 * 1. Extracts genuinely repeated step sequences into reusable rules,
 *    written to rules/generated/. Detection is pure deterministic line
 *    matching — no LLM involved in deciding what's a duplicate, since
 *    exact repetition is exact repetition. Claude is used for exactly
 *    one narrow thing: picking a good name for each extracted rule.
 *    Two hard structural rules constrain what can ever be extracted
 *    (see "Structural rules" below) — these came from real defects
 *    found in the first live run, not from speculation.
 * 2. Replaces hardcoded literal data — known base URLs, `enter "..."
 *    into "..."` values, and string values inside JSON request bodies —
 *    with suite-level parameter references, and produces a manifest
 *    (docs/test-data-needed.md) of what needs to be added to testRigor's
 *    Test Data section before these tests can run.
 *
 * Structural rules (both are hard constraints, not heuristics to tune):
 * - A multi-line `save text ... [END] as "..."` block is one atomic
 *   logical step. It can be matched/extracted as a whole (identical
 *   payload reused verbatim across tests) but can NEVER be split
 *   mid-block — that's exactly how the first live run produced rule
 *   files containing truncated, syntactically-broken JSON.
 * - An assertion line (`check that ...`) can NEVER be part of an
 *   extracted sequence. If a test case's own validation gets absorbed
 *   into a shared rule, the test case loses its stated purpose — the
 *   rule becomes the real test, and the file that's supposed to
 *   document "this is what I'm testing" no longer does.
 *
 * This never touches test-cases/generated/'s *existence* the way
 * generate.ts does (no wipe-and-rewrite) — it edits the files already
 * there in place. It should only ever run after a generate.ts PR has
 * merged, so it's working from approved content, not mid-review content.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIRMED_SYNTAX_NOTES } from "./testrigor-syntax.js";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16000; // naming candidates is a small, bounded task — see generate.ts for why this number
const TEST_CASES_DIR = path.join(process.cwd(), "test-cases", "generated");
const RULES_DIR = path.join(process.cwd(), "rules", "generated");
const TEST_DATA_MANIFEST_PATH = path.join(process.cwd(), "docs", "test-data-needed.md");

// Known literal base URLs, mirroring crawl.ts's own defaults/env vars.
// Kept as a small fixed table (not general literal-clustering) because
// this project's scope is a fixed, known app surface.
const KNOWN_BASE_URLS: Array<{ literal: string; paramName: string }> = [
  { literal: process.env.TESTRIGOR_APP_URL ?? "https://automationintesting.online", paramName: "appBaseUrl" },
  { literal: process.env.RESTFUL_BOOKER_API_BASE ?? "https://restful-booker.herokuapp.com", paramName: "apiBaseUrl" },
];

// Minimum number of occurrences before something (a step sequence, or a
// literal data value) is proposed as a rule/parameter. Confirmed
// adequate at 2 — even a single future test case reusing a candidate
// justifies surfacing it early; manual PR review is the real quality
// gate, not this threshold (Jaime reviews every refinement PR as an
// auditor before merging, deliberately not auto-merged).
const MIN_OCCURRENCES = 2;
// A single repeated LINE is a perfectly legitimate rule (confirmed by
// a real, useful one-line rule already in production:
// "RR - Authenticate as admin via API"). This used to be 2, out of
// caution about re-extracting a JSON-block fragment — but that risk is
// now fully handled by parseLogicalSteps' atomicity guarantee (a block
// can never appear as an independent 1-line step to begin with), so
// restricting length here no longer buys any safety, only misses
// legitimate single-line rules.
const MIN_SEQUENCE_LENGTH = 1;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------
// Reading test cases — logical steps, not raw lines
// ---------------------------------------------------------------------

export interface TestCaseFile {
  fileName: string;
  filePath: string;
  header: string; // the leading `// description` line, kept as-is
  steps: string[]; // one entry per LOGICAL step — a multi-line [END]
  // block is a single entry containing embedded "\n", never split
}

/**
 * Groups raw file lines into logical steps: everything from a line
 * ending in "ending with [END]" through the line that starts with
 * "[END]" is collapsed into one array entry (joined with "\n"). Every
 * other line is its own entry. This is what makes the multi-line JSON
 * block atomic for every downstream operation in this file — matching,
 * extraction, and parameterization all operate on these logical steps,
 * never on raw lines, so a block can never be partially matched or
 * partially spliced.
 */
export function parseLogicalSteps(rawLines: string[]): string[] {
  const logical: string[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    // NOT anchored to end-of-line: the confirmed instructed format puts
    // the "as \"varName\"\" clause on the CLOSING line, but Claude has
    // been observed putting it on the OPENING line instead (right after
    // "[END]"). An anchored match would silently fail to recognize that
    // variant as a block-opener at all, un-atomizing the whole block —
    // exactly how a prior run produced a rule containing only a
    // trailing "}" + "[END]" fragment. Matching anywhere in the line
    // handles either placement.
    if (/ending with \[END\]/.test(line.trim())) {
      const blockLines = [line];
      i++;
      while (i < rawLines.length) {
        blockLines.push(rawLines[i]);
        const isEndLine = rawLines[i].trim().startsWith("[END]");
        i++;
        if (isEndLine) break;
      }
      logical.push(blockLines.join("\n"));
    } else {
      logical.push(line);
      i++;
    }
  }
  return logical;
}

/**
 * Finds the variable name a JSON block was saved as, checking both the
 * opening and closing line — robust to Claude's observed inconsistency
 * about which line carries the `as "varName"` clause. Only checks these
 * two specific lines (not the whole block) to avoid false-matching JSON
 * content that coincidentally contains the literal text `as "..."`.
 */
export function extractBlockVarName(step: string): string | null {
  const lines = step.split("\n");
  for (const candidate of [lines[0], lines[lines.length - 1]]) {
    const match = candidate?.match(/\bas\s+"([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

async function readTestCaseFiles(): Promise<TestCaseFile[]> {
  const entries = await fs.readdir(TEST_CASES_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".txt"));

  const testCases: TestCaseFile[] = [];
  for (const entry of files) {
    const filePath = path.join(TEST_CASES_DIR, entry.name);
    const content = await fs.readFile(filePath, "utf8");
    const rawLines = content.split("\n").filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "");
    const [header, ...bodyLines] = rawLines;
    testCases.push({ fileName: entry.name, filePath, header: header ?? "", steps: parseLogicalSteps(bodyLines) });
  }
  return testCases;
}

/**
 * A logical step counts as an assertion if its first line starts with
 * "check" — testRigor's plain-English assertion vocabulary
 * consistently starts this way in every confirmed example we have
 * (`check that page contains ...`, `check that http code is ...`,
 * `check that stored value ... itself contains ...`). This is a
 * word-prefix heuristic, not a parsed grammar — flagged in case a
 * future testRigor construct doesn't follow the convention.
 */
export function isAssertionStep(step: string): boolean {
  return step.trim().toLowerCase().startsWith("check");
}

// ---------------------------------------------------------------------
// Deterministic repeated-sequence detection (rules)
// ---------------------------------------------------------------------

interface SequenceOccurrence {
  fileIndex: number;
  startLine: number; // index into that file's logical steps array
  length: number; // in logical steps, not raw lines
}

interface RepeatedSequence {
  steps: string[];
  occurrences: SequenceOccurrence[];
}

/**
 * Finds every contiguous LOGICAL-STEP sequence (length >=
 * MIN_SEQUENCE_LENGTH) that occurs at least MIN_OCCURRENCES times
 * across all files combined, then greedily keeps only the longest
 * non-overlapping matches. Two structural exclusions, both hard rules:
 * a candidate sequence containing an assertion step is never considered
 * at all, and because matching operates on logical steps (not raw
 * lines), a multi-line JSON block can only ever match/extract as one
 * whole unit — never a fragment of one.
 */
export function findRepeatedSequences(testCases: TestCaseFile[]): RepeatedSequence[] {
  const occurrencesByKey = new Map<string, SequenceOccurrence[]>();
  const maxLength = Math.max(...testCases.map((tc) => tc.steps.length), 0);

  for (let length = MIN_SEQUENCE_LENGTH; length <= maxLength; length++) {
    testCases.forEach((tc, fileIndex) => {
      for (let start = 0; start + length <= tc.steps.length; start++) {
        const slice = tc.steps.slice(start, start + length);
        if (slice.some(isAssertionStep)) continue; // hard exclusion — see file header
        const key = `${length}::${slice.join("\n")}`;
        const list = occurrencesByKey.get(key) ?? [];
        list.push({ fileIndex, startLine: start, length });
        occurrencesByKey.set(key, list);
      }
    });
  }

  const candidates: RepeatedSequence[] = [];
  for (const [key, occurrences] of occurrencesByKey) {
    if (occurrences.length < MIN_OCCURRENCES) continue;
    const length = Number(key.split("::")[0]);
    const steps = testCases[occurrences[0].fileIndex].steps.slice(
      occurrences[0].startLine,
      occurrences[0].startLine + length
    );
    candidates.push({ steps, occurrences });
  }

  // Longest sequences first, so the greedy claim pass below prefers them.
  candidates.sort((a, b) => b.steps.length - a.steps.length);

  const claimed = new Set<string>(); // `${fileIndex}:${stepIndex}`
  const accepted: RepeatedSequence[] = [];

  for (const candidate of candidates) {
    const unclaimedOccurrences = candidate.occurrences.filter((occ) => {
      for (let i = 0; i < occ.length; i++) {
        if (claimed.has(`${occ.fileIndex}:${occ.startLine + i}`)) return false;
      }
      return true;
    });
    if (unclaimedOccurrences.length < MIN_OCCURRENCES) continue;

    for (const occ of unclaimedOccurrences) {
      for (let i = 0; i < occ.length; i++) {
        claimed.add(`${occ.fileIndex}:${occ.startLine + i}`);
      }
    }
    accepted.push({ steps: candidate.steps, occurrences: unclaimedOccurrences });
  }

  return accepted;
}

// ---------------------------------------------------------------------
// Naming extracted rules (the one narrow use of Claude in this script)
// ---------------------------------------------------------------------

interface NamedRule {
  name: string; // includes the "RR - " prefix
  description: string; // becomes the rule file's "// ..." header, same convention as test cases
  steps: string[];
}

interface NamedRuleWithOccurrences extends NamedRule {
  occurrences: SequenceOccurrence[];
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/** Deterministic fallback name/description, used if the naming call fails twice. */
function fallbackRuleName(index: number): string {
  return `RR - Shared steps ${index + 1}`;
}
function fallbackRuleDescription(steps: string[]): string {
  return `Shared steps: ${steps[0]?.split("\n")[0] ?? "(no steps)"}${steps.length > 1 ? " and more" : ""}`;
}

async function nameRules(sequences: RepeatedSequence[]): Promise<NamedRule[]> {
  if (sequences.length === 0) return [];

  const system = [
    "You are naming and describing testRigor reusable rules that have already been mechanically " +
      "extracted from repeated step sequences — the extraction itself is done; your only job is to " +
      "give each one a clear, human-readable name and a one-line description, the same way each test " +
      "case file already carries a `// description` header.",
    CONFIRMED_SYNTAX_NOTES,
    'Respond with ONLY a JSON array (no markdown fences, no prose) of exactly one ' +
      '{ "name": string, "description": string } object per input sequence, in the same order. Each ' +
      '"name" MUST already include the required "RR - " prefix; "description" should read like a test ' +
      'case header comment — what this rule does, not just a restatement of its name. Example:\n' +
      '[{ "name": "RR - Authenticate as admin via API", "description": "Authenticates via POST /auth ' +
      'with the shared admin credentials and saves the resulting token" }]',
  ].join("\n\n");

  const user = `Sequences to name (each is an array of step lines — a single string containing "\\n" is one multi-line step, e.g. a JSON body block):\n\n${JSON.stringify(
    sequences.map((s) => s.steps),
    null,
    2
  )}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      });
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const parsed = JSON.parse(stripCodeFence(raw)) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length !== sequences.length ||
        !parsed.every((n) => n && typeof n.name === "string" && typeof n.description === "string")
      ) {
        throw new Error(`expected an array of ${sequences.length} {name, description} objects, got: ${raw}`);
      }
      const named = parsed as Array<{ name: string; description: string }>;
      return sequences.map((seq, i) => ({ name: named[i].name, description: named[i].description, steps: seq.steps }));
    } catch (err) {
      console.error(`nameRules: attempt ${attempt} failed.`, err);
    }
  }

  console.error("nameRules: both attempts failed — falling back to generic names/descriptions for all extracted rules.");
  return sequences.map((seq, i) => ({ name: fallbackRuleName(i), description: fallbackRuleDescription(seq.steps), steps: seq.steps }));
}

// ---------------------------------------------------------------------
// Applying rule extraction back into the test case files
// ---------------------------------------------------------------------

/**
 * Replaces each occurrence's logical-step range with a single bare
 * invocation line, working from the end of each file backward so
 * earlier indices within the same file stay valid as steps are removed.
 */
export function applyExtraction(testCases: TestCaseFile[], namedRules: NamedRuleWithOccurrences[]): void {
  const byFile = new Map<number, Array<{ startLine: number; length: number; ruleName: string }>>();

  for (const rule of namedRules) {
    for (const occ of rule.occurrences) {
      const list = byFile.get(occ.fileIndex) ?? [];
      list.push({ startLine: occ.startLine, length: occ.length, ruleName: rule.name });
      byFile.set(occ.fileIndex, list);
    }
  }

  for (const [fileIndex, replacements] of byFile) {
    replacements.sort((a, b) => b.startLine - a.startLine);
    const steps = testCases[fileIndex].steps;
    for (const { startLine, length, ruleName } of replacements) {
      steps.splice(startLine, length, ruleName);
    }
  }
}

/**
 * Safety net, not the primary mechanism (the primary mechanism is
 * findRepeatedSequences never considering an assertion step
 * extractable in the first place). Warns loudly — doesn't fail the
 * run — if a test case ends up with no assertion step of its own after
 * extraction, since that would mean the file no longer documents its
 * own purpose.
 */
function warnIfMissingOwnAssertion(testCases: TestCaseFile[]): void {
  for (const tc of testCases) {
    if (!tc.steps.some(isAssertionStep)) {
      console.warn(
        `⚠️  ${tc.fileName} has no assertion step of its own after refinement — its purpose may now ` +
          "live entirely inside a reusable rule. Flag this for review rather than merging as-is."
      );
    }
  }
}

// ---------------------------------------------------------------------
// Test Data candidates: base URLs, entered values, and JSON body values
// ---------------------------------------------------------------------

/**
 * Anything with a mutable steps array — both TestCaseFile and
 * NamedRuleWithOccurrences satisfy this shape. Parameterization (base
 * URLs, data values) operates on this generic type so it applies
 * uniformly to whatever survives as test-case content AND whatever got
 * extracted into a rule — the first live run's real bug was
 * parameterization only ever touching test cases, never rules, so
 * anything pulled into a rule before parameterization ran kept its
 * hardcoded literal forever.
 */
interface StepContainer {
  steps: string[];
}

interface TestDataNeeded {
  name: string;
  exampleValue: string;
}

interface DataValueOccurrence {
  fileIndex: number;
  stepIndex: number;
  /** How to splice the replacement back in — see applyDataValueReplacements. */
  kind: "enter-into" | "json-value";
  /** For json-value: the exact JSON string-literal text (with quotes) to replace. */
  jsonLiteral?: string;
}

interface DataValueCandidate {
  value: string;
  contextName: string; // field label or JSON key, used to derive the variable name
  occurrences: DataValueOccurrence[];
}

function toCamelCase(label: string): string {
  const words = label
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "value";
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join("")
  );
}

const ENTER_INTO_PATTERN = /^enter "([^"]*)" into "([^"]*)"/;

/**
 * Recursively collects {jsonKey -> literalStringText} for every leaf
 * STRING value in a parsed JSON object — numbers/booleans are left
 * alone (Jaime's ask was specifically about names, last names, and long
 * strings, not numeric fields like totalprice). jsonLiteral is the
 * exact quoted-and-escaped text as it appears in the source, e.g.
 * `"Jane"`, so it can be found-and-replaced safely even if the same
 * value appears elsewhere unescaped.
 */
function collectJsonStringLeaves(node: unknown, keyPath: string, out: Array<{ key: string; value: string }>): void {
  if (typeof node === "string") {
    out.push({ key: keyPath, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectJsonStringLeaves(item, `${keyPath}${i}`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      collectJsonStringLeaves(v, k, out);
    }
  }
}

/**
 * Given a logical step that IS a `save text ... [END] as "..."` block,
 * extracts and JSON.parses its interior content. Returns null (rather
 * than throwing) if the block isn't valid JSON — e.g. it already
 * contains a ${var} placeholder from a previous parameterization pass,
 * which makes it invalid JSON syntax. That's expected, not an error.
 */
function tryParseJsonBlock(step: string): unknown | null {
  const lines = step.split("\n");
  const endIndex = lines.findIndex((l) => l.trim().startsWith("[END]"));
  if (endIndex <= 1) return null; // no interior content, or malformed
  const interior = lines.slice(1, endIndex).join("\n");
  try {
    return JSON.parse(interior);
  } catch {
    return null;
  }
}

function isJsonBlockStep(step: string): boolean {
  return /ending with \[END\]/.test(step.split("\n")[0].trim());
}

// ---------------------------------------------------------------------
// Whole-JSON-body Test Data candidates (Jaime's ask: testRigor allows
// multi-line stored values, so a JSON body used verbatim across >= 2
// test cases should become ONE shared Test Data variable, with the
// per-test-case "save text ... as ..." step removed entirely, rather
// than every test case re-declaring its own identical copy).
// ---------------------------------------------------------------------

interface SharedJsonBodyOccurrence {
  containerIndex: number;
  stepIndex: number;
  /** The local variable name this occurrence's block was saved as (from either the opening or closing line), if any. */
  oldVarName: string | null;
}

interface SharedJsonBodyCandidate {
  /** Parsed-and-restringified form, used only for equality comparison. */
  canonicalKey: string;
  /** The original, human-formatted interior text from the first occurrence — used as the Test Data example value. */
  displayText: string;
  occurrences: SharedJsonBodyOccurrence[];
}

/**
 * Stringifies a parsed JSON value with object keys sorted recursively,
 * so two objects with identical data but different field ordering
 * (plausible — Claude isn't perfectly consistent about this across
 * separate calls) still produce the same canonical key. Plain
 * JSON.stringify preserves insertion order and would incorrectly treat
 * such pairs as different.
 */
function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Finds JSON body blocks whose content is byte-for-byte identical
 * (after parsing, so incidental whitespace differences don't prevent a
 * match) across at least MIN_OCCURRENCES occurrences. Comparison is by
 * parsed value, not raw text, so two blocks with the same data but
 * different formatting still correctly match.
 */
export function findSharedJsonBodyCandidates(containers: StepContainer[]): SharedJsonBodyCandidate[] {
  const byKey = new Map<string, SharedJsonBodyCandidate>();

  containers.forEach((container, containerIndex) => {
    container.steps.forEach((step, stepIndex) => {
      if (!isJsonBlockStep(step)) return;
      const parsed = tryParseJsonBlock(step);
      if (parsed === null) return; // not valid JSON (e.g. already parameterized elsewhere) — skip

      const canonicalKey = canonicalizeJson(parsed);
      const lines = step.split("\n");
      const endIndex = lines.findIndex((l) => l.trim().startsWith("[END]"));
      const displayText = lines.slice(1, endIndex).join("\n");
      const occ: SharedJsonBodyOccurrence = { containerIndex, stepIndex, oldVarName: extractBlockVarName(step) };

      const existing = byKey.get(canonicalKey);
      if (existing) {
        existing.occurrences.push(occ);
      } else {
        byKey.set(canonicalKey, { canonicalKey, displayText, occurrences: [occ] });
      }
    });
  });

  return [...byKey.values()].filter((c) => c.occurrences.length >= MIN_OCCURRENCES);
}

function fallbackJsonBodyName(index: number): string {
  return `sharedRequestBody${index + 1}`;
}

/**
 * Names shared JSON body variables via Claude — same narrow-use pattern
 * as nameRules (naming is the one thing that benefits from judgment;
 * detection itself is already done deterministically). Falls back to a
 * generic but valid name if the call fails twice, same policy as rules.
 */
async function nameSharedJsonBodies(candidates: SharedJsonBodyCandidate[]): Promise<string[]> {
  if (candidates.length === 0) return [];

  const system = [
    "You are naming shared testRigor Test Data variables that hold a JSON request body used " +
      "identically across multiple test cases — the deduplication itself is already done; your only " +
      "job is to give each one a clear, human-readable camelCase variable name (e.g. " +
      '"validBookingPayload", "adminAuthCredentials").',
    'Respond with ONLY a JSON array of strings (no markdown fences, no prose), one name per input, ' +
      "in the same order.",
  ].join("\n\n");

  const user = `JSON bodies to name:\n\n${JSON.stringify(candidates.map((c) => c.displayText), null, 2)}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      });
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const names = JSON.parse(stripCodeFence(raw)) as unknown;
      if (!Array.isArray(names) || names.length !== candidates.length || !names.every((n) => typeof n === "string")) {
        throw new Error(`expected an array of ${candidates.length} strings, got: ${raw}`);
      }
      return names as string[];
    } catch (err) {
      console.error(`nameSharedJsonBodies: attempt ${attempt} failed.`, err);
    }
  }

  console.error("nameSharedJsonBodies: both attempts failed — falling back to generic names.");
  return candidates.map((_, i) => fallbackJsonBodyName(i));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes any of several syntactically-valid-but-different ways a
 * body reference to oldVarName might have been written into ONE
 * canonical form (`body from stored value "..."`, matching the general
 * confirmed "from stored value" pattern). This is necessary, not
 * cosmetic: two occurrences referencing the exact same shared variable
 * through different (individually valid) surface syntax look different
 * to findRepeatedSequences' plain-text matching, silently preventing
 * them from ever collapsing into one rule invocation — confirmed from a
 * real PR where a rule and a test case both correctly used the shared
 * variable but never got recognized as duplicates because one used
 * `${var}` interpolation and the other used `from stored value "var"`.
 */
function normalizeBodyReference(step: string, oldVarName: string, newVarName: string): string {
  const escaped = escapeRegExp(oldVarName);
  const patterns: RegExp[] = [
    new RegExp(`\\bbody\\s+with parameters\\s+\\$\\{${escaped}\\}`),
    new RegExp(`\\bbody\\s+from stored value\\s+"${escaped}"`),
    new RegExp(`\\bbody\\s+from the string with parameters\\s+"\\$\\{${escaped}\\}"`),
    new RegExp(`\\bbody\\s+stored value\\s+"${escaped}"`), // in case "from" was omitted somewhere
  ];
  for (const pattern of patterns) {
    if (pattern.test(step)) {
      return step.replace(pattern, `body from stored value "${newVarName}"`);
    }
  }
  return step;
}

/**
 * Removes each matched "save text ... as ..." step entirely (the value
 * now lives in Test Data, so no per-test-case save step is needed), and
 * normalizes every reference to that occurrence's old local variable
 * name to the ONE canonical form regardless of which valid syntax the
 * original used (see normalizeBodyReference). Processes removals within
 * each container in descending step-index order so earlier indices stay
 * valid as later steps are spliced out.
 */
export function applySharedJsonBodyReplacements(containers: StepContainer[], candidates: SharedJsonBodyCandidate[], names: string[]): void {
  const removalsByContainer = new Map<number, Array<{ stepIndex: number; oldVarName: string | null; newVarName: string }>>();

  candidates.forEach((candidate, i) => {
    const newVarName = names[i];
    for (const occ of candidate.occurrences) {
      const list = removalsByContainer.get(occ.containerIndex) ?? [];
      list.push({ stepIndex: occ.stepIndex, oldVarName: occ.oldVarName, newVarName });
      removalsByContainer.set(occ.containerIndex, list);
    }
  });

  for (const [containerIndex, removals] of removalsByContainer) {
    const container = containers[containerIndex];

    for (const { oldVarName, newVarName } of removals) {
      if (!oldVarName) continue;
      container.steps = container.steps.map((step) => normalizeBodyReference(step, oldVarName, newVarName));
    }

    const sortedRemovals = [...removals].sort((a, b) => b.stepIndex - a.stepIndex);
    for (const { stepIndex } of sortedRemovals) {
      container.steps.splice(stepIndex, 1);
    }
  }
}

/**
 * Scans every test case for two known-safe patterns of hardcoded data:
 * `enter "<value>" into "<field>"` steps, and string leaf values inside
 * JSON body blocks. Grouped by (contextName, value): a UI field labeled
 * "Firstname" and a JSON key "firstname" both camelCase to the same
 * contextName, so an identical value used in both places (e.g. "Jane"
 * entered into a form AND sent as a JSON firstname) correctly merges
 * into ONE shared variable — that's desirable, not accidental
 * conflation, since it means one Test Data entry covers both places
 * the same semantic value shows up. Two DIFFERENT values never merge,
 * even under the same contextName (keyed by contextName + value
 * together), so this stays safe: only genuinely identical data merges.
 */
export function findDataValueCandidates(testCases: StepContainer[]): DataValueCandidate[] {
  const byKey = new Map<string, DataValueCandidate>();

  const record = (contextName: string, value: string, occ: DataValueOccurrence) => {
    const key = `${contextName}::${value}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences.push(occ);
    } else {
      byKey.set(key, { value, contextName, occurrences: [occ] });
    }
  };

  testCases.forEach((tc, fileIndex) => {
    tc.steps.forEach((step, stepIndex) => {
      const enterMatch = step.match(ENTER_INTO_PATTERN);
      if (enterMatch) {
        const [, value, field] = enterMatch;
        if (value.length > 0) {
          record(toCamelCase(field), value, { fileIndex, stepIndex, kind: "enter-into" });
        }
        return;
      }

      if (isJsonBlockStep(step)) {
        const parsed = tryParseJsonBlock(step);
        if (parsed === null) return;
        const leaves: Array<{ key: string; value: string }> = [];
        collectJsonStringLeaves(parsed, "", leaves);
        for (const { key, value } of leaves) {
          if (value.length === 0) continue;
          record(toCamelCase(key), value, {
            fileIndex,
            stepIndex,
            kind: "json-value",
            jsonLiteral: JSON.stringify(value),
          });
        }
      }
    });
  });

  return [...byKey.values()].filter((c) => c.occurrences.length >= MIN_OCCURRENCES);
}

/** Disambiguates variable names when two different values want the same context-derived name. */
export function assignVariableNames(candidates: DataValueCandidate[]): Map<DataValueCandidate, string> {
  const assigned = new Map<DataValueCandidate, string>();
  const usedNames = new Map<string, number>();
  for (const candidate of candidates) {
    const base = candidate.contextName;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    assigned.set(candidate, count === 0 ? base : `${base}${count + 1}`);
  }
  return assigned;
}

/**
 * Applies the enter-into and json-value replacements in place.
 * enter-into is always a WHOLE-VALUE substitution (the entire quoted
 * argument IS the variable, nothing else concatenated), so it uses the
 * confirmed simple form: `enter stored value "varName" into "field"` —
 * no ${}, no "with parameters". json-value stays on ${} interpolation
 * since that's the only mechanism available inside a raw text block
 * (you can't write `stored value "x"` as a JSON string value) — marks
 * the block's trigger line with "with parameters" the first time any
 * of its values get parameterized.
 */
export function applyDataValueReplacements(
  containers: StepContainer[],
  candidates: DataValueCandidate[],
  varNames: Map<DataValueCandidate, string>
): void {
  const markedJsonSteps = new Set<string>();

  for (const candidate of candidates) {
    const varName = varNames.get(candidate)!;
    for (const occ of candidate.occurrences) {
      const step = containers[occ.fileIndex].steps[occ.stepIndex];

      if (occ.kind === "enter-into") {
        containers[occ.fileIndex].steps[occ.stepIndex] = step.replace(
          ENTER_INTO_PATTERN,
          `enter stored value "${varName}" into "$2"`
        );
        continue;
      }

      // json-value: replace the exact quoted literal inside the block,
      // and mark the trigger line with "with parameters" once.
      const lines = step.split("\n");
      const literalIndex = lines.findIndex((l) => l.includes(occ.jsonLiteral!));
      if (literalIndex === -1) continue; // already replaced by an earlier candidate touching the same text
      lines[literalIndex] = lines[literalIndex].replace(occ.jsonLiteral!, `"\${${varName}}"`);

      const fileStepKey = `${occ.fileIndex}:${occ.stepIndex}`;
      if (!markedJsonSteps.has(fileStepKey) && !/with parameters/.test(lines[0])) {
        lines[0] = lines[0].replace("starting from next line", "with parameters starting from next line");
        markedJsonSteps.add(fileStepKey);
      }
      containers[occ.fileIndex].steps[occ.stepIndex] = lines.join("\n");
    }
  }
}

/**
 * Finds the first quoted "..." argument in a step whose content
 * includes the given literal. Returns the full quoted match (with
 * quotes) and its inner content, so callers can distinguish a
 * WHOLE-VALUE match (content === literal exactly) from a COMPOSITE one
 * (literal glued to other text) and choose the correct confirmed
 * syntax for each — see CONFIRMED_SYNTAX_NOTES's stored-value section.
 */
function findQuotedArgumentContaining(step: string, literal: string): { fullMatch: string; content: string } | null {
  const regex = /"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(step))) {
    if (match[1].includes(literal)) {
      return { fullMatch: match[0], content: match[1] };
    }
  }
  return null;
}

/**
 * Parameterizes known base URLs, choosing the correct confirmed syntax
 * per command rather than one generic substitution:
 * - `open url`: whole-value -> `open url from stored value "paramName"`
 *   (confirmed general pattern for most commands, though `enter` is a
 *   confirmed exception that omits "from" — see CONFIRMED_SYNTAX_NOTES);
 *   composite (URL + path) -> `open url from string with parameters
 *   "..."` (no "the" — confirmed to differ from enter/call api).
 * - `call api <method>`: always the composite form (`from the string
 *   with parameters`), since a whole-value "stored value" form isn't
 *   confirmed for this command — the composite form is confirmed safe
 *   whether or not there's a path suffix.
 * - Any other verb context containing the literal is left untouched
 *   and logged, rather than guessing at unconfirmed syntax — still
 *   added to the Test Data manifest, since the variable is still
 *   needed even if this one occurrence couldn't be safely auto-rewritten.
 */
export function parameterizeBaseUrls(containers: StepContainer[]): TestDataNeeded[] {
  const needed = new Map<string, TestDataNeeded>();

  for (const container of containers) {
    container.steps = container.steps.map((step) => {
      let updated = step;
      for (const { literal, paramName } of KNOWN_BASE_URLS) {
        if (!updated.includes(literal)) continue;

        const found = findQuotedArgumentContaining(updated, literal);
        if (!found) {
          console.warn(`parameterizeBaseUrls: "${literal}" found outside any quoted argument, skipping: ${updated}`);
          continue;
        }

        needed.set(paramName, { name: paramName, exampleValue: literal });
        const isWholeValue = found.content === literal;
        const placeholderContent = found.content.split(literal).join(`\${${paramName}}`);

        if (/^open url\b/.test(updated)) {
          updated = isWholeValue
            ? updated.replace(found.fullMatch, `from stored value "${paramName}"`)
            : updated.replace(found.fullMatch, `"${placeholderContent}"`).replace(/^open url /, "open url from string with parameters ");
        } else if (/^call api \w+ /.test(updated)) {
          updated = updated
            .replace(found.fullMatch, `"${placeholderContent}"`)
            .replace(/^call api (\w+) /, "call api $1 from the string with parameters ");
        } else {
          console.warn(
            `parameterizeBaseUrls: "${paramName}" found in an unrecognized step context, leaving unparameterized ` +
              `(still added to the Test Data manifest): ${updated}`
          );
        }
      }
      return updated;
    });
  }

  return [...needed.values()];
}

async function writeTestDataManifest(entries: TestDataNeeded[]): Promise<void> {
  await fs.mkdir(path.dirname(TEST_DATA_MANIFEST_PATH), { recursive: true });

  if (entries.length === 0) {
    await fs.writeFile(
      TEST_DATA_MANIFEST_PATH,
      "# Test Data needed\n\nNone — no new suite-level variables were introduced by this refinement pass.\n",
      "utf8"
    );
    return;
  }

  const lines = [
    "# Test Data needed",
    "",
    "This refinement pass parameterized the following values. Before running these test cases, " +
      "add each of these to the suite's **Test Data** section in the testRigor UI:",
    "",
  ];
  for (const e of entries) {
    if (e.exampleValue.includes("\n")) {
      lines.push(`- \`${e.name}\`:`, "  ```json", ...e.exampleValue.split("\n").map((l) => `  ${l}`), "  ```");
    } else {
      lines.push(`- \`${e.name}\` → \`${e.exampleValue}\``);
    }
  }
  lines.push("");
  await fs.writeFile(TEST_DATA_MANIFEST_PATH, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------
// Writing rule files and updated test cases
// ---------------------------------------------------------------------

function slugForFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function writeRules(namedRules: NamedRuleWithOccurrences[]): Promise<void> {
  await resetDir(RULES_DIR);
  for (const rule of namedRules) {
    const fileName = `${slugForFilename(rule.name)}.txt`;
    const content = [`// ${rule.description}`, ...rule.steps].join("\n") + "\n";
    await fs.writeFile(path.join(RULES_DIR, fileName), content, "utf8");
  }
}

async function writeUpdatedTestCases(testCases: TestCaseFile[]): Promise<void> {
  for (const tc of testCases) {
    const content = [tc.header, ...tc.steps].join("\n") + "\n";
    await fs.writeFile(tc.filePath, content, "utf8");
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const testCases = await readTestCaseFiles();
  if (testCases.length === 0) {
    console.log(`No test case files found in ${TEST_CASES_DIR} — nothing to refine.`);
    return;
  }

  // Parameterize/normalize FIRST, extract rules SECOND — this order
  // matters and is a deliberate fix, not an arbitrary choice. Doing it
  // the other way around (as an earlier version of this file did) let a
  // real bug through: two occurrences of the exact same shared value,
  // written in two different (individually valid) surface syntaxes,
  // looked different to findRepeatedSequences' plain-text matching and
  // silently failed to collapse into one rule. Normalizing every
  // hardcoded value into ONE consistent syntax before rule-matching
  // even runs means whatever ends up in a rule is already-normalized —
  // no separate "reach into already-extracted rules" pass is needed
  // anymore either, since rules are now built FROM normalized content.
  const sharedJsonBodyCandidates = findSharedJsonBodyCandidates(testCases);
  const sharedJsonBodyNames = await nameSharedJsonBodies(sharedJsonBodyCandidates);
  applySharedJsonBodyReplacements(testCases, sharedJsonBodyCandidates, sharedJsonBodyNames);
  const sharedJsonBodyManifestEntries: TestDataNeeded[] = sharedJsonBodyCandidates.map((c, i) => ({
    name: sharedJsonBodyNames[i],
    exampleValue: c.displayText,
  }));

  const dataValueCandidates = findDataValueCandidates(testCases);
  const dataValueVarNames = assignVariableNames(dataValueCandidates);
  applyDataValueReplacements(testCases, dataValueCandidates, dataValueVarNames);
  const dataValueManifestEntries: TestDataNeeded[] = dataValueCandidates.map((c) => ({
    name: dataValueVarNames.get(c)!,
    exampleValue: c.value,
  }));

  const urlManifestEntries = parameterizeBaseUrls(testCases);

  // NOW extract rules, from the fully-normalized test cases.
  const sequences = findRepeatedSequences(testCases);
  const named = await nameRules(sequences);
  const namedWithOccurrences: NamedRuleWithOccurrences[] = named.map((rule, i) => ({
    ...rule,
    occurrences: sequences[i].occurrences,
  }));
  applyExtraction(testCases, namedWithOccurrences);
  warnIfMissingOwnAssertion(testCases);

  await writeRules(namedWithOccurrences);
  await writeUpdatedTestCases(testCases);
  await writeTestDataManifest([...urlManifestEntries, ...sharedJsonBodyManifestEntries, ...dataValueManifestEntries]);

  console.log(
    `Extracted ${namedWithOccurrences.length} rule(s) to ${RULES_DIR}, parameterized ` +
      `${urlManifestEntries.length} base URL(s), ${sharedJsonBodyManifestEntries.length} shared JSON ` +
      `bod(y/ies), and ${dataValueManifestEntries.length} data value(s), and wrote ${TEST_DATA_MANIFEST_PATH}.`
  );
}

// Standard ESM "is this the entry point" guard — lets this file be run
// directly (`tsx src/refine.ts`, which is all the real pipeline ever
// does) while also being safely importable by tests without triggering
// a real run. This replaces an earlier approach that kept a whole
// separate testable copy of this file, which risked drifting out of
// sync with the real one — a single guarded file is simpler and safer.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
