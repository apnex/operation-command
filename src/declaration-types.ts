/**
 * The declaration of a program (OC1): its settings, its commands and its client, written as data, with the
 * application's functions that run each command through its client and word its answers.
 */
import type { CallEnding, JsonValue } from "@apnex/operation-call";

/** A flag's type and its valid values (OC1). */
export type ValueType =
	/** A string the whole of which matches `pattern`, a regular expression written as text: from the value's first character to its last. */
	| { readonly kind: "string"; readonly pattern: string }
	/** A whole number from `min` to `max`, each a safe integer. */
	| { readonly kind: "integer"; readonly min: number; readonly max: number }
	/** A duration from `min` to `max`, each written as a duration, such as `1ms` or `24h`. */
	| { readonly kind: "duration"; readonly min: string; readonly max: string }
	/** A URL whose scheme, written without its colon, is one of `schemes`. */
	| { readonly kind: "url"; readonly schemes: readonly string[] }
	/** A switch: given alone, it is on; not given, it is off. */
	| { readonly kind: "switch" };

/** What a command's own flag and a setting share (OC1). */
export interface FlagParts {
	/** The flag as written: `--` and a name of lowercase letters, digits and hyphens. */
	readonly flag: string;
	readonly type: ValueType;
	/** The flag must be given; a setting with a variable may be given by its variable instead. */
	readonly required?: boolean;
	/** The flag may be given more than once, each value kept in order. */
	readonly repeats?: boolean;
	/** The application's words for the flag, kept for the reference outside Delta 1 (OC6). */
	readonly description?: string;
}

/** A command's own flag (OC1). */
export interface FlagDeclaration extends FlagParts {
	/** Others of the command's own flags that may not be given with this one; never a setting. */
	readonly excludes?: readonly string[];
	/** Others of the command's own flags that must be given when this one is; never a setting. */
	readonly requires?: readonly string[];
}

/** A setting, offered by every command (OC1); it excludes and requires nothing, so a repeat keeps every relation (OC5). */
export interface SettingDeclaration extends FlagParts {
	/** The environment variable standing in for the flag; a setting with one is required or has a default. */
	readonly variable?: string;
	/** The default, written as text as it would be given to the flag. */
	readonly default?: string;
	/** A secret setting is never written into a repeat (OC5). */
	readonly secret?: boolean;
}

/** A group of a command's own flags (OC1, OC2). */
export type GroupDeclaration = { readonly exactlyOne: readonly string[] } | { readonly atLeastOne: readonly string[] };

/** A flag's value as `run` is given it: text, a number of milliseconds or a whole number, a switch's state, or the list of a repeating flag's values. */
export type FlagValue = string | number | boolean | readonly (string | number)[];

/** The values a command read, keyed by flag without its leading `--`; a flag that took no value is absent, and a switch is false when off. */
export type Flags = { readonly [name: string]: FlagValue };

/** The clock port: milliseconds that a change to the wall clock does not move (OC1). */
export interface CommandClock {
	now(): number;
}

/** What `run` is given (OC3). */
export interface RunContext<Client> {
	readonly client: Client;
	/** The command's name, as declared. */
	readonly command: string;
	/** The operation the command invokes, as declared. */
	readonly operation: string;
	readonly flags: Flags;
	/** The call's bound, in milliseconds, from the declaration's bound setting; it starts when `run` invokes. */
	readonly bound: number;
	/** The invocation identity, under which `run` makes its first call. */
	readonly invocation: string;
	/** Whether the invocation is marked a repeat. */
	readonly repeat: boolean;
	/** Fired when the command is interrupted after calling `run` (OC4). */
	readonly signal: AbortSignal;
}

/** What a local command's code is given. */
export interface LocalContext<Client> {
	readonly client: Client;
	readonly command: string;
	readonly flags: Flags;
	/** The environment the command read. */
	readonly env: { readonly [name: string]: string | undefined };
	readonly stdout: (text: string) => void;
	readonly stderr: (text: string) => void;
}

/** What `prepare` is given (OC3). */
export interface PrepareRequest {
	/** The clock port's reading when the command began reading its arguments, plus its preparation setting. */
	readonly deadline: number;
	readonly clock: CommandClock;
	/** Fired when the command is interrupted while preparing (OC4). */
	readonly signal: AbortSignal;
	/** The command's name, as declared. */
	readonly command: string;
	/** The values the command read, so the client can reach what its settings name. */
	readonly flags: Flags;
}

/** A not-delivered ending as `prepare` may settle to, as plain data: the call layer's form, of which the command keeps the codes. */
export interface PrepareNotDelivered {
	readonly ending: "not-delivered";
	readonly agpCode?: string | null;
	readonly proxyCode?: string | null;
	readonly invocation?: string | null;
	readonly attempt?: string | null;
	readonly operation?: string | null;
	readonly earlierAttemptsUncertain?: boolean;
}

/** What `prepare` settles to. */
export type PrepareResult = "ready" | PrepareNotDelivered;

/** A client: whatever the application's commands run through, which may offer `prepare` (OC3). */
export interface CommandClient {
	prepare?(request: PrepareRequest): PrepareResult | Promise<PrepareResult>;
}

/** A command that invokes an operation (OC1). */
export interface InvokingCommandDeclaration<Client> {
	readonly name: string;
	readonly local?: false;
	/** The name of the operation it invokes. */
	readonly operation: string;
	/** Whether it changes anything. */
	readonly changes: boolean;
	readonly flags?: readonly FlagDeclaration[];
	readonly groups?: readonly GroupDeclaration[];
	/** Performs the invocation through the client and returns the call layer's ending. */
	run(context: RunContext<Client>): CallEnding | Promise<CallEnding>;
	/** Words an answer for the plain form, as one or more lines; by default `answer: ` and its JSON. */
	word?(answer: JsonValue, flags: Flags): string;
	readonly description?: string;
}

/** A local command: its flags are read and passed to the application's code, whose exit is its own (OC1). */
export interface LocalCommandDeclaration<Client> {
	readonly name: string;
	readonly local: true;
	readonly flags?: readonly FlagDeclaration[];
	readonly groups?: readonly GroupDeclaration[];
	/** The application's code; it gives the command's exit status. */
	run(context: LocalContext<Client>): number | Promise<number>;
	readonly description?: string;
}

/** A command (OC1). */
export type CommandDeclaration<Client> = InvokingCommandDeclaration<Client> | LocalCommandDeclaration<Client>;

/** A program, declared as data (OC1). */
export interface ProgramDeclaration<Client extends object = CommandClient> {
	/** The program's name, as the plain repeat begins with it (OC5). */
	readonly name: string;
	readonly settings: readonly SettingDeclaration[];
	readonly commands: readonly CommandDeclaration<Client>[];
	readonly client: Client;
	/** The flag of the duration setting giving the call's bound (`command-call-bound`). */
	readonly callBound?: string;
	/** The flag of the duration setting giving the time to prepare (`command-call-bound`). */
	readonly prepareTime?: string;
	readonly description?: string;
}
