/**
 * Generating a reference of a declared program from its declaration alone (OC6; zorg's D57).
 *
 * Nothing is written beside the declaration: every setting, command, flag, group, relation, variable, default,
 * type and description is formatted from the compiled declaration model.
 */
import { compileProgram, INVOCATION_FLAG, JSON_FLAG, type CompiledFlag, type CompiledProgram } from "./declaration.js";
import type { ProgramDeclaration, ValueType } from "./declaration-types.js";

/** Formats a flag's value type and valid values (OC1, OC6). */
function formatValueType(type: ValueType): string {
	switch (type.kind) {
		case "string":
			return `string (pattern: ${type.pattern})`;
		case "integer":
			return `integer (${type.min} to ${type.max})`;
		case "duration":
			return `duration (${type.min} to ${type.max})`;
		case "url":
			return `url (schemes: ${type.schemes.join(", ")}${type.pattern === undefined ? "" : `, pattern: ${type.pattern}`})`;
		case "switch":
			return "switch";
	}
}

/** Formats one setting or command flag line. */
function formatFlag(flag: CompiledFlag, indent: string): string {
	const parts: string[] = [flag.flag, `type: ${formatValueType(flag.rawType)}`];
	if (flag.variable !== undefined) parts.push(`variable: ${flag.variable}`);
	if (flag.required) parts.push("required");
	if (flag.defaultText !== undefined) parts.push(`default: ${JSON.stringify(flag.defaultText)}`);
	if (flag.repeats) parts.push("repeats");
	if (flag.secret) parts.push("secret");
	if (flag.excludes.length > 0) parts.push(`excludes: ${flag.excludes.join(", ")}`);
	if (flag.requires.length > 0) parts.push(`requires: ${flag.requires.join(", ")}`);
	if (flag.description !== undefined) parts.push(`description: ${flag.description}`);
	return `${indent}${parts.join("; ")}`;
}

/** Formats a compiled program's deterministic reference (OC6). */
export function formatCompiledReference(program: CompiledProgram): string {
	const lines: string[] = [`program: ${program.name}`];
	if (program.description !== undefined) lines.push(`description: ${program.description}`);
	if (program.callBoundFlag !== undefined) lines.push(`call-bound: ${program.callBoundFlag}`);
	if (program.prepareTimeFlag !== undefined) lines.push(`prepare-time: ${program.prepareTimeFlag}`);
	lines.push("settings:");
	if (program.settings.length === 0) {
		lines.push("  (none)");
	} else {
		for (const setting of program.settings) lines.push(formatFlag(setting, "  "));
	}
	lines.push("commands:");
	for (const command of program.commands.values()) {
		const head = command.local
			? `  ${command.name} (local)`
			: `  ${command.name} (operation: ${command.operation}; changes: ${command.changes})`;
		lines.push(command.description === undefined ? head : `${head} - ${command.description}`);
		for (const flag of command.flags) lines.push(formatFlag(flag, "    "));
		if (!command.local) {
			lines.push(`    ${INVOCATION_FLAG}; operation-command: invocation identity`);
			lines.push(`    ${JSON_FLAG}; type: switch; operation-command: JSON ending output`);
		}
		for (const group of command.groups) {
			const kind = group.kind === "exactlyOne" ? "exactly-one" : "at-least-one";
			lines.push(`    group (${kind}): ${group.flags.join(", ")}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Validates a program declaration and formats its command reference (OC1, OC6). */
export function formatReference<Client extends object>(declaration: ProgramDeclaration<Client>): string {
	return formatCompiledReference(compileProgram(declaration as ProgramDeclaration<object>));
}
