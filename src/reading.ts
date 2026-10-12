/**
 * Reading a command (OC2): its name, then its flags written `--flag value`, `--flag=value`, or `--flag` alone
 * for a switch. A setting's value comes from its flag, else its variable, else its default, and a variable
 * set to the empty string counts as unset. Every way a command can break its declaration is a usage error,
 * found here before anything is prepared or invoked, and described in one line.
 */
import { isInvocationId } from "@apnex/operation-call/message-format";
import { INVOCATION_FLAG, type CompiledCommand, type CompiledFlag, type CompiledProgram } from "./declaration.js";
import type { FlagValue, Flags } from "./declaration-types.js";

/** Where a setting's value came from. */
export type Source = "flag" | "variable" | "default";

/** The values one setting or flag took: the text of each, exactly as it was taken, and where they came from. */
export interface Taken {
	readonly flag: CompiledFlag;
	readonly texts: readonly string[];
	readonly source: Source;
}

/** One of a command's own flags as given, in the order given: its text, or none for a switch. */
export interface Given {
	readonly flag: CompiledFlag;
	readonly text: string | undefined;
}

/** A command read without a usage error. */
export interface ReadCommand {
	readonly command: CompiledCommand;
	readonly flags: Flags;
	/** Each setting that took a value, in the order the declaration lists them. */
	readonly settings: readonly Taken[];
	/** The command's own flags as given, in the order given. */
	readonly given: readonly Given[];
	/** The identity `--invocation` gave, if it was given. */
	readonly invocation: string | undefined;
}

/** What reading the arguments gives: the command, or the one line saying what was wrong. */
export type Reading = { readonly ok: true; readonly read: ReadCommand } | { readonly ok: false; readonly usage: string };

const show = (text: string): string => JSON.stringify(text);

/** A usage error, thrown inside the reader and caught at its edge. */
class Usage {
	constructor(readonly line: string) {}
}
const usage = (line: string): never => { throw new Usage(line); };

/** The value `run` is given for the texts a flag took; a switch that took a value was given, so it is on. */
function valueOf(flag: CompiledFlag, texts: readonly string[]): FlagValue {
	if (flag.isSwitch) return true;
	const values = texts.map((text) => {
		const read = flag.type.read(text);
		return read.ok ? read.value : usage(`the value ${show(text)} of ${flag.flag} ${read.why}`);
	});
	return flag.repeats ? Object.freeze(values) : values[0] as string | number;
}

/** Reads the arguments that follow the program's name, against the declaration and the environment. */
export function readCommand(program: CompiledProgram, args: readonly string[], env: { readonly [name: string]: string | undefined }): Reading {
	try {
		return { ok: true, read: readOrThrow(program, args, env) };
	} catch (error) {
		if (error instanceof Usage) return { ok: false, usage: error.line };
		throw error;
	}
}

