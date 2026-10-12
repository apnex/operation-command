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

/** Reads what `run` returned as a call layer's ending (zorg's target, EM12), or says why it is none. */
export function readEnding(value: unknown): { readonly ok: true; readonly ending: Ending } | { readonly ok: false; readonly why: string } {
	if (!isObject(value)) return { ok: false, why: "run returned what is not an ending" };
	const ending = value["ending"];
	switch (ending) {
		case "answered": {
			const answer = value["answer"];
			if (!Object.hasOwn(value, "answer") || JSON.stringify(answer) === undefined) return { ok: false, why: "run returned an answered ending with no answer" };
			return { ok: true, ending: { ending, answer: answer as JsonValue } };
		}
		case "refused": {
			const refusal = value["refusal"];
			if (!isObject(refusal)) return { ok: false, why: "run returned a refused ending with no refusal record" };
			return { ok: true, ending: { ending, refusal: refusal as JsonValue } };
		}
		case "not-delivered": {
			const { agpCode, proxyCode, earlierAttemptsUncertain } = value;
			if (!codeOrNull(agpCode) || !codeOrNull(proxyCode) || typeof earlierAttemptsUncertain !== "boolean") return { ok: false, why: "run returned a not-delivered ending without agpCode, proxyCode and earlierAttemptsUncertain" };
			return { ok: true, ending: { ending, agpCode, proxyCode, earlierAttemptsUncertain } };
		}
		case "unknown": {
			const { reason, agpCode, deliveryReport } = value;
			if (typeof reason !== "string" || !codeOrNull(agpCode) || !(deliveryReport === null || deliveryReport === "delivered" || deliveryReport === "unknown")) {
				return { ok: false, why: "run returned an unknown ending without reason, agpCode and deliveryReport" };
			}
			return { ok: true, ending: { ending, reason, agpCode, deliveryReport } };
		}
		default:
			return { ok: false, why: `run returned an ending of ${JSON.stringify(ending) ?? String(ending)}, not answered, refused, not-delivered or unknown` };
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
		if (name === "answer" && context.word !== undefined) {
			let worded: unknown;
			try {
				worded = context.word(value, context.flags);
			} catch (error) {
				worded = error;
			}
			if (typeof worded === "string") {
				lines.push(...worded.replace(/\n$/, "").split("\n"));
				continue;
			}
			diagnostic = `diagnostic: the answer could not be worded, so it is printed as JSON: ${oneLine(worded)}`;
		}
		if (name === "repeat") lines.push(`repeat: ${repeatLine(context.program, context.repeat)}`);
		else lines.push(`${name}: ${plainValue(value)}`);
	}
	return { out: `${lines.join("\n")}\n`, diagnostic };
}

/** Anything, as one line of text. */
export function oneLine(value: unknown): string {
	let text: string;
	if (value instanceof Error) text = `${value.name}: ${value.message}`;
	else if (typeof value === "string") text = value;
	else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = Object.prototype.toString.call(value);
		}
	}
	return text.replace(/[\r\n]+/g, " ");
}
