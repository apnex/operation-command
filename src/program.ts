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
import { EXIT_STATUS, oneLine, printEnding, readEnding, RUN_FAILED, type Ending, type Wording } from "./endings.js";
import { readCommand, type ReadCommand } from "./reading.js";
import { repeatArguments } from "./repeat.js";
import { systemCommandClock, systemIdentities } from "./system-ports.js";

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

const isObject = (value: unknown): value is { readonly [key: string]: unknown } => value !== null && typeof value === "object" && !Array.isArray(value);

/** What `prepare` settled to, judged (OC3): ready, its not-delivered ending's codes, or what was wrong. */
type Prepared = { readonly kind: "ready" } | { readonly kind: "ending"; readonly agpCode: string | null; readonly proxyCode: string | null } | { readonly kind: "failed"; readonly diagnostic: string };

function judgePrepared(outcome: { readonly value: unknown } | { readonly error: unknown }): Prepared {
	if ("error" in outcome) return { kind: "failed", diagnostic: `diagnostic: prepare failed: ${oneLine(outcome.error)}` };
	const value = outcome.value;
	if (value === "ready") return { kind: "ready" };
	if (isObject(value) && value["ending"] === "not-delivered") {
		const agpCode = value["agpCode"] ?? null;
		const proxyCode = value["proxyCode"] ?? null;
		if ((agpCode === null || typeof agpCode === "string") && (proxyCode === null || typeof proxyCode === "string")) return { kind: "ending", agpCode, proxyCode };
	}
	return { kind: "failed", diagnostic: `diagnostic: prepare settled to ${oneLine(value)}, neither ready nor a not-delivered ending` };
}

/** Settles a value that may be a promise, or a call that may throw, as an outcome. */
function outcomeOf(call: () => unknown): Promise<{ readonly value: unknown } | { readonly error: unknown }> {
	let pending: Promise<unknown>;
	try {
		pending = Promise.resolve(call());
	} catch (error) {
		pending = Promise.reject(error);
	}
	return pending.then((value) => ({ value }), (error: unknown) => ({ error }));
}

/** Declares a program: checks the declaration (OC1), throwing a DeclarationError naming any rule it breaks. */
export function declareProgram<Client extends object>(declaration: ProgramDeclaration<Client>): Program {
	const program = compileProgram(declaration as ProgramDeclaration<object>);
	return Object.freeze({ name: program.name, run: (io: CommandIo) => runCommand(program, io) });
}

async function runCommand(program: CompiledProgram, io: CommandIo): Promise<number> {
	const clock = io.clock ?? systemCommandClock;
	// The reading when the command began reading its arguments, from which preparing's deadline runs (OC3).
	const began = readClock(clock);
	let onInterrupt = (): void => undefined;
	const unsubscribe = io.interruptions?.subscribe(() => onInterrupt());
	const reading = readCommand(program, io.args, io.env);
	if (!reading.ok) {
		io.stderr(`usage: ${reading.usage}\n`);
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
	const report = (ending: Ending): number => {
		const printed = printEnding(ending, { operation: command.operation, invocation, repeat: repeatArgs, json, program: program.name, word: command.word as Wording | undefined, flags });
		if (printed.diagnostic !== undefined) io.stderr(`${printed.diagnostic}\n`);
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
			if (prepared.kind === "failed") io.stderr(`${prepared.diagnostic}\n`);
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
	const ended = "error" in outcome ? { ok: false as const, why: `run failed: ${oneLine(outcome.error)}` } : readEnding(outcome.value);
	if (!ended.ok) {
		// Whether run invoked anything cannot be known, so the ending is unknown, with the repeat that goes with it.
		io.stderr(`diagnostic: ${ended.why}\n`);
		return report({ ending: "unknown", reason: RUN_FAILED, agpCode: null, deliveryReport: null });
	}
	return report(ended.ending);
}
