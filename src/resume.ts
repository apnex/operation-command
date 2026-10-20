/**
 * A parts command's resume (OC5): what its application's `resume` gives - the command's own flags it changes,
 * read as plain data and checked - made into the command's own flags for its repeat, and kept, as given, for
 * the ending's `resume` (OC4).
 *
 * Each flag it names takes the place of every value given for it, at the place of the first; one not given
 * follows the flags given, in the order the command declares its flags; every flag it does not name stays as
 * given. The flags so made must read, with the settings the command used, as the command's arguments are read
 * (OC2); where they do not, or `resume` throws, returns a promise or returns what is no such object, there is
 * no resume, and why is said in one line.
 */
import type { JsonValue } from "@apnex/operation-call";
import { observePromises, readPlainJson } from "@apnex/shape-check";
import type { CompiledFlag, CompiledProgram } from "./declaration.js";
import { readCommand, type ReadCommand } from "./reading.js";
import { describe, DIAGNOSTIC_LIMIT } from "./value-text.js";

/** What resuming gave: the flags `resume` gave and the command's own flags made from them, or why there are none. */
export type Resumed =
	| { readonly ok: true; readonly value: JsonValue; readonly own: readonly string[] }
	| { readonly ok: false; readonly why: string };

const refused = (why: string): Resumed => ({ ok: false, why });

/** What a flag's value in `resume`'s result must be, said for a diagnostic. */
const wanted = (flag: CompiledFlag): string => flag.isSwitch ? "true, false or null" : flag.repeats ? "a list of texts or null" : "a text or null";

/** Whether a value read from `resume`'s result is one its flag takes. */
function fits(flag: CompiledFlag, value: JsonValue): boolean {
	if (value === null) return true;
	if (flag.isSwitch) return typeof value === "boolean";
	if (flag.repeats) return Array.isArray(value) && value.every((text) => typeof text === "string");
	return typeof value === "string";
}

/** The arguments a named flag's value gives: none for `null` or a switch off, the flag alone for a switch on, else the flag before each text. */
function argumentsOf(flag: CompiledFlag, value: JsonValue, out: string[]): void {
	if (value === null || value === false) return;
	if (value === true) {
		out.push(flag.flag);
		return;
	}
	for (const text of Array.isArray(value) ? value : [value]) out.push(flag.flag, text as string);
}

/**
 * Calls a parts command's `resume` once with the last part printed, or `null`, and the frozen flags `run` and
 * `word` are given (OC5); never throws. Whatever it returns or throws that is refused has its native promises
 * observed and is described from its own data descriptors only.
 */
export function resumeFlags(program: CompiledProgram, read: ReadCommand, lastPart: JsonValue | null): Resumed {
	const resume = read.command.resume as (lastPart: JsonValue | null, flags: unknown) => unknown;
	let returned: unknown;
	try {
		returned = resume(lastPart, read.flags);
	} catch (error) {
		observePromises(error, DIAGNOSTIC_LIMIT);
		return refused(`resume threw ${describe(error, true)}`);
	}
	let promise: boolean;
	try {
		promise = returned instanceof Promise;
	} catch (error) {
		// A Proxy's trap that throws while it is asked whether it is a promise: it is no flags.
		observePromises(error, DIAGNOSTIC_LIMIT);
		observePromises(returned, DIAGNOSTIC_LIMIT);
		return refused(`resume returned ${describe(returned)}, which could not be read`);
	}
	if (promise) {
		observePromises(returned, DIAGNOSTIC_LIMIT);
		return refused("resume returned a promise, not the command's own flags");
	}
	const reading = readPlainJson(returned);
	if (!reading.ok || reading.value === null || typeof reading.value !== "object" || Array.isArray(reading.value)) {
		observePromises(returned, DIAGNOSTIC_LIMIT);
		return refused(`resume returned ${describe(returned)}, not an object of the command's own flags read as plain data`);
	}
	const value = reading.value as { readonly [key: string]: JsonValue };
	const own = new Map(read.command.flags.map((flag) => [flag.key, flag]));
	const named = new Set<string>();
	for (const key of Object.keys(value)) {
		const flag = own.get(key);
		if (flag === undefined) return refused(`resume named ${JSON.stringify(key)}, which is not one of the command ${read.command.name}'s own flags, named without its leading --`);
		if (!fits(flag, value[key] as JsonValue)) return refused(`resume gave ${flag.flag} ${describe(value[key])}, which is not ${wanted(flag)}`);
		named.add(key);
	}
	// The flags as given, each named flag's values in place of the first it was given, the rest following in declared order.
	const args: string[] = [];
	const placed = new Set<string>();
	for (const given of read.given) {
		const key = given.flag.key;
		if (named.has(key)) {
			if (!placed.has(key)) argumentsOf(given.flag, value[key] as JsonValue, args);
			placed.add(key);
			continue;
		}
		args.push(given.flag.flag);
		if (given.text !== undefined) args.push(given.text);
	}
	for (const flag of read.command.flags) if (named.has(flag.key) && !placed.has(flag.key)) argumentsOf(flag, value[flag.key] as JsonValue, args);
	// They must read, with every setting the command used - a secret included, though no repeat writes it - as the command's arguments are read.
	const check: string[] = [read.command.name];
	for (const taken of read.settings) {
		if (taken.flag.isSwitch) check.push(taken.flag.flag);
		else for (const text of taken.texts) check.push(taken.flag.flag, text);
	}
	const reread = readCommand(program, [...check, ...args], {});
	if (!reread.ok) return refused(`resume gave flags the command does not read: ${reread.usage}`);
	return { ok: true, value, own: Object.freeze(args) };
}
