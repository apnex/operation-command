/**
 * Snapshots of what the application gave back (client-value.ts), as text and as JSON: written as JSON text,
 * an Odd written as what it was; written as one line for a diagnostic; judged for the first place that is
 * no JSON value; and copied. Nothing here reads anything of the application's: a snapshot is plain copies
 * and Odds only. Every walk keeps its own stack, so depth alone never overflows the call stack, and every
 * copied object is built by defining own data properties, so a member named `__proto__` stays a member.
 */
import type { JsonValue } from "@apnex/operation-call";
import { define, Odd, type Snapshot } from "./client-value.js";

const isContainer = (value: Snapshot): value is Snapshot[] | { [name: string]: Snapshot } => value !== null && typeof value === "object" && !(value instanceof Odd);

/** True for a plain object's copy: no array, no Odd. */
export const isRecord = (value: Snapshot | undefined): value is { [name: string]: Snapshot } => value !== undefined && isContainer(value) && !Array.isArray(value);

/** The Odd standing where reading a value threw, or undefined. */
export const threwAt = (value: Snapshot | undefined): Odd | undefined => value instanceof Odd && value.kind === "threw" ? value : undefined;

/** How an Odd that is no error and no throw is written. */
function oddText(odd: Odd): string {
	switch (odd.kind) {
		case "non-finite": case "bigint": case "undefined": return odd.text;
		case "symbol": return "<a symbol>";
		case "function": return "<a function>";
		case "promise": return "<a promise>";
		case "itself": return "<itself>";
		default: return "<an object that is no plain JSON object>";
	}
}

/**
 * Writes a snapshot as JSON text, members in their own order, as JSON.stringify writes a JSON value; an Odd
 * is written as what it was, `<` and `>` around anything that has no literal form. `said` is what is
 * written as one line says it: a string as it is, an error as its name, a colon and its message.
 */
export function writeSnapshot(value: Snapshot, said = false): string {
	const out: string[] = [];
	type Entry = { readonly text: string } | { readonly value: Snapshot; readonly said: boolean };
	const stack: Entry[] = [{ value, said }];
	while (stack.length > 0) {
		const entry = stack.pop() as Entry;
		if ("text" in entry) {
			out.push(entry.text);
			continue;
		}
		const item = entry.value;
		if (entry.said && typeof item === "string") out.push(item);
		else if (item instanceof Odd) {
			if (item.kind === "error") {
				const parts: Entry[] = [{ value: item.name, said: true }, { text: ": " }, { value: item.message, said: true }];
				if (!entry.said) {
					parts.unshift({ text: "<" });
					parts.push({ text: ">" });
				}
				for (let i = parts.length - 1; i >= 0; i--) stack.push(parts[i] as Entry);
			} else if (item.kind === "threw") stack.push({ text: ">" }, { value: item.thrown, said: true }, { text: "<threw " });
			else out.push(oddText(item));
		} else if (Array.isArray(item)) {
			out.push("[");
			stack.push({ text: "]" });
			for (let i = item.length - 1; i >= 0; i--) {
				stack.push({ value: item[i] as Snapshot, said: false });
				if (i > 0) stack.push({ text: "," });
			}
		} else if (item !== null && typeof item === "object") {
			const names = Object.keys(item);
			out.push("{");
			stack.push({ text: "}" });
			for (let i = names.length - 1; i >= 0; i--) {
				const name = names[i] as string;
				stack.push({ value: item[name] as Snapshot, said: false });
				stack.push({ text: `${i > 0 ? "," : ""}${JSON.stringify(name)}:` });
			}
		} else out.push(JSON.stringify(item));
	}
	return out.join("");
}

/** A JSON value as JSON text, as JSON.stringify writes it, whatever its depth. */
export function writeJson(value: JsonValue): string {
	return writeSnapshot(value);
}

/** A snapshot as one line, as a diagnostic says it: a string as it is, an error as its name and message, anything else as written. */
export function oneLine(value: Snapshot): string {
	return writeSnapshot(value, true).replace(/[\r\n]+/g, " ");
}

/** The first place in a snapshot, members in their own order, a place before its members, that is no JSON value, and what is there. */
export function firstOdd(value: Snapshot, root: string): { readonly path: string; readonly odd: Odd } | undefined {
	interface Place { readonly value: Snapshot; readonly parent: Place | undefined; readonly step: string }
	const stack: Place[] = [{ value, parent: undefined, step: root }];
	while (stack.length > 0) {
		const place = stack.pop() as Place;
		const item = place.value;
		if (item instanceof Odd) {
			const steps: string[] = [];
			for (let p: Place | undefined = place; p !== undefined; p = p.parent) steps.push(p.step);
			return { path: steps.reverse().join(""), odd: item };
		}
		if (Array.isArray(item)) for (let i = item.length - 1; i >= 0; i--) stack.push({ value: item[i] as Snapshot, parent: place, step: `[${i}]` });
		else if (isContainer(item)) {
			const names = Object.keys(item);
			for (let i = names.length - 1; i >= 0; i--) stack.push({ value: item[names[i] as string] as Snapshot, parent: place, step: `.${names[i] as string}` });
		}
	}
	return undefined;
}

/** Why the Odd at a place makes a value no JSON value, after the place's path. */
export function oddWhy(path: string, odd: Odd): string {
	switch (odd.kind) {
		case "itself": return `${path} holds itself`;
		case "non-finite": return `${path} is ${odd.text}, not a finite number`;
		case "bigint": return `${path} is a BigInt, not a JSON value`;
		case "undefined": return `${path} is undefined, not a JSON value`;
		case "symbol": case "function": return `${path} is a ${odd.kind}, not a JSON value`;
		case "threw": return `${path} could not be read: ${oneLine(odd.thrown)}`;
		default: return `${path} is an object that is no plain JSON object`;
	}
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

/** What a value is, in a few words, as a diagnostic names what `word` returned. */
export function describe(value: Snapshot): string {
	if (value === null) return "null";
	if (value instanceof Odd) {
		switch (value.kind) {
			case "undefined": return "nothing";
			case "non-finite": return "a number";
			case "bigint": case "symbol": case "function": case "promise": return `a ${value.kind}`;
			default: return "an object";
		}
	}
	if (Array.isArray(value)) return "an array";
	return typeof value === "object" ? "an object" : `a ${typeof value}`;
}
