// run-command - runs the fixture command, or any command, as a child process, its standard output and
// standard error each captured to a file the test reads once the process has exited, never through a pipe;
// a test may wait on the fixture's record file and send the process real signals while it runs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterOnClock, realClock, sleep } from "./clock-timer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_COMMAND = path.join(here, "fixture-command.js");
export const INTEGRATED_COMMAND = path.join(here, "integrated-command.js");

let directory;
let runs = 0;
/** A fresh path in this process's scratch directory. */
export function scratch(name) {
	directory ??= fs.mkdtempSync(path.join(os.tmpdir(), "operation-command-"));
	return path.join(directory, `${++runs}-${name}`);
}

/** Reads a record file: one JSON object per line. */
export function readRecords(file) {
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

/**
 * Starts a child process with its two output streams in files. `env` is the whole environment besides PATH.
 * Gives the child, its record file, and `ended`, which settles to its status, signal and both outputs.
 */
export function start(file, args, { env = {}, scenario, record = scratch("record.jsonl"), argv0 } = {}) {
	const out = scratch("stdout.txt");
	const err = scratch("stderr.txt");
	const outFd = fs.openSync(out, "w");
	const errFd = fs.openSync(err, "w");
	const fullEnv = { PATH: process.env.PATH, ...env };
	if (scenario !== undefined) fullEnv.OC_FIXTURE_SCENARIO = JSON.stringify({ record, ...scenario });
	const child = spawn(file, args, { env: fullEnv, stdio: ["ignore", outFd, errFd], ...(argv0 ? { argv0 } : {}) });
	fs.closeSync(outFd);
	fs.closeSync(errFd);
	const ended = new Promise((resolve, reject) => {
		const cancel = afterOnClock(realClock, realClock.now() + 60_000, () => {
			child.kill("SIGKILL");
			reject(new Error(`${path.basename(file)} ${args.join(" ")} did not exit within 60 s`));
		});
		child.on("error", (error) => { cancel(); reject(error); });
		child.on("exit", (status, signal) => {
			cancel();
			resolve({ status, signal, stdout: fs.readFileSync(out, "utf8"), stderr: fs.readFileSync(err, "utf8"), records: readRecords(record) });
		});
	});
	return {
		child, record, ended,
		records: () => readRecords(record),
		/** Waits, on the real clock with a wide margin, until the record file holds an event. */
		async waitFor(event, ms = 20_000) {
			const end = realClock.now() + ms;
			for (;;) {
				const found = readRecords(record).find((r) => r.event === event);
				if (found) return found;
				if (realClock.now() > end) throw new Error(`the command never recorded ${event}`);
				await sleep(5);
			}
		},
		signal: (name) => child.kill(name),
	};
}

/** Starts the fixture command with these arguments and a scenario. */
export function startFixture(args, { env = {}, scenario = {}, record } = {}) {
	return start(process.execPath, [FIXTURE_COMMAND, ...args], { env, scenario, ...(record ? { record } : {}) });
}

/** Runs the fixture command to its exit. */
export function runFixture(args, options = {}) {
	return startFixture(args, options).ended;
}

/** The environment every fixture command needs: its two required settings, given by their variables. */
export const BASE_ENV = Object.freeze({ FIX_HOST: "host-a", FIX_IDENTITY: "alice" });

/**
 * A directory holding an executable named `name` that runs the fixture command, so a POSIX shell running a
 * plain repeat that begins with that name runs the fixture.
 */
export function programDirectory(name, command = FIXTURE_COMMAND) {
	const dir = scratch("bin");
	fs.mkdirSync(dir);
	const script = `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${command.replaceAll("'", "'\\''")}' "$@"\n`;
	fs.writeFileSync(path.join(dir, name), script, { mode: 0o755 });
	return dir;
}

/** Splits a command line into words as a POSIX shell does, by having /bin/sh print each word it was given. */
export async function shellWords(line) {
	const result = await start("/bin/sh", ["-c", `printf '%s\\0' ${line}`]).ended;
	if (result.status !== 0) throw new Error(`the shell could not split ${line}: ${result.stderr}`);
	return result.stdout.split("\0").slice(0, -1);
}

/** Runs a command line through /bin/sh, with `dir` first on PATH, as whoever runs a printed repeat would. */
export function runShellLine(line, { dir, env = {}, scenario = {}, record } = {}) {
	return start("/bin/sh", ["-c", line], { env: { ...env, PATH: `${dir}:${process.env.PATH}` }, scenario, ...(record ? { record } : {}) }).ended;
}

/** The plain form's lines as an object of name to value, for the facts a test reads. */
export function plainFacts(stdout) {
	const facts = {};
	for (const line of stdout.split("\n")) {
		const colon = line.indexOf(": ");
		if (colon > 0) facts[line.slice(0, colon)] = line.slice(colon + 2);
	}
	return facts;
}
