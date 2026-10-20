/**
 * The process adapter: runs a declared program as the command of a Node process - its arguments after the
 * program's name, its environment, its two output streams, and `SIGINT` and `SIGTERM` as interruptions -
 * and exits with the command's status once everything it printed is written. It is the one file of the
 * package particular to a runtime (zorg's D31; principle 6).
 *
 * While a command that invokes is running, `SIGINT` and `SIGTERM` are the command's to handle (OC4), so
 * neither ends the process; a local command's code is handed the process with neither handled.
 *
 * Each write returns a native promise that fulfils when the stream calls back for the text and rejects when
 * the callback carries an error, whatever `write` itself returned, so a parts command counts what is unwritten
 * (OC4). The adapter counts its writes not yet settled and keeps nothing of one once it has settled, and it
 * listens for the errors of both its streams, so a stream that breaks fails its writes and ends no process.
 */
import type { IdentitySource } from "@apnex/operation-call";
import type { CommandClock } from "./declaration-types.js";
import type { Interruptions, Program } from "./program.js";

/** What a process may replace: the clock port and the identity source, as a test does. */
export interface ProcessOptions {
	readonly clock?: CommandClock;
	readonly identities?: IdentitySource;
}

/** Interruptions from the process's `SIGINT` and `SIGTERM`, handled only while someone listens. */
function processInterruptions(): Interruptions {
	const listeners = new Set<() => void>();
	const handler = (): void => { for (const listener of [...listeners]) listener(); };
	return {
		subscribe(listener) {
			if (listeners.size === 0) {
				process.on("SIGINT", handler);
				process.on("SIGTERM", handler);
			}
			const entry = (): void => listener();
			listeners.add(entry);
			return () => {
				if (!listeners.delete(entry) || listeners.size > 0) return;
				process.off("SIGINT", handler);
				process.off("SIGTERM", handler);
			};
		},
	};
}

/** The writes of the process not yet settled: how many, and who waits for there to be none. */
class Outstanding {
	#count = 0;
	#idle: (() => void)[] = [];
	begin(): void {
		this.#count++;
	}
	end(): void {
		this.#count--;
		if (this.#count > 0) return;
		const idle = this.#idle;
		this.#idle = [];
		for (const resolve of idle) resolve();
	}
	/** Settles once no write is outstanding. */
	none(): Promise<void> {
		return this.#count === 0 ? Promise.resolve() : new Promise((resolve) => this.#idle.push(resolve));
	}
}

/** A writer to a stream: each write's promise settles when the stream calls back for it, and is observed here too. */
function writer(stream: NodeJS.WriteStream, outstanding: Outstanding): (text: string) => Promise<void> {
	return (text) => {
		outstanding.begin();
		const written = new Promise<void>((resolve, reject) => {
			try {
				stream.write(text, (error) => {
					if (error) reject(error);
					else resolve();
					// Counted settled only after the reactions to its promise have run, so a diagnostic one of them
					// writes is begun before the process may exit.
					setImmediate(() => outstanding.end());
				});
			} catch (error) {
				outstanding.end();
				reject(error);
			}
		});
		// Observed here, so a write nobody awaits - a diagnostic's - never leaves an unhandled rejection.
		written.then(undefined, () => undefined);
		return written;
	};
}

/** Runs one command of a program as this process, and exits with its status. */
export function runProcess(program: Program, options: ProcessOptions = {}): void {
	const outstanding = new Outstanding();
	// A stream that breaks, as standard output does when its reader goes, fails its writes and ends no process.
	process.stdout.on("error", () => undefined);
	process.stderr.on("error", () => undefined);
	const stdout = writer(process.stdout, outstanding);
	const stderr = writer(process.stderr, outstanding);
	// Waiting on the application's client keeps the process alive even when the client holds nothing that
	// would, so a command whose prepare or run has not settled waits for it, as OC3 and OC4 say, and never
	// exits as though it had ended. This timer has no deadline: its waking does nothing.
	const keepAlive = setInterval(() => undefined, 0x7fffffff);
	const exit = async (status: number): Promise<void> => {
		await outstanding.none();
		clearInterval(keepAlive);
		process.exit(status);
	};
	program.run({
		args: process.argv.slice(2), env: process.env, stdout, stderr, interruptions: processInterruptions(),
		...(options.clock === undefined ? {} : { clock: options.clock }),
		...(options.identities === undefined ? {} : { identities: options.identities }),
	}).then((status) => exit(status), (error: unknown) => {
		// The application's defect, such as a local command that threw: written whole, and the process fails.
		stderr(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		return exit(1);
	});
}
