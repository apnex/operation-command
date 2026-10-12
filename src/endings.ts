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
import type { Flags } from "./declaration-types.js";
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

const isObject = (value: unknown): value is { readonly [key: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);
const codeOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const ignore = (): void => undefined;

/**
 * Observes a value that may be a promise or a thenable, so a rejection it carries is handled here and never
 * escapes as an unhandled rejection; a value that is neither is left as it is.
 */
export function consume(value: unknown): void {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
	try {
		Promise.resolve(value).then(ignore, ignore);
	} catch {
		// A value whose very inspection throws carries no promise this could observe.
	}
}

/**
 * Observes every promise a client's result holds, however deep among its arrays and plain objects, so no
 * rejection it carries escapes; a field whose reading throws is passed over, and a value met again is not
 * walked again. Anything that is neither an array nor a plain object is observed as a possible promise.
 */
export function observeAll(value: unknown, seen: Set<unknown> = new Set()): void {
	if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
	seen.add(value);
	try {
		const prototype = Object.getPrototypeOf(value);
		if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
			consume(value);
			return;
		}
		for (const key of Object.keys(value)) {
			let field: unknown;
			try {
				field = (value as { readonly [key: string]: unknown })[key];
			} catch {
				continue;
			}
			observeAll(field, seen);
		}
	} catch {
		consume(value);
	}
}

/** Why a value is not a JSON value, thrown by jsonCopy. */
class NotJson extends Error {}

/**
 * A copy of a JSON value - null, a boolean, a finite number, a string, an array or a plain object of JSON
 * values - each field read once, so nothing read later can throw or change; throws for anything else, a
 * promise, a cycle or a BigInt among them, observing any promise it meets.
 */
function jsonCopy(value: unknown, path: string, within: Set<object>): JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new NotJson(`${path} is ${String(value)}, not a finite number`);
		return value;
	}
	if (typeof value !== "object") {
		consume(value);
		throw new NotJson(`${path} is ${typeof value === "bigint" ? "a BigInt" : `a ${typeof value}`}, not a JSON value`);
	}
	if (within.has(value)) throw new NotJson(`${path} holds itself`);
	within.add(value);
	try {
		if (Array.isArray(value)) {
			const length = value.length;
			const copy: JsonValue[] = [];
			for (let i = 0; i < length; i++) copy.push(jsonCopy(value[i], `${path}[${i}]`, within));
			return copy;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			consume(value);
			throw new NotJson(`${path} is an object that is no plain JSON object`);
		}
		const copy: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value)) copy[key] = jsonCopy((value as { readonly [key: string]: unknown })[key], `${path}.${key}`, within);
		return copy;
	} finally {
		within.delete(value);
	}
}

/** Reads what `run` returned as a call layer's ending (zorg's target, EM12), or says why it is none; never throws. */
export function readEnding(value: unknown): { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string } {
	let read: { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string };
	try {
		read = readEndingOrThrow(value);
	} catch (error) {
		// Reading the result threw - a getter, a proxy, a value too deep - so what run returned is no ending.
		read = { ok: false, why: `run returned what could not be read as an ending: ${oneLine(error)}` };
	}
	// Every promise the result holds is observed, a malformed one's or one beside the fields read, so none of their rejections escapes.
	observeAll(value);
	return read;
}

/** What run returned is no ending, and why. */
function malformed(why: string): { readonly ok: false; readonly why: string } {
	return { ok: false, why };
}

function readEndingOrThrow(value: unknown): { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string } {
	if (!isObject(value)) return malformed("run returned what is not an ending");
	const ending = value["ending"];
	switch (ending) {
		case "answered": {
			if (!Object.hasOwn(value, "answer")) return malformed("run returned an answered ending with no answer");
			const answer = value["answer"];
			try {
				return { ok: true, ending: { ending, answer: jsonCopy(answer, "answer", new Set()) } };
			} catch (error) {
				if (error instanceof NotJson) return malformed(`run returned an answered ending whose answer is no JSON value: ${error.message}`);
				throw error;
			}
		}
		case "refused": {
			const refusal = value["refusal"];
			if (!isObject(refusal)) return malformed("run returned a refused ending with no refusal record");
			try {
				return { ok: true, ending: { ending, refusal: jsonCopy(refusal, "refusal", new Set()) } };
			} catch (error) {
				if (error instanceof NotJson) return malformed(`run returned a refused ending whose refusal record is no JSON value: ${error.message}`);
				throw error;
			}
		}
		case "not-delivered": {
			const { agpCode, proxyCode, earlierAttemptsUncertain } = value;
			if (!codeOrNull(agpCode) || !codeOrNull(proxyCode) || typeof earlierAttemptsUncertain !== "boolean") {
				return malformed("run returned a not-delivered ending without agpCode, proxyCode and earlierAttemptsUncertain");
			}
			return { ok: true, ending: { ending, agpCode, proxyCode, earlierAttemptsUncertain } };
		}
		case "unknown": {
			const { reason, agpCode, deliveryReport } = value;
			if (typeof reason !== "string" || !codeOrNull(agpCode) || !(deliveryReport === null || deliveryReport === "delivered" || deliveryReport === "unknown")) {
				return malformed("run returned an unknown ending without reason, agpCode and deliveryReport");
			}
			return { ok: true, ending: { ending, reason, agpCode, deliveryReport } };
		}
		default:
			return malformed(`run returned an ending of ${typeof ending === "string" ? JSON.stringify(ending) : oneLine(ending)}, not answered, refused, not-delivered or unknown`);
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
	return JSON.stringify(value);
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
	if (context.json) return { out: `${JSON.stringify(record)}\n`, diagnostic: undefined };
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
			lines.push(`answer: ${JSON.stringify(value)}`);
		} else if (name === "repeat") lines.push(`repeat: ${repeatLine(context.program, context.repeat)}`);
		else lines.push(`${name}: ${plainValue(value)}`);
	}
	return { out: `${lines.join("\n")}\n`, diagnostic };
}

/**
 * The application's wording of an answer: the text its `word` returned, or why there is none - it threw, or
 * returned what is no text. What it threw is never taken as the wording, and a promise it returned is
 * observed, so its rejection is handled here. It is given its own copy of the answer, so it changes nothing printed.
 */
function wordAnswer(word: Wording, answer: JsonValue, flags: Flags): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string } {
	let returned: unknown;
	try {
		returned = word(structuredClone(answer), flags);
	} catch (error) {
		return { ok: false, why: `word threw ${oneLine(error)}` };
	}
	if (typeof returned === "string") return { ok: true, text: returned };
	consume(returned);
	return { ok: false, why: `word returned ${describe(returned)}, not text` };
}

/** What a value is, in a few words, read without calling anything of the value's own. */
function describe(value: unknown): string {
	if (value === null) return "null";
	if (typeof value !== "object") return typeof value === "undefined" ? "nothing" : `a ${typeof value}`;
	try {
		if (value instanceof Promise) return "a promise";
		return Array.isArray(value) ? "an array" : "an object";
	} catch {
		return "an object";
	}
}

/** Anything, as one line of text; never throws, whatever the value's own accessors do. */
export function oneLine(value: unknown): string {
	let text: string;
	try {
		if (value instanceof Error) text = `${String(value.name)}: ${String(value.message)}`;
		else if (typeof value === "string") text = value;
		else if (typeof value === "bigint") text = `${value}n`;
		else text = JSON.stringify(value) ?? String(value);
	} catch {
		try {
			text = Object.prototype.toString.call(value);
		} catch {
			text = "a value that could not be written";
		}
	}
	return text.replace(/[\r\n]+/g, " ");
}
