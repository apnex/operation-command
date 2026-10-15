/**
 * The types a flag's value may have (OC1), and how a value written as text is read as one of them.
 *
 * A string matches a stated pattern as a whole, from its first character to its last; a whole number lies within stated bounds; a duration - a whole number
 * with no sign followed by one of `ms`, `s`, `m`, `h` or `d`, in lower case - lies within stated bounds;
 * a URL is one the WHATWG URL standard's parser takes, and takes back unchanged from the form it writes for it, of one of the stated schemes, the whole of whose text
 * matches the type's pattern when it states one, checked in that order; a switch takes no value. A value keeps the text it was taken from,
 * which a repeat writes exactly as it was taken (OC5), beside the value `run` is given.
 */
import type { ValueType } from "./declaration-types.js";

/** Milliseconds in each unit a duration may be written in. */
const DURATION_UNITS: { readonly [unit: string]: number } = Object.freeze({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 });

/** A duration as OC1 writes it: digits with no sign, then a unit in lower case. */
const DURATION_PATTERN = /^([0-9]+)(ms|s|m|h|d)$/;

/** A whole number as text: digits, with a minus sign for one below zero. */
const INTEGER_PATTERN = /^-?[0-9]+$/;

/** The milliseconds a duration written as text stands for, or undefined when it is no duration. */
export function durationMs(text: string): number | undefined {
	const match = DURATION_PATTERN.exec(text);
	if (match === null) return undefined;
	const unit = DURATION_UNITS[match[2] as string] as number;
	return Number(match[1]) * unit;
}

/** A stated pattern made to match only a whole value, from its first character to its last. */
export function wholePattern(pattern: string): RegExp {
	return new RegExp(`^(?:${pattern})$`);
}

/** Whether the parser takes a URL back, unchanged, from the form it writes for it (OC1). */
function readsBack(url: URL): boolean {
	try {
		return new URL(url.href).href === url.href;
	} catch {
		return false;
	}
}

/** A value read from its text: the value `run` is given, or why the text is not one. */
export type ReadValue = { readonly ok: true; readonly value: string | number } | { readonly ok: false; readonly why: string };

/** A type made ready to read values: its pattern compiled and its duration bounds in milliseconds. */
export interface PreparedType {
	readonly kind: ValueType["kind"];
	/** A duration's or a whole number's bounds, in milliseconds for a duration; undefined for any other type. */
	readonly min?: number;
	readonly max?: number;
	/** Reads a value's text as this type; never called for a switch. */
	read(text: string): ReadValue;
}

/** Prepares a type the declaration has already checked (see declaration.ts). */
export function prepareType(type: ValueType): PreparedType {
	switch (type.kind) {
		case "string": {
			// The pattern matches the whole value, not a part of it (OC1): anchored at both ends around all its alternatives.
			const pattern = wholePattern(type.pattern);
			return { kind: "string", read: (text) => pattern.test(text) ? { ok: true, value: text } : { ok: false, why: `does not match the pattern ${type.pattern} as a whole` } };
		}
		case "integer": {
			const { min, max } = type;
			return {
				kind: "integer", min, max,
				read(text) {
					if (!INTEGER_PATTERN.test(text)) return { ok: false, why: "is not a whole number" };
					const value = Number(text);
					if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, why: `is not a whole number from ${min} to ${max}` };
					return { ok: true, value };
				},
			};
		}
		case "duration": {
			const min = durationMs(type.min) as number;
			const max = durationMs(type.max) as number;
			return {
				kind: "duration", min, max,
				read(text) {
					const value = durationMs(text);
					if (value === undefined) return { ok: false, why: "is not a duration: a whole number with no sign followed by ms, s, m, h or d" };
					if (value < min || value > max) return { ok: false, why: `is not a duration from ${type.min} to ${type.max}` };
					return { ok: true, value };
				},
			};
		}
		case "url": {
			const schemes = type.schemes;
			// The parser, then the scheme, then the pattern when one is stated; the first that fails is the usage error (OC1).
			const pattern = type.pattern === undefined ? undefined : wholePattern(type.pattern);
			return {
				kind: "url",
				read(text) {
					let url: URL;
					try {
						url = new URL(text);
					} catch {
						return { ok: false, why: "is not a URL" };
					}
					// A URL the parser cannot take back from the form it writes for it is no URL: nothing after can rebuild
					// it, and in Node 24 setting any part of one stops the process (OC1).
					if (!readsBack(url)) return { ok: false, why: `is not a URL: the parser writes it as ${JSON.stringify(url.href)}, which it does not take back unchanged` };
					const scheme = url.protocol.slice(0, -1);
					if (!schemes.includes(scheme)) return { ok: false, why: `is not a URL of the scheme${schemes.length === 1 ? "" : "s"} ${schemes.join(", ")}` };
					if (pattern !== undefined && !pattern.test(text)) return { ok: false, why: `does not match the pattern ${type.pattern} as a whole` };
					return { ok: true, value: text };
				},
			};
		}
		case "switch":
			return { kind: "switch", read: () => ({ ok: false, why: "is a switch, which takes no value" }) };
	}
}
