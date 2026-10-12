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
import { Odd, readOnce, type ReadThen, type Snapshot } from "./client-value.js";
import type { Flags } from "./declaration-types.js";
import { copyJson, describe, firstOdd, isRecord, oddWhy, oneLine, threwAt, writeJson } from "./snapshot-text.js";
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

const codeOrNull = (value: Snapshot | undefined): value is string | null => value === null || typeof value === "string";

/** What run returned is no ending, and why. */
function malformed(why: string): { readonly ok: false; readonly why: string } {
	return { ok: false, why };
}

/** What run returned could not be read, since reading it threw what `odd` holds. */
function unreadable(odd: Odd): { readonly ok: false; readonly why: string } {
	return malformed(`run returned what could not be read as an ending: ${oneLine(odd.thrown)}`);
}

/**
 * Reads what `run` settled to as a call layer's ending (zorg's target, EM12), or says why it is none; never
 * throws. The result is read once (client-value.ts), every promise met consumed and every value thrown read
 * as it is met, and judged from what was read; `known` is the `then` that settling it read.
 */
export function readEnding(value: unknown, known?: ReadThen): { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string } {
	return judgeEnding(readOnce(value, known));
}

/** A JSON value, or why the snapshot at `root` is none - reading it threw, or it holds what is no JSON. */
function jsonAt(value: Snapshot, root: string): { readonly json: JsonValue } | { readonly odd: Odd; readonly why: string } {
	const found = firstOdd(value, root);
	return found === undefined ? { json: value as JsonValue } : { odd: found.odd, why: oddWhy(found.path, found.odd) };
}

function judgeEnding(read: Snapshot): { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string } {
	const top = threwAt(read);
	if (top !== undefined) return unreadable(top);
	if (!isRecord(read)) return malformed("run returned what is not an ending");
	const field = (name: string): Snapshot | undefined => Object.hasOwn(read, name) ? read[name] : undefined;
	const ending = field("ending");
	if (threwAt(ending) !== undefined) return unreadable(ending as Odd);
	switch (ending) {
		case "answered": {
			if (!Object.hasOwn(read, "answer")) return malformed("run returned an answered ending with no answer");
			const answer = jsonAt(read["answer"] as Snapshot, "answer");
			if ("json" in answer) return { ok: true, ending: { ending, answer: answer.json } };
			if (answer.odd.kind === "threw") return unreadable(answer.odd);
			return malformed(`run returned an answered ending whose answer is no JSON value: ${answer.why}`);
		}
		case "refused": {
			const refusal = field("refusal");
			if (threwAt(refusal) !== undefined) return unreadable(refusal as Odd);
			const objectLike = isRecord(refusal) || (refusal instanceof Odd && (refusal.kind === "object" || refusal.kind === "promise" || refusal.kind === "error"));
			if (!objectLike) return malformed("run returned a refused ending with no refusal record");
			const record = jsonAt(refusal as Snapshot, "refusal");
			if ("json" in record) return { ok: true, ending: { ending, refusal: record.json } };
			if (record.odd.kind === "threw") return unreadable(record.odd);
			return malformed(`run returned a refused ending whose refusal record is no JSON value: ${record.why}`);
		}
		case "not-delivered": {
			const [agpCode, proxyCode, earlierAttemptsUncertain] = [field("agpCode"), field("proxyCode"), field("earlierAttemptsUncertain")];
			for (const value of [agpCode, proxyCode, earlierAttemptsUncertain]) if (threwAt(value) !== undefined) return unreadable(value as Odd);
			if (!codeOrNull(agpCode) || !codeOrNull(proxyCode) || typeof earlierAttemptsUncertain !== "boolean") {
				return malformed("run returned a not-delivered ending without agpCode, proxyCode and earlierAttemptsUncertain");
			}
			return { ok: true, ending: { ending, agpCode, proxyCode, earlierAttemptsUncertain } };
		}
		case "unknown": {
			const [reason, agpCode, deliveryReport] = [field("reason"), field("agpCode"), field("deliveryReport")];
			for (const value of [reason, agpCode, deliveryReport]) if (threwAt(value) !== undefined) return unreadable(value as Odd);
			if (typeof reason !== "string" || !codeOrNull(agpCode) || !(deliveryReport === null || deliveryReport === "delivered" || deliveryReport === "unknown")) {
				return malformed("run returned an unknown ending without reason, agpCode and deliveryReport");
			}
			return { ok: true, ending: { ending, reason, agpCode, deliveryReport } };
		}
		default:
			return malformed(`run returned an ending of ${typeof ending === "string" ? JSON.stringify(ending) : ending === undefined ? "undefined" : oneLine(ending)}, not answered, refused, not-delivered or unknown`);
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
				lines.push(...worded.text.replace(/\n$/, "").split("\n"));
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
 * returned what is no text. What it threw is never taken as the wording; it is read once, as is anything
 * else it returned, so a promise thrown or returned is consumed and its rejection handled here. It is given
 * its own copy of the answer, so it changes nothing printed.
 */
function wordAnswer(word: Wording, answer: JsonValue, flags: Flags): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string } {
	let returned: unknown;
	try {
		returned = word(copyJson(answer), flags);
	} catch (error) {
		return { ok: false, why: `word threw ${oneLine(readOnce(error))}` };
	}
	if (typeof returned === "string") return { ok: true, text: returned };
	return { ok: false, why: `word returned ${describe(readOnce(returned))}, not text` };
}