function readOrThrow(program: CompiledProgram, args: readonly string[], env: { readonly [name: string]: string | undefined }): ReadCommand {
	const names = [...program.commands.keys()].join(", ");
	const name = args[0];
	if (name === undefined) return usage(`no command was given; the commands are ${names}`);
	const command = program.commands.get(name);
	if (command === undefined) return usage(`unknown command ${show(name)}; the commands are ${names}`);
	const known = new Map<string, CompiledFlag>([...program.settings, ...command.flags].map((f) => [f.flag, f]));

	// The arguments, in order: each a flag the command offers, with its value when it takes one.
	const texts = new Map<string, string[]>();
	const given: Given[] = [];
	let invocation: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i] as string;
		if (!arg.startsWith("--")) usage(`unexpected argument ${show(arg)} to the command ${name}; flags are written --flag value, --flag=value, or --flag alone for a switch`);
		const equals = arg.indexOf("=");
		const flagText = equals < 0 ? arg : arg.slice(0, equals);
		const inline = equals < 0 ? undefined : arg.slice(equals + 1);
		if (flagText === INVOCATION_FLAG && !command.local) {
			const value = inline ?? args[++i];
			if (value === undefined) usage(`the flag ${INVOCATION_FLAG} has no value`);
			if (invocation !== undefined) usage(`the flag ${INVOCATION_FLAG} was given twice and may not repeat`);
			if (!isInvocationId(value)) usage(`the value ${show(String(value))} of ${INVOCATION_FLAG} is not an invocation identity: 13 digits of milliseconds, a hyphen and 16 lowercase hexadecimal digits`);
			invocation = value;
			continue;
		}
		const flag = known.get(flagText);
		if (flag === undefined) usage(`unknown flag ${show(flagText)} for the command ${name}`);
		const f = flag as CompiledFlag;
		let text: string | undefined;
		if (f.isSwitch) {
			if (inline !== undefined) usage(`the switch ${f.flag} takes no value, and was given ${show(inline)}`);
		} else {
			// The next argument is the value whatever it holds, so any value, one beginning -- included, can be given.
			text = inline ?? args[++i];
			if (text === undefined) usage(`the flag ${f.flag} has no value`);
		}
		const seen = texts.get(f.flag);
		if (seen !== undefined && !f.repeats) usage(`the flag ${f.flag} was given twice and may not repeat`);
		if (text !== undefined) {
			const read = f.type.read(text);
			if (!read.ok) usage(`the value ${show(text)} of ${f.flag} ${read.why}`);
		}
		if (seen === undefined) texts.set(f.flag, text === undefined ? [] : [text]);
		else if (text !== undefined) seen.push(text);
		if (!f.setting) given.push({ flag: f, text });
	}

	// Each setting from its flag, else its variable, else its default; a variable set empty counts as unset.
	const settings: Taken[] = [];
	const values: { [key: string]: FlagValue } = {};
	const present = new Set<string>();
	for (const s of program.settings) {
		const fromFlag = texts.get(s.flag);
		const fromVariable = s.variable === undefined ? undefined : env[s.variable];
		let taken: Taken | undefined;
		if (fromFlag !== undefined) taken = { flag: s, texts: fromFlag, source: "flag" };
		else if (fromVariable !== undefined && fromVariable !== "") {
			const read = s.type.read(fromVariable);
			if (!read.ok) usage(`the value ${show(fromVariable)} of the variable ${s.variable as string}, standing in for ${s.flag}, ${read.why}`);
			taken = { flag: s, texts: [fromVariable], source: "variable" };
		} else if (s.defaultText !== undefined) taken = { flag: s, texts: [s.defaultText], source: "default" };
		if (taken === undefined) {
			if (s.required) usage(s.variable === undefined ? `the flag ${s.flag} is required` : `the flag ${s.flag}, or its variable ${s.variable}, is required`);
			if (s.isSwitch) values[s.key] = false;
			continue;
		}
		// A setting given by its flag or by the variable standing in for it is given; one taking its default is not.
		if (taken.source !== "default") present.add(s.flag);
		settings.push(taken);
		values[s.key] = valueOf(s, taken.texts);
	}
	for (const f of command.flags) {
		const own = texts.get(f.flag);
		if (own === undefined) {
			if (f.required) usage(`the flag ${f.flag} is required by the command ${name}`);
			if (f.isSwitch) values[f.key] = false;
			continue;
		}
		present.add(f.flag);
		values[f.key] = valueOf(f, own);
	}

	// Flags that exclude or require others, then the command's groups.
	for (const f of [...program.settings, ...command.flags]) {
		if (!present.has(f.flag)) continue;
		for (const other of f.excludes) if (present.has(other)) usage(`the flags ${f.flag} and ${other} exclude each other`);
		for (const other of f.requires) if (!present.has(other)) usage(`the flag ${f.flag} requires ${other}, which was not given`);
	}
	for (const g of command.groups) {
		const count = g.flags.filter((f) => present.has(f)).length;
		const list = g.flags.join(", ");
		if (count === 0) usage(`the command ${name} needs ${g.kind === "exactlyOne" ? "exactly one" : "at least one"} of ${list}, and was given none`);
		if (count > 1 && g.kind === "exactlyOne") usage(`the command ${name} needs exactly one of ${list}, and was given ${count}`);
	}
	return Object.freeze({ command, flags: Object.freeze(values), settings: Object.freeze(settings), given: Object.freeze(given), invocation });
}
