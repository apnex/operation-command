/**
 * Repeating an unknown ending (OC5): the arguments that follow the program's name, and the one command line
 * the plain form prints.
 *
 * In order: the command's name; each setting that is not secret and took a value, in the order the
 * declaration lists them, with the text of each value exactly as it was taken from its flag, its variable or
 * its default; `--json` when it was given; the command's own flags as given, in the order given; and, for a command that changes
 * something, `--invocation` and the identity, so the owner of the effect can recognise the repeat. An
 * `--invocation` the command was given is never copied, since the reader keeps it apart from the flags.
 */
import { INVOCATION_FLAG, JSON_FLAG } from "./declaration.js";
import type { ReadCommand } from "./reading.js";

/**
 * The `repeat` array of an unknown ending: the arguments that follow the program's name. `own`, when given, is
 * a parts command's own flags as `resume` made them (OC5), in place of the flags as given.
 */
export function repeatArguments(read: ReadCommand, invocation: string, own?: readonly string[]): readonly string[] {
	const args: string[] = [read.command.name];
	for (const taken of read.settings) {
		// A secret is supplied again by whoever runs the repeat; a switch on is its flag alone.
		if (taken.flag.secret) continue;
		if (taken.flag.isSwitch) args.push(taken.flag.flag);
		else for (const text of taken.texts) args.push(taken.flag.flag, text);
	}
	if (read.json) args.push(JSON_FLAG);
	args.push(...(own ?? givenArguments(read)));
	if (read.command.changes) args.push(INVOCATION_FLAG, invocation);
	return Object.freeze(args);
}

/** The command's own flags as given, in the order given, as arguments. */
export function givenArguments(read: ReadCommand): readonly string[] {
	const args: string[] = [];
	for (const given of read.given) {
		args.push(given.flag.flag);
		if (given.text !== undefined) args.push(given.text);
	}
	return args;
}

/** One shell word in single quotes, each single quote within it written `'\''`. */
export function shellWord(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The plain form's repeat: the program's name, then each argument, each as one shell word. */
export function repeatLine(programName: string, args: readonly string[]): string {
	return [programName, ...args].map(shellWord).join(" ");
}
