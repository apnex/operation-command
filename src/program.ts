/**
 * Running one command (OC2 to OC5): read it, fix its invocation identity, prepare the client, call `run`, and
 * report the ending through the exit status - or refuse the command, or report an interruption before
 * `run`, with nothing invoked.
 *
 * The command keeps no timer of its own: preparing's deadline is the client's to keep, and the call's bound
 * the call layer's. Interruptions before `run` fire `prepare`'s abort signal and end the command at once;
 * the first after `run` fires `run`'s, and none makes it exit without the ending the call layer gives.
 */
import type { IdentitySource } from "@apnex/operation-call";
import { isInvocationId } from "@apnex/operation-call/message-format";
import { compileProgram, type CompiledCommand, type CompiledProgram } from "./declaration.js";
import type { CommandClock, Flags, LocalContext, ProgramDeclaration, RunContext } from "./declaration-types.js";
import type { JsonValue } from "@apnex/operation-call";
import { observePromises, readPlainJson } from "@apnex/shape-check";
import { outcomeOf, type Settled } from "./client-value.js";
import { EXIT_STATUS, printEnding, readEnding, RUN_FAILED, type Ending, type Wording } from "./endings.js";
import { readCommand, type ReadCommand } from "./reading.js";
import { formatCompiledReference } from "./reference.js";
import { repeatArguments } from "./repeat.js";
import { systemCommandClock, systemIdentities } from "./system-ports.js";
import { describe, DIAGNOSTIC_LIMIT, diagnosticLine, singleLine } from "./value-text.js";

/** Where interruptions come from: the process's `SIGINT` and `SIGTERM`, or a test's. */
export interface Interruptions {
	/** Calls `listener` at each interruption, until the returned function is called. */
	subscribe(listener: () => void): () => void;
}

/** What one run of a command is given. */
export interface CommandIo {
	/** The arguments that follow the program's name. */
	readonly args: readonly string[];
	readonly env: { readonly [name: string]: string | undefined };
	/** Writes to standard output, which carries only an ending. */
	readonly stdout: (text: string) => void;
	/** Writes to standard error, which carries diagnostics, usage errors and the report of an interruption before `run`. */
	readonly stderr: (text: string) => void;
	readonly interruptions?: Interruptions;
	/** The clock port; `performance.now()` by default (OC1). */
	readonly clock?: CommandClock;
	/** Where a new invocation identity takes its time and randomness from; operation-call's by default. */
	readonly identities?: IdentitySource;
}

/** A declared program. */
export interface Program {
	readonly name: string;
	/** Runs one command and gives its exit status; it never exits the process itself. */
	run(io: CommandIo): Promise<number>;
	/** Generates the deterministic reference of the program from its declaration (OC6). */
	reference(): string;
}

/** The line reporting an interruption before `run` (OC4). */
export const INTERRUPTED_LINE = "interrupted: nothing was invoked";

/** A new invocation identity, as zorg's target EM11 writes it. */
function newInvocation(identities: IdentitySource): string {
	const ms = identities.wallTimeMs();
	const invocation = `${String(Math.floor(ms)).padStart(13, "0")}-${identities.randomHex(16)}`;
	if (!isInvocationId(invocation)) throw new TypeError(`the identity source gave ${JSON.stringify(invocation)}, not an invocation identity`);
	return invocation;
}

/** Reads the clock port; a reading that is no finite number is the port's fault. */
function readClock(clock: CommandClock): number {
	const now = clock.now();
	if (typeof now !== "number" || !Number.isFinite(now)) throw new TypeError(`the clock port read ${String(now)}, not a finite number of milliseconds`);
	return now;
}

/** What `prepare` settled to, judged (OC3): ready, its not-delivered ending's codes, or what was wrong. */
type Prepared = { readonly kind: "ready" } | { readonly kind: "ending"; readonly agpCode: string | null; readonly proxyCode: string | null } | { readonly kind: "failed"; readonly diagnostic: string };

/** The fields a not-delivered ending from `prepare` may hold besides `ending`, and what each may be (OC3). */
const textOrNull = (value: unknown): boolean => value === null || typeof value === "string";
const PREPARE_FIELDS: ReadonlyMap<string, (value: unknown) => boolean> = new Map<string, (value: unknown) => boolean>([
	["agpCode", textOrNull],
	["proxyCode", textOrNull],
	["invocation", textOrNull],
	["attempt", textOrNull],
	["operation", textOrNull],
	["earlierAttemptsUncertain", (value: unknown): boolean => typeof value === "boolean"],
]);

