/**
 * Exit statuses and output (OC4): each ending's status and record, printed as one JSON object with `--json`
 * or one fact per line without it, the call layer's ending unchanged.
 *
 * `ending`, `operation` - the command's operation as declared - and `invocation` - the identity the command
 * fixed, under which `run` made its first call - lead every record; then the fields of its ending: `answer`;
 * `refusal`; `agpCode`, `proxyCode` and `earlierAttemptsUncertain`; or `reason`, `agpCode`, `deliveryReport`
 * and `repeat`. The call layer's `attempt` is not among them.
 */
import type { JsonValue } from "@apnex/operation-call";
import { readCallEnding } from "@apnex/operation-call";
import { observePromises } from "@apnex/shape-check";
import type { Flags } from "./declaration-types.js";
import { describe, DIAGNOSTIC_LIMIT, writeJson } from "./value-text.js";
import { repeatLine } from "./repeat.js";

/** The exit status of each ending, and of a command refused before anything was invoked (OC4). */
export const EXIT_STATUS = Object.freeze({ answered: 0, refused: 2, "not-delivered": 3, unknown: 4, usage: 1, interrupted: 1 } as const);

/** The reason operation-command gives an unknown ending when `run` rejects or returns what is no ending. */
export const RUN_FAILED = "run-failed";

/** An ending as operation-command reports it: the call layer's fields that a record prints, read once. */
export type Ending =
	| { readonly ending: "answered"; readonly answer: JsonValue }
	| { readonly ending: "refused"; readonly refusal: JsonValue }
	| { readonly ending: "not-delivered"; readonly agpCode: string | null; readonly proxyCode: string | null; readonly earlierAttemptsUncertain: boolean }
	| { readonly ending: "unknown"; readonly reason: string; readonly agpCode: string | null; readonly deliveryReport: "delivered" | "unknown" | null };

type Read = { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string };

/**
 * Reads what `run` settled to as a call layer's ending, through operation-call's `readCallEnding` (zorg's
 * D54, D55): plain data only, running none of its code, holding exactly the fields of one kind of ending the
 * caller interface gives. Anything it refuses has its native promises observed, and is described from its
 * own data descriptors only; never throws.
 */
export function readEnding(value: unknown): Read {
	const read = readCallEnding(value);
	if (!read.ok) {
		observePromises(value, DIAGNOSTIC_LIMIT);
		return { ok: false, why: `run returned ${describe(value)}, not an ending the caller interface gives, read as plain data` };
	}
	const ending = read.ending;
	switch (ending.ending) {
		case "answered": return { ok: true, ending: { ending: "answered", answer: ending.answer } };
		case "refused": return { ok: true, ending: { ending: "refused", refusal: ending.refusal as unknown as JsonValue } };
		case "not-delivered": return { ok: true, ending: { ending: "not-delivered", agpCode: ending.agpCode, proxyCode: ending.proxyCode, earlierAttemptsUncertain: ending.earlierAttemptsUncertain } };
		case "unknown": return { ok: true, ending: { ending: "unknown", reason: ending.reason, agpCode: ending.agpCode, deliveryReport: ending.deliveryReport } };
	}
}

/** What a record is printed with: the command's operation and identity, and the repeat of an unknown ending. */
export interface RecordContext {
	readonly operation: string;
	readonly invocation: string;
	readonly repeat: readonly string[];
}

/** The record of an ending, its fields in the order OC4 lists them. */
export function endingRecord(ending: Ending, context: RecordContext): { readonly [field: string]: JsonValue } {
	const head = { ending: ending.ending, operation: context.operation, invocation: context.invocation };
	switch (ending.ending) {
		case "answered": return { ...head, answer: ending.answer };
		case "refused": return { ...head, refusal: ending.refusal };
		case "not-delivered": return { ...head, agpCode: ending.agpCode, proxyCode: ending.proxyCode, earlierAttemptsUncertain: ending.earlierAttemptsUncertain };
		case "unknown": return { ...head, reason: ending.reason, agpCode: ending.agpCode, deliveryReport: ending.deliveryReport, repeat: [...context.repeat] };
	}
}

/** A value on one line: text as it is, unless it holds a control character, and anything else as JSON. */
function plainValue(value: JsonValue): string {
	if (typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value)) return value;
	return writeJson(value);
}

/** How the plain form words an answer: the application's wording, or why it could not be used. */
export type Wording = (answer: JsonValue, flags: Flags) => unknown;

/**
 * The output of an ending: one JSON object, or one fact per line as a name, a colon and a value, with the
 * answer worded by the application and the repeat as one command line. Returns the text for standard
 * output and any diagnostic for standard error.
 */
export function printEnding(ending: Ending, context: RecordContext & { readonly json: boolean; readonly program: string; readonly word: Wording | undefined; readonly flags: Flags }): { readonly out: string; readonly diagnostic: string | undefined } {
	const record = endingRecord(ending, context);
	if (context.json) return { out: `${writeJson(record)}\n`, diagnostic: undefined };
	const lines: string[] = [];
	let diagnostic: string | undefined;
	for (const [name, value] of Object.entries(record)) {
		if (name === "answer") {
			const worded = context.word === undefined ? undefined : wordAnswer(context.word, value, context.flags);
			if (worded !== undefined && worded.ok) {
				// One piece, however many lines it holds: no call takes an argument per line.
				lines.push(worded.text.replace(/\n$/, ""));
				continue;
			}
			if (worded !== undefined) diagnostic = `diagnostic: the answer could not be worded, so it is printed as JSON: ${worded.why}`;
			// Unworded, the answer is always its JSON, a string's included, so it reads back as the answer it was.
			lines.push(`answer: ${writeJson(value)}`);
		} else if (name === "repeat") lines.push(`repeat: ${repeatLine(context.program, context.repeat)}`);
		else lines.push(`${name}: ${plainValue(value)}`);
	}
	return { out: `${lines.join("\n")}\n`, diagnostic };
}

/**
 * The application's wording of an answer: the text its `word` returned, or why there is none - it threw, or
 * returned what is no text. What it threw is never taken as the wording; what it threw or returned otherwise
 * has its native promises observed, and is described from its own data descriptors only. It is given the
 * answer as `readCallEnding` read it, deeply frozen, so it changes nothing printed.
 */
function wordAnswer(word: Wording, answer: JsonValue, flags: Flags): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string } {
	let returned: unknown;
	try {
		returned = word(answer, flags);
	} catch (error) {
		observePromises(error, DIAGNOSTIC_LIMIT);
		return { ok: false, why: `word threw ${describe(error, true)}` };
	}
	if (typeof returned === "string") return { ok: true, text: returned };
	observePromises(returned, DIAGNOSTIC_LIMIT);
	return { ok: false, why: `word returned ${describe(returned)}, not text` };
}
