/**
 * The process adapter: runs a declared program as the command of a Node process - its arguments after the
 * program's name, its environment, its two output streams, and `SIGINT` and `SIGTERM` as interruptions -
 * and exits with the command's status once everything it printed is written. It is the one file of the
 * package particular to a runtime (zorg's D31; principle 6).
 *
 * While a command that invokes is running, `SIGINT` and `SIGTERM` are the command's to handle (OC4), so
 * neither ends the process; a local command's code is handed the process with neither handled.
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

/** A writer to a stream that remembers each write until the stream has taken it. */
function writer(stream: NodeJS.WriteStream, pending: Promise<void>[]): (text: string) => void {
	return (text) => {
		pending.push(new Promise<void>((resolve) => { stream.write(text, () => resolve()); }));
	};
}

/** Runs one command of a program as this process, and exits with its status. */
export function runProcess(program: Program, options: ProcessOptions = {}): void {
	const pending: Promise<void>[] = [];
	const stdout = writer(process.stdout, pending);
	const stderr = writer(process.stderr, pending);
	// Waiting on the application's client keeps the process alive even when the client holds nothing that
	// would, so a command whose prepare or run has not settled waits for it, as OC3 and OC4 say, and never
	// exits as though it had ended. This timer has no deadline: its waking does nothing.
	const keepAlive = setInterval(() => undefined, 0x7fffffff);
	const exit = async (status: number): Promise<void> => {
		await Promise.all(pending);
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