/** The codes of a plain-data not-delivered ending, or undefined when the value read is none. */
function notDeliveredCodes(value: JsonValue): { readonly agpCode: string | null; readonly proxyCode: string | null } | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as { readonly [name: string]: JsonValue };
	if (record.ending !== "not-delivered") return undefined;
	for (const name of Object.keys(record)) {
		if (name === "ending") continue;
		const valid = PREPARE_FIELDS.get(name);
		if (valid === undefined || !valid(record[name])) return undefined;
	}
	return { agpCode: (record.agpCode as string | null | undefined) ?? null, proxyCode: (record.proxyCode as string | null | undefined) ?? null };
}

/**
 * Judges what prepare settled to; never throws, so reading a malformed result is inside the boundary that
 * makes it not delivered. `ready` is the string "ready"; anything else must read, through shape-check's
 * `readPlainJson` (zorg's D54, D55), as a plain-data not-delivered ending holding no field OC3 does not name.
 * Whatever fails has its native promises observed, and is described from its own data descriptors only.
 */
function judgePrepared(outcome: Settled): Prepared {
	const failed = (what: unknown, diagnostic: () => string): Prepared => {
		observePromises(what, DIAGNOSTIC_LIMIT);
		return { kind: "failed", diagnostic: diagnostic() };
	};
	if ("error" in outcome) return failed(outcome.error, () => `prepare failed: ${describe(outcome.error, true)}`);
	const value = outcome.value;
	if (value === "ready") return { kind: "ready" };
	const read = readPlainJson(value);
	const codes = read.ok ? notDeliveredCodes(read.value) : undefined;
	if (codes === undefined) return failed(value, () => `prepare settled to ${describe(value)}, neither ready nor a not-delivered ending read as plain data`);
	return { kind: "ending", ...codes };
}

/** Declares a program: checks the declaration (OC1), throwing a DeclarationError naming any rule it breaks. */
export function declareProgram<Client extends object>(declaration: ProgramDeclaration<Client>): Program {
	const program = compileProgram(declaration as ProgramDeclaration<object>);
	const text = formatCompiledReference(program);
	return Object.freeze({ name: program.name, run: (io: CommandIo) => runCommand(program, io), reference: () => text });
}

async function runCommand(program: CompiledProgram, io: CommandIo): Promise<number> {
	const clock = io.clock ?? systemCommandClock;
	// The reading when the command began reading its arguments, from which preparing's deadline runs (OC3).
	const began = readClock(clock);
	// An interruption from the moment of subscribing is remembered, one while the arguments are read included,
	// and handled as an interruption before run: nothing is prepared or invoked (OC4).
	let interruptedWhileReading = false;
	let onInterrupt = (): void => { interruptedWhileReading = true; };
	const unsubscribe = io.interruptions?.subscribe(() => onInterrupt());
	const reading = readCommand(program, io.args, io.env);
	if (interruptedWhileReading) {
		io.stderr(`${INTERRUPTED_LINE}\n`);
		return EXIT_STATUS.interrupted;
	}
	if (!reading.ok) {
		// Always one line, whatever a declared pattern or a value holds (OC2).
		io.stderr(`usage: ${singleLine(reading.usage)}\n`);
		return EXIT_STATUS.usage;
	}
	const read = reading.read;
	if (read.command.local) {
		// A local command's code owns its interruptions and its exit.
		unsubscribe?.();
		return runLocal(program, read, io);
	}
	return runInvoking(program, read, io, clock, began, (listener) => { onInterrupt = listener; });
}

async function runLocal(program: CompiledProgram, read: ReadCommand, io: CommandIo): Promise<number> {
	const context: LocalContext<object> = Object.freeze({ client: program.client, command: read.command.name, flags: read.flags, env: io.env, stdout: io.stdout, stderr: io.stderr });
	const status = await (read.command.run as (context: LocalContext<object>) => unknown)(context);
	if (!Number.isInteger(status) || (status as number) < 0 || (status as number) > 255) throw new TypeError(`the local command ${read.command.name} gave the exit status ${String(status)}, not a whole number from 0 to 255`);
	return status as number;
}

