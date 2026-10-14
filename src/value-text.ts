/**
 * Values as text: a JSON value written as JSON text, and a diagnostic line describing what the application
 * threw or gave (OC4). Every walk keeps its own stack, so depth alone never overflows the call stack.
 *
 * A diagnostic first observes every native promise the value holds, through shape-check's `observePromises`,
 * so no later cut of the text leaves one unobserved; it then describes the value from its own data
 * descriptors only (zorg's D54, D55), never invoking a getter, a setter or a conversion: a string, a number,
 * a boolean, null, undefined and a BigInt are written as they are; an error as its own `name`, if it has one
 * as an own data property, a colon and its own `message` - never the name it inherits; a promise, a function
 * and a symbol as what they are; an array or another object as its own data members, a getter written
 * `<getter>`. A value met a second time on the path being described is written `<cycle>`, at most 1000
 * values are visited, and the line, its control characters made spaces, is cut at 1000 Unicode code points
 * with `...` added, so it is always one finite line.
 */
import type { JsonValue } from "@apnex/operation-call";
import { observePromises } from "@apnex/shape-check";

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

/** True for a native promise; a Proxy's trap that throws while asked makes it none, what it threw observed. */
function isPromise(value: object): boolean {
	try {
		return value instanceof Promise;
	} catch (err) {
		observePromises(err);
		return false;
	}
}

/** Whether a value's prototype chain holds `wanted`, walked a bounded number of steps. */
function inherits(value: object, wanted: object): boolean {
	let p: unknown = Object.getPrototypeOf(value);
	for (let step = 0; step < DIAGNOSTIC_LIMIT && p !== null && typeof p === "object"; step++, p = Object.getPrototypeOf(p)) if (p === wanted) return true;
	return false;
}

/** An own property as a diagnostic reads it: its data value, or the fact that it is a getter or setter. */
type Own = { readonly name: string; readonly value: unknown } | { readonly name: string; readonly accessor: true };

/**
 * The own string-named properties of an object, read through their descriptors only, at most
 * DIAGNOSTIC_LIMIT of them, each data value's native promise observed as it is read; or undefined when a
 * Proxy's trap threw, after what it threw is observed.
 */
function ownProperties(item: object): { readonly own: readonly Own[]; readonly more: boolean } | undefined {
	try {
		const names = Object.getOwnPropertyNames(item);
		const own: Own[] = [];
		for (const name of names) {
			if (own.length >= DIAGNOSTIC_LIMIT) break;
			const descriptor = Object.getOwnPropertyDescriptor(item, name);
			if (descriptor === undefined) continue;
			if (Object.hasOwn(descriptor, "value")) {
				observePromises(descriptor.value, 0);
				own.push({ name, value: descriptor.value });
			} else own.push({ name, accessor: true });
		}
		return { own, more: own.length < names.length };
	} catch (err) {
		// A Proxy's trap threw: what it threw is observed, in case it is a rejected promise.
		observePromises(err);
		return undefined;
	}
}

/**
 * Describes a value for a diagnostic. Every native promise it holds is observed first, within the 1000
 * values a description may meet, and each own data value read is observed again as it is read; then the
 * value is written from its own data descriptors. `said` writes a string as it is, as what was thrown is
 * said; otherwise a string is written as JSON, as a value given is. The description stops with `...` once it
 * is longer than a diagnostic line holds, or has visited as many values as that.
 */
export function describe(value: unknown, said = false): string {
	observePromises(value, DIAGNOSTIC_LIMIT);
	type Entry = { readonly text: string } | { readonly value: unknown; readonly said: boolean } | { readonly leave: object };
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
		// Past twice the limit in code units is past the limit in code points, so the line's cut always applies.
		if (size > 2 * DIAGNOSTIC_LIMIT || met > DIAGNOSTIC_LIMIT) {
			write("...");
			break;
		}
		const entry = stack.pop() as Entry;
		if ("text" in entry) {
			write(entry.text);
			continue;
		}
		if ("leave" in entry) {
			path.delete(entry.leave);
			continue;
		}
		const item = entry.value;
		met++;
		if (typeof item === "string") write(entry.said ? item : JSON.stringify(item.length > 2 * DIAGNOSTIC_LIMIT ? item.slice(0, 2 * DIAGNOSTIC_LIMIT) : item));
		else if (typeof item === "bigint") write(`${item}n`);
		else if (typeof item === "symbol") write("<a symbol>");
		else if (typeof item === "function") write("<a function>");
		else if (item === null || typeof item !== "object") write(String(item));
		else if (path.has(item)) write("<cycle>");
		else if (isPromise(item)) write("<a promise>");
		else {
			let kind: "error" | "array" | "object";
			try {
				kind = Array.isArray(item) ? "array" : inherits(item, Error.prototype) ? "error" : "object";
			} catch (err) {
				observePromises(err);
				write("<unreadable>");
				continue;
			}
			const read = ownProperties(item);
			if (read === undefined) {
				write("<unreadable>");
				continue;
			}
			const parts: Entry[] = [];
			const member = (own: Own): Entry => ("value" in own ? { value: own.value, said: false } : { text: "<getter>" });
			if (kind === "error") {
				// Only the error's own name and message, each from its own data descriptor; an inherited name is never read.
				const name = read.own.find((own) => own.name === "name");
				const message = read.own.find((own) => own.name === "message");
				if (name !== undefined) parts.push("value" in name ? { value: name.value, said: true } : { text: "<getter>" });
				if (name !== undefined && message !== undefined) parts.push({ text: ": " });
				if (message !== undefined) parts.push("value" in message ? { value: message.value, said: true } : { text: "<getter>" });
				if (name === undefined && message === undefined) parts.push({ text: "<an error>" });
			} else {
				const members = kind === "array" ? read.own.filter((own) => own.name !== "length") : read.own;
				parts.push({ text: kind === "array" ? "[" : "{" });
				members.forEach((own, i) => {
					if (i > 0) parts.push({ text: ", " });
					if (kind === "object") parts.push({ text: `${JSON.stringify(own.name)}: ` });
					parts.push(member(own));
				});
				if (read.more) parts.push({ text: members.length > 0 ? ", ..." : "..." });
				parts.push({ text: kind === "array" ? "]" : "}" });
			}
			path.add(item);
			stack.push({ leave: item });
			for (let i = parts.length - 1; i >= 0; i--) stack.push(parts[i] as Entry);
		}
	}
	return out.join("");
}

/** Text as one line: each run of control characters and line breaks a space. */
export function singleLine(text: string): string {
	return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
}

/** A diagnostic as one line: each run of control characters and line breaks a space, cut at 1000 characters with `...` added. */
export function diagnosticLine(text: string): string {
	const line = singleLine(text);
	const characters = Array.from(line);
	return characters.length > DIAGNOSTIC_LIMIT ? `${characters.slice(0, DIAGNOSTIC_LIMIT).join("")}...` : line;
}
