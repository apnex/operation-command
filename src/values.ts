/**
 * The types a flag's value may have (OC1), and how a value written as text is read as one of them.
 *
 * A string matches a stated pattern; a whole number lies within stated bounds; a duration - a whole number
 * with no sign followed by one of `ms`, `s`, `m`, `h` or `d`, in lower case - lies within stated bounds;
 * a URL has one of the stated schemes; a switch takes no value. A value keeps the text it was taken from,
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

/** A value read from its text: the value `run` is given, or why the text is not one. */
export type ReadValue = { readonly ok: true; readonly value: string | number } | { readonly ok: false; readonly why: string };

/** A type made ready to read values: its pattern compiled and its duration bounds in milliseconds. */
export interface PreparedType {
	readonly kind: ValueType["kind"];
	/** Reads a value's text as this type; never called for a switch. */
	read(text: string): ReadValue;
}

/** Prepares a type the declaration has already checked (see declaration.ts). */
export function prepareType(type: ValueType): PreparedType {
	switch (type.kind) {
		case "string": {
			const pattern = new RegExp(type.pattern);
			return { kind: "string", read: (text) => pattern.test(text) ? { ok: true, value: text } : { ok: false, why: `does not match the pattern ${type.pattern}` } };
		}
		case "integer": {
			const { min, max } = type;
			return {
				kind: "integer",
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
				kind: "duration",
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
			return {
				kind: "url",
				read(text) {
					let url: URL;
					try {
						url = new URL(text);
					} catch {
						return { ok: false, why: "is not a URL" };
					}
					const scheme = url.protocol.slice(0, -1);
					return schemes.includes(scheme) ? { ok: true, value: text } : { ok: false, why: `is not a URL of the scheme${schemes.length === 1 ? "" : "s"} ${schemes.join(", ")}` };
				},
			};
		}
		case "switch":
			return { kind: "switch", read: () => ({ ok: false, why: "is a switch, which takes no value" }) };
	}
}