async function runInvoking(program: CompiledProgram, read: ReadCommand, io: CommandIo, clock: CommandClock, began: number, interruptWith: (listener: () => void) => void): Promise<number> {
	const command: CompiledCommand = read.command;
	let interrupted = false;
	interruptWith(() => { interrupted = true; });
	// The identity is fixed before anything is prepared; one --invocation gave marks a repeat only for a command that changes something.
	const invocation = read.invocation ?? newInvocation(io.identities ?? systemIdentities);
	const repeat = command.changes && read.invocation !== undefined;
	const flags: Flags = read.flags;
	const json = read.json;
	const repeatArgs = repeatArguments(read, invocation);
	// A diagnostic is always one line, cut at 1000 characters (OC4).
	const diagnose = (text: string): void => { io.stderr(`${diagnosticLine(text)}\n`); };
	const report = (ending: Ending): number => {
		const printed = printEnding(ending, { operation: command.operation, invocation, repeat: repeatArgs, json, program: program.name, word: command.word as Wording | undefined, flags });
		if (printed.diagnostic !== undefined) diagnose(printed.diagnostic);
		io.stdout(printed.out);
		return EXIT_STATUS[ending.ending];
	};
	const interruptedBeforeRun = (): number => {
		io.stderr(`${INTERRUPTED_LINE}\n`);
		return EXIT_STATUS.interrupted;
	};
	if (interrupted) return interruptedBeforeRun();

	const client = program.client as { readonly prepare?: unknown };
	const prepare = client.prepare;
	if (typeof prepare === "function") {
		const deadline = began + (flags[program.prepareTime as string] as number);
		const controller = new AbortController();
		const settled = await new Promise<{ readonly interrupted: true } | { readonly interrupted: false; readonly prepared: Prepared }>((resolve) => {
			interruptWith(() => {
				interruptWith(() => undefined);
				interrupted = true;
				controller.abort();
				resolve({ interrupted: true });
			});
			const request = Object.freeze({ deadline, clock, signal: controller.signal, command: command.name, flags });
			void outcomeOf(() => prepare.call(client, request)).then((outcome) => resolve({ interrupted: false, prepared: judgePrepared(outcome) }));
		});
		// Interrupted while preparing: nothing more is called, whatever prepare settles to afterwards.
		if (settled.interrupted || interrupted) return interruptedBeforeRun();
		const prepared = settled.prepared;
		if (prepared.kind !== "ready") {
			if (prepared.kind === "failed") diagnose(`diagnostic: ${prepared.diagnostic}`);
			const codes = prepared.kind === "ending" ? prepared : { agpCode: null, proxyCode: null };
			return report({ ending: "not-delivered", agpCode: codes.agpCode, proxyCode: codes.proxyCode, earlierAttemptsUncertain: repeat });
		}
	}

	// run is called: the first interruption fires its abort signal, and none ends the wait for its ending.
	const controller = new AbortController();
	interruptWith(() => { if (!controller.signal.aborted) controller.abort(); });
	const context: RunContext<object> = Object.freeze({
		client: program.client, command: command.name, operation: command.operation, flags,
		bound: flags[program.callBound as string] as number, invocation, repeat, signal: controller.signal,
	});
	const outcome = await outcomeOf(() => (command.run as (context: RunContext<object>) => unknown)(context));
	// The ending is given: an interruption from here, while it is printed included, changes nothing.
	interruptWith(() => undefined);
	// What it rejected with, or what it settled to that is no ending, has its promises observed before it is described.
	const failedWith = (error: unknown): { readonly ok: false; readonly why: string } => {
		observePromises(error, DIAGNOSTIC_LIMIT);
		return { ok: false, why: `run failed: ${describe(error, true)}` };
	};
	const ended = "error" in outcome ? failedWith(outcome.error) : readEnding(outcome.value);
	if (!ended.ok) {
		// Whether run invoked anything cannot be known, so the ending is unknown, with the repeat that goes with it.
		diagnose(`diagnostic: ${ended.why}`);
		return report({ ending: "unknown", reason: RUN_FAILED, agpCode: null, deliveryReport: null });
	}
	return report(ended.ending);
}
