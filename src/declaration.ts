/**
 * Checking a declaration (OC1): a declaration that breaks a rule is refused by a thrown error naming the
 * rule, when it is given to operation-command and before any argument is read - the application's defect,
 * never a command's ending. A declaration that keeps every rule is copied into the frozen model the
 * reader and the runner use, so a later change to the application's objects changes nothing.
 */
import type { CommandDeclaration, ProgramDeclaration, SettingDeclaration, ValueType } from "./declaration-types.js";
import { durationMs, prepareType, wholePattern, type PreparedType } from "./values.js";

/** The rules a declaration keeps, each named by the error that refuses a declaration breaking it. */
export type DeclarationRule =
	| "program-form" | "unknown-field" | "flag-form" | "flag-taken" | "invocation-reserved" | "value-type"
	| "variable-form" | "variable-taken" | "setting-without-value" | "required-with-default" | "default-invalid"
	| "switch-form" | "command-flag-form" | "flag-relation" | "group-form" | "command-form" | "command-taken"
	| "operation-name" | "call-settings" | "json-reserved";

/** The error refusing a declaration that breaks a rule (OC1); its message begins with the rule's name. */
export class DeclarationError extends Error {
	readonly rule: DeclarationRule;
	constructor(rule: DeclarationRule, message: string) {
		super(`${rule}: ${message}`);
		this.name = "DeclarationError";
		this.rule = rule;
	}
}

/** A flag as the reader uses it: a setting's or a command's own. */
export interface CompiledFlag {
	readonly flag: string;
	/** The flag without its leading `--`: the key of its value in the flags `run` is given. */
	readonly key: string;
	readonly type: PreparedType;
	readonly rawType: ValueType;
	readonly isSwitch: boolean;
	readonly required: boolean;
	readonly repeats: boolean;
	readonly excludes: readonly string[];
	readonly requires: readonly string[];
	readonly setting: boolean;
	readonly variable: string | undefined;
	readonly defaultText: string | undefined;
	readonly secret: boolean;
	readonly description: string | undefined;
}

/** A group of a command's own flags. */
export interface CompiledGroup {
	readonly kind: "exactlyOne" | "atLeastOne";
	readonly flags: readonly string[];
}

/** A command as the reader and the runner use it. */
export interface CompiledCommand {
	readonly name: string;
	readonly local: boolean;
	readonly operation: string;
	readonly changes: boolean;
	/** The command's own flags, in the order declared. */
	readonly flags: readonly CompiledFlag[];
	readonly groups: readonly CompiledGroup[];
	readonly run: (context: never) => unknown;
	readonly word: ((answer: never, flags: never) => unknown) | undefined;
	readonly description: string | undefined;
}

/** A program as the reader and the runner use it. */
export interface CompiledProgram {
	readonly name: string;
	readonly description: string | undefined;
	/** The settings, in the order declared. */
	readonly settings: readonly CompiledFlag[];
	readonly commands: ReadonlyMap<string, CompiledCommand>;
	readonly client: object;
	/** The keys of the bound and preparation settings, when any command invokes. */
	readonly callBound: string | undefined;
	readonly prepareTime: string | undefined;
	readonly callBoundFlag: string | undefined;
	readonly prepareTimeFlag: string | undefined;
}

/** operation-command's own flag, offered by every command that is not local (OC1, OC3). */
export const INVOCATION_FLAG = "--invocation";

/** operation-command's own switch choosing an ending's JSON form, offered by every command that is not local (OC1, OC4). */
export const JSON_FLAG = "--json";

