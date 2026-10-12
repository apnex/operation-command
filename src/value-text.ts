/**
 * Values as text: a JSON value written as JSON text, a JSON value copied, and a diagnostic line describing
 * what the application threw or gave (OC4). Every walk keeps its own stack, so depth alone never overflows the
 * call stack, and every copied object is built by defining own data properties, so a member named
 * `__proto__` stays a member.
 *
 * A diagnostic describes a value from what is read of it once, as it is met, and never reads a property or
 * calls a conversion again: a string, a number, a boolean, null, undefined and a BigInt are written as they
 * are; an error as its name, a colon and its message, each read once; anything else as what it is, such as
 * `<a promise>` or `<an object>`, its members unread. An error met a second time on the path being described
 * is written `<cycle>`. The line is cut at 1000 characters with `...` added, and is always one line.
 */
import type { JsonValue } from "@apnex/operation-call";
import { define, observe } from "./client-value.js";

/** The most characters a diagnostic line holds before it is cut, and the most values a description meets. */
export const DIAGNOSTIC_LIMIT = 1000;

/** Writes a JSON value as JSON text, members in their own order, as JSON.stringify writes it, whatever its depth. */
export function writeJson(value: JsonValue): string {
	const out: string[] = [];
	type Entry = { readonly text: string } | { readonly value: JsonValue };
	const stack: Entry[] = [{ value }];
	while (stack.length > 0) {
		const entry = stack.pop() as Entry;
		if ("text" in entry) {
			out.push(entry.text);
			continue;
		}
		const item = entry.value;
		if (Array.isArray(item)) {
			out.push("[");
			stack.push({ text: "]" });
			for (let i = item.length - 1; i >= 0; i--) {
				stack.push({ value: item[i] as JsonValue });
				if (i > 0) stack.push({ text: "," });
			}
		} else if (item !== null && typeof item === "object") {
			const names = Object.keys(item);
			out.push("{");
			stack.push({ text: "}" });
			for (let i = names.length - 1; i >= 0; i--) {
				const name = names[i] as string;
				stack.push({ value: item[name] as JsonValue });
				stack.push({ text: `${i > 0 ? "," : ""}${JSON.stringify(name)}:` });
			}
		} else out.push(JSON.stringify(item));
	}
	return out.join("");
}

/** A deep copy of a JSON value, each object's members defined as its own, whatever their names. */
export function copyJson(value: JsonValue): JsonValue {
	const copyOne = (item: JsonValue): JsonValue => item === null || typeof item !== "object" ? item : Array.isArray(item) ? new Array<JsonValue>(item.length) : {};
	const root = copyOne(value);
	const stack: { readonly from: JsonValue; readonly to: JsonValue }[] = [{ from: value, to: root }];
	while (stack.length > 0) {
		const { from, to } = stack.pop() as { readonly from: JsonValue; readonly to: JsonValue };
		if (from === null || typeof from !== "object" || to === null || typeof to !== "object") continue;
		const names: (string | number)[] = Array.isArray(from) ? Array.from({ length: from.length }, (_, i) => i) : Object.keys(from);
		for (const name of names) {
			const member = (from as { readonly [key: string | number]: JsonValue })[name] as JsonValue;
			const made = copyOne(member);
			define(to, name, made);
			stack.push({ from: member, to: made });
		}
	}
	return root;
}

/** Whether a prototype chain, from a prototype already read, holds `wanted`; walked a bounded number of steps. */
function inherits(first: unknown, wanted: object): boolean {
	let p = first;
	for (let step = 0; step < DIAGNOSTIC_LIMIT && p !== null && typeof p === "object"; step++, p = Object.getPrototypeOf(p)) if (p === wanted) return true;
	return false;
}

type Part = { readonly text: string } | { readonly value: unknown; readonly said: boolean } | { readonly threw: unknown };

/** One field of an error, read once: its value, said as a diagnostic says it, or what reading it threw. */
function readPart(error: object, name: "name" | "message"): Part {
	try {
		return { value: (error as { readonly [key: string]: unknown })[name], said: true };
	} catch (threw) {
		return { threw };
	}
}

/**
 * Describes a value for a diagnostic, observing each value it meets. `said` writes a string as it is, as
 * what was thrown is said; otherwise a string is written as JSON, as a value given is. The description stops
 * with `...` once it is longer than a diagnostic line holds, or has met as many values as that.
 */
export function describe(value: unknown, said = false): string {
	type Entry = Part | { readonly leave: object };
	const parts = new Map<object, readonly Part[]>();
	const path = new Set<object>();
	const out: string[] = [];
	let size = 0;
	let met = 0;
	const write = (text: string): void => {
		const kept = text.length > 2 * DIAGNOSTIC_LIMIT ? text.slice(0, 2 * DIAGNOSTIC_LIMIT) : text;
		out.push(kept);
		size += kept.length;
	};
	const stack: Entry[] = [{ value, said }];
	while (stack.length > 0) {
		if (size > DIAGNOSTIC_LIMIT || met > DIAGNOSTIC_LIMIT) {
			write("...");
			break;
		}
		const entry = stack.pop() as Entry;
		if ("text" in entry) write(entry.text);
		else if ("leave" in entry) path.delete(entry.leave);
		else if ("threw" in entry) stack.push({ text: ">" }, { value: entry.threw, said: true }, { text: "<threw " });
		else {
			met++;
			const item = entry.value;
			observe(item);
			if (typeof item === "string") write(entry.said ? item : JSON.stringify(item));
			else if (typeof item === "bigint") write(`${item}n`);
			else if (typeof item === "symbol") write("<a symbol>");
			else if (typeof item === "function") write("<a function>");
			else if (item === null || typeof item !== "object") write(String(item));
			else if (path.has(item)) write("<cycle>");
			else {
				let kind: "error" | "promise" | "object";
				try {
					const prototype: unknown = Object.getPrototypeOf(item);
					kind = inherits(prototype, Error.prototype) ? "error" : inherits(prototype, Promise.prototype) ? "promise" : "object";
				} catch (threw) {
					stack.push({ threw });
					continue;
				}
				if (kind !== "error") {
					write(kind === "promise" ? "<a promise>" : "<an object>");
					continue;
				}
				// An error's name and message are read the first time it is met, and only then.
				let read = parts.get(item);
				if (read === undefined) {
					read = [readPart(item, "name"), { text: ": " }, readPart(item, "message")];
					parts.set(item, read);
				}
				path.add(item);
				stack.push({ leave: item });
				for (let i = read.length - 1; i >= 0; i--) stack.push(read[i] as Part);
			}
		}
	}
	return out.join("");
}

/** A diagnostic as one line: each run of control characters and line breaks a space, cut at 1000 characters with `...` added. */
export function diagnosticLine(text: string): string {
	const line = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
	const characters = Array.from(line);
	return characters.length > DIAGNOSTIC_LIMIT ? `${characters.slice(0, DIAGNOSTIC_LIMIT).join("")}...` : line;
}