const FLAG_PATTERN = /^--[a-z0-9][a-z0-9-]*$/;
const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMAND_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** EM1's name pattern, which an operation's name must match to be called (zorg's target, EM1). */
const OPERATION_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;
/** The largest call bound the call layer takes, in milliseconds (zorg's target, EM12). */
const MAX_BOUND_MS = 2147483647;

const fail = (rule: DeclarationRule, message: string): never => { throw new DeclarationError(rule, message); };
const isObject = (value: unknown): value is { readonly [key: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);
const quote = (value: unknown): string => typeof value === "string" ? JSON.stringify(value) : String(value);

/** Refuses a part holding a field the declaration does not have, so a misspelt field is never silently ignored. */
function onlyFields(part: { readonly [key: string]: unknown }, allowed: readonly string[], what: string): void {
	for (const key of Object.keys(part)) if (!allowed.includes(key)) fail("unknown-field", `${what} has the field ${quote(key)}, which a declaration does not have; its fields are ${allowed.join(", ")}`);
}

/** Checks an optional boolean field. */
function flagOf(part: { readonly [key: string]: unknown }, key: string, what: string, rule: DeclarationRule): boolean {
	const value = part[key];
	if (value === undefined) return false;
	if (typeof value !== "boolean") fail(rule, `${what}'s ${key} is true or false, not ${quote(value)}`);
	return value as boolean;
}

/** Checks an optional description. */
function checkDescription(part: { readonly [key: string]: unknown }, what: string): void {
	if (part["description"] !== undefined && typeof part["description"] !== "string") fail("unknown-field", `${what}'s description is text`);
}

/** Checks that a type's pattern is a regular expression, standing alone and anchored as a whole value is matched (OC1). */
function checkPattern(pattern: string, what: string): void {
	try {
		// The pattern stands alone, so one such as "a)(b" is not made valid by the anchoring around it.
		new RegExp(pattern);
		wholePattern(pattern);
	} catch {
		fail("value-type", `${what}'s pattern ${quote(pattern)} is not a regular expression`);
	}
}

/** Checks a type and its valid values, and prepares it. */
function checkType(type: unknown, what: string): PreparedType {
	if (!isObject(type)) return fail("value-type", `${what} has no type: one of string, integer, duration, url or switch, as { kind, ... }`);
	const kind = type["kind"];
	switch (kind) {
		case "string":
			onlyFields(type, ["kind", "pattern"], `${what}'s type`);
			if (typeof type["pattern"] !== "string") fail("value-type", `${what} is a string, whose type states its pattern as text`);
			checkPattern(type["pattern"] as string, what);
			break;
		case "integer": {
			onlyFields(type, ["kind", "min", "max"], `${what}'s type`);
			const { min, max } = type;
			if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || (min as number) > (max as number)) fail("value-type", `${what} is a whole number, whose type states its bounds min and max, safe integers with min no more than max`);
			break;
		}
		case "duration": {
			onlyFields(type, ["kind", "min", "max"], `${what}'s type`);
			const min = typeof type["min"] === "string" ? durationMs(type["min"]) : undefined;
			const max = typeof type["max"] === "string" ? durationMs(type["max"]) : undefined;
			// Each bound a whole number of milliseconds held exactly, so the range compared is the range declared.
			if (min === undefined || max === undefined || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) fail("value-type", `${what} is a duration, whose type states its bounds min and max, each a duration such as 1ms or 24h of no more than ${Number.MAX_SAFE_INTEGER} milliseconds, min no more than max`);
			break;
		}
		case "url": {
			onlyFields(type, ["kind", "schemes", "pattern"], `${what}'s type`);
			const schemes = type["schemes"];
			if (!Array.isArray(schemes) || schemes.length === 0 || !schemes.every((s) => typeof s === "string" && SCHEME_PATTERN.test(s))) fail("value-type", `${what} is a URL, whose type states its schemes, a list of one or more schemes written without their colon, such as ws`);
			// A URL's type may also state a pattern, which its whole text must match after the parser and the scheme (OC1).
			if (type["pattern"] !== undefined) {
				if (typeof type["pattern"] !== "string") fail("value-type", `${what} is a URL whose type states a pattern, which is written as text`);
				checkPattern(type["pattern"] as string, what);
			}
			break;
		}
		case "switch":
			onlyFields(type, ["kind"], `${what}'s type`);
			break;
		default:
			fail("value-type", `${what}'s type is ${quote(kind)}, not one of string, integer, duration, url or switch`);
	}
	return prepareType(structuredClone(type) as unknown as ValueType);
}

/** Checks the part of a flag that settings and commands' own flags share. */
function checkFlag(part: unknown, what: string, setting: boolean): Omit<CompiledFlag, "excludes" | "requires"> & { excludes: readonly string[]; requires: readonly string[] } {
	if (!isObject(part)) return fail(setting ? "program-form" : "command-flag-form", `${what} is not an object`);
	const flag = part["flag"];
	if (typeof flag !== "string" || !FLAG_PATTERN.test(flag)) fail("flag-form", `${what}'s flag ${quote(flag)} is not -- followed by lowercase letters, digits and hyphens`);
	const name = `${setting ? "the setting" : "the flag"} ${flag as string}`;
	if (flag === INVOCATION_FLAG) fail("invocation-reserved", `${INVOCATION_FLAG} is operation-command's own flag, offered by every command that is not local, and no flag of the application's`);
	if (flag === JSON_FLAG) fail("json-reserved", `${JSON_FLAG} is operation-command's own switch, offered by every command that is not local, and no flag of the application's`);
	if (setting) {
		// Relations are among a command's own flags only (OC1): a setting's variable and default would make its
		// repeat, which writes every setting that took a value (OC5), break a relation the first run kept.
		for (const key of ["excludes", "requires"]) if (part[key] !== undefined) fail("flag-relation", `${name} declares ${key}, but a setting excludes and requires nothing: only a command's own flag may exclude or require another of that command's own flags`);
		onlyFields(part, ["flag", "type", "required", "repeats", "description", "variable", "default", "secret"], name);
	} else {
		for (const key of ["variable", "default", "secret"]) if (part[key] !== undefined) fail("command-flag-form", `${name} is a command's own flag, which takes no variable, no default and no secret; only a setting does`);
		onlyFields(part, ["flag", "type", "required", "repeats", "excludes", "requires", "description"], name);
	}
	checkDescription(part, name);
	const type = checkType(part["type"], name);
	const required = flagOf(part, "required", name, "program-form");
	const repeats = flagOf(part, "repeats", name, "program-form");
	const secret = setting ? flagOf(part, "secret", name, "program-form") : false;
	const relation = (key: "excludes" | "requires"): readonly string[] => {
		const value = part[key];
		if (value === undefined) return [];
		if (!Array.isArray(value) || !value.every((f) => typeof f === "string")) return fail("flag-relation", `${name}'s ${key} is a list of flags`);
		return Object.freeze([...value]);
	};
	const variable = part["variable"];
	const defaultText = part["default"];
	if (variable !== undefined && (typeof variable !== "string" || !VARIABLE_PATTERN.test(variable))) fail("variable-form", `${name}'s variable ${quote(variable)} is not a name of letters, digits and underscores, not beginning with a digit`);
	if (defaultText !== undefined && typeof defaultText !== "string") fail("default-invalid", `${name}'s default is written as text, as it would be given to the flag`);
	const isSwitch = type.kind === "switch";
	if (isSwitch && (variable !== undefined || defaultText !== undefined)) fail("switch-form", `${name} is a switch, which has no variable and no default, so it is off unless given`);
	if (isSwitch && (required || repeats)) fail("switch-form", `${name} is a switch, which is on when given and off otherwise, so it is neither required nor repeats`);
	if (required && defaultText !== undefined) fail("required-with-default", `${name} is required and has a default; a setting takes a value by being required or by having a default, and its default would never be taken`);
	if (variable !== undefined && !required && defaultText === undefined) fail("setting-without-value", `${name} has the variable ${variable as string} but neither a default nor required, and a setting with a variable always takes a value`);
	if (defaultText !== undefined) {
		const read = type.read(defaultText as string);
		if (!read.ok) fail("default-invalid", `${name}'s default ${quote(defaultText)} ${read.why}`);
	}
	const rawType = Object.freeze(structuredClone(part["type"]) as unknown as ValueType);
	return {
		flag: flag as string, key: (flag as string).slice(2), type, rawType, isSwitch, required, repeats, setting, secret,
		excludes: relation("excludes"), requires: relation("requires"),
		variable: variable as string | undefined, defaultText: defaultText as string | undefined,
		description: part["description"] as string | undefined,
	};
}

/** Checks that each of a command's own flags excludes or requires only others of that command's own flags, never a setting. */
function checkRelations(flags: readonly CompiledFlag[], scope: string): void {
	const names = new Set(flags.map((f) => f.flag));
	for (const f of flags) {
		for (const other of [...f.excludes, ...f.requires]) {
			if (other === f.flag || !names.has(other)) fail("flag-relation", `${f.flag} excludes or requires ${quote(other)}, which is not another of ${scope}; a flag relates only to its command's own flags, never to a setting`);
		}
	}
}

/** Checks a command's groups of its own flags. */
function checkGroups(groups: unknown, own: readonly CompiledFlag[], command: string): readonly CompiledGroup[] {
	if (groups === undefined) return [];
	if (!Array.isArray(groups)) return fail("group-form", `the command ${command}'s groups are a list`);
	const names = new Set(own.map((f) => f.flag));
	return Object.freeze(groups.map((g: unknown): CompiledGroup => {
		if (!isObject(g) || Object.keys(g).length !== 1 || !(Array.isArray(g["exactlyOne"]) || Array.isArray(g["atLeastOne"]))) {
			return fail("group-form", `a group of the command ${command} is { exactlyOne: [flags] } or { atLeastOne: [flags] }`);
		}
		const kind = Array.isArray(g["exactlyOne"]) ? "exactlyOne" : "atLeastOne";
		const flags = g[kind] as unknown[];
		if (flags.length === 0 || new Set(flags).size !== flags.length) fail("group-form", `a group of the command ${command} names one or more flags, each once`);
		for (const f of flags) if (typeof f !== "string" || !names.has(f)) fail("group-form", `a group of the command ${command} names ${quote(f)}, which is not one of its own flags`);
		return Object.freeze({ kind, flags: Object.freeze([...flags as string[]]) });
	}));
}

/** Checks one command against the settings. */
function checkCommand(part: unknown, settings: readonly CompiledFlag[]): CompiledCommand {
	if (!isObject(part)) return fail("command-form", "a command is not an object");
	const name = part["name"];
	if (typeof name !== "string" || !COMMAND_PATTERN.test(name)) fail("command-form", `a command's name ${quote(name)} is not lowercase letters, digits and hyphens`);
	const what = `the command ${name as string}`;
	const local = part["local"] === true;
	if (part["local"] !== undefined && typeof part["local"] !== "boolean") fail("command-form", `${what}'s local is true or false`);
	if (local) onlyFields(part, ["name", "local", "flags", "groups", "run", "description"], what);
	else onlyFields(part, ["name", "local", "operation", "changes", "flags", "groups", "run", "word", "description"], what);
	checkDescription(part, what);
	if (typeof part["run"] !== "function") fail("command-form", `${what} has no run function`);
	if (!local) {
		if (typeof part["operation"] !== "string" || !OPERATION_PATTERN.test(part["operation"])) fail("operation-name", `${what}'s operation ${quote(part["operation"])} is not a name matching ^[a-z0-9][a-z0-9-]{0,62}$`);
		if (typeof part["changes"] !== "boolean") fail("command-form", `${what} says whether it changes anything, as changes: true or false`);
		if (part["word"] !== undefined && typeof part["word"] !== "function") fail("command-form", `${what}'s word is a function`);
	}
	const declared = part["flags"] ?? [];
	if (!Array.isArray(declared)) return fail("command-form", `${what}'s flags are a list`);
	const taken = new Set(settings.map((s) => s.flag));
	const flags = declared.map((f: unknown, i: number) => {
		const flag = Object.freeze(checkFlag(f, `${what}'s flag ${i + 1}`, false));
		if (taken.has(flag.flag)) fail("flag-taken", `${what} declares ${flag.flag}, which is already a setting or another of its flags`);
		taken.add(flag.flag);
		return flag;
	});
	checkRelations(flags, `${what}'s own flags`);
	const groups = checkGroups(part["groups"], flags, name as string);
	return Object.freeze({
		name: name as string, local, operation: local ? "" : part["operation"] as string, changes: local ? false : part["changes"] as boolean,
		flags: Object.freeze(flags), groups, run: part["run"] as CompiledCommand["run"],
		word: part["word"] as CompiledCommand["word"],
		description: part["description"] as string | undefined,
	});
}

/** Checks the setting a declaration names as the call's bound or its time to prepare. */
function callSetting(flag: unknown, settings: readonly CompiledFlag[], which: string, range: readonly [number, number]): string {
	const setting = typeof flag === "string" ? settings.find((s) => s.flag === flag) : undefined;
	if (setting === undefined) return fail("call-settings", `a program with a command that invokes names the setting giving ${which}, ${quote(flag)} names none`);
	if (setting.type.kind !== "duration" || setting.repeats || !(setting.required || setting.defaultText !== undefined)) {
		fail("call-settings", `${setting.flag}, giving ${which}, is a duration setting given once that always takes a value, being required or having a default`);
	}
	// Its declared range lies wholly within the permitted one: its lower bound and its upper bound each checked.
	const { min, max } = setting.type as { readonly min: number; readonly max: number };
	if (min < range[0] || max > range[1]) fail("call-settings", `${setting.flag}, giving ${which}, declares the range ${min} to ${max} milliseconds, which does not lie within ${range[0]} to ${range[1]} milliseconds`);
	return setting.key;
}

/** Checks a whole declaration and gives its model, or throws a DeclarationError naming the rule it breaks. */
export function compileProgram(declaration: ProgramDeclaration<object>): CompiledProgram {
	if (!isObject(declaration)) return fail("program-form", "a program's declaration is an object: { name, settings, commands, client, callBound, prepareTime }");
	onlyFields(declaration, ["name", "settings", "commands", "client", "callBound", "prepareTime", "description"], "the program");
	checkDescription(declaration, "the program");
	const { name, client } = declaration;
	if (typeof name !== "string" || name.length === 0) fail("program-form", "a program's name is text, not empty");
	if (client === null || (typeof client !== "object" && typeof client !== "function")) fail("program-form", "a program's client is an object the application supplies");
	if (!Array.isArray(declaration.settings)) fail("program-form", "a program's settings are a list");
	if (!Array.isArray(declaration.commands) || declaration.commands.length === 0) fail("program-form", "a program's commands are a list of one or more");
	const settings: CompiledFlag[] = [];
	const variables = new Set<string>();
	for (const [i, s] of (declaration.settings as readonly SettingDeclaration[]).entries()) {
		const setting = Object.freeze(checkFlag(s, `setting ${i + 1}`, true));
		if (settings.some((t) => t.flag === setting.flag)) fail("flag-taken", `the setting ${setting.flag} is declared twice`);
		if (setting.variable !== undefined) {
			if (variables.has(setting.variable)) fail("variable-taken", `the variable ${setting.variable} stands in for two settings`);
			variables.add(setting.variable);
		}
		settings.push(setting);
	}
	const commands = new Map<string, CompiledCommand>();
	for (const c of declaration.commands as readonly CommandDeclaration<object>[]) {
		const command = checkCommand(c, settings);
		if (commands.has(command.name)) fail("command-taken", `the command ${command.name} is declared twice`);
		commands.set(command.name, command);
	}
	const invokes = [...commands.values()].some((c) => !c.local);
	let callBound: string | undefined;
	let prepareTime: string | undefined;
	if (invokes) {
		callBound = callSetting(declaration.callBound, settings, "the call's bound", [1, MAX_BOUND_MS]);
		prepareTime = callSetting(declaration.prepareTime, settings, "the time to prepare", [0, MAX_BOUND_MS]);
	} else if (declaration.callBound !== undefined || declaration.prepareTime !== undefined) {
		fail("call-settings", "a program whose every command is local names no setting for a call's bound or its time to prepare");
	}
	return Object.freeze({
		name: name as string,
		description: declaration.description as string | undefined,
		settings: Object.freeze(settings),
		commands,
		client: client as object,
		callBound,
		prepareTime,
		callBoundFlag: callBound === undefined ? undefined : `--${callBound}`,
		prepareTimeFlag: prepareTime === undefined ? undefined : `--${prepareTime}`,
	});
}

