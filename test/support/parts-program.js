// parts-program - an application with parts commands (OC1, OC3 to OC5; zorg's Delta 4, stage 8), run in this
// process through a captured standard output whose writes a test may hold, release, refuse or reject, and
// interruptions a test fires. Each test gives the commands' `run`, and may give `wordPart`, `resume`, `word`
// and the client's `prepare`.
import { declareProgram } from "@apnex/operation-command";

export const ADDRESS = Object.freeze({ invocation: "1791540000000-1234567890abcdef", attempt: "1791540000000-1234567890abcdef.0123abcd" });
export const ENV = Object.freeze({ PT_HOST: "hub-a" });
export const LIMIT = 16777216;

const text = { kind: "string", pattern: "^[\\s\\S]*$" };

/** The settings, a secret among them. */
export const SETTINGS = Object.freeze([
	{ flag: "--host", variable: "PT_HOST", required: true, type: { kind: "string", pattern: "^[a-z0-9-]+$" } },
	{ flag: "--token", variable: "PT_TOKEN", default: "public", secret: true, type: { kind: "string", pattern: "^[A-Za-z0-9]+$" } },
	{ flag: "--timeout", variable: "PT_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" } },
	{ flag: "--connect-timeout", variable: "PT_CONNECT_TIMEOUT", default: "5s", type: { kind: "duration", min: "0ms", max: "24h" } },
]);

/** `follow`'s own flags, of every type. */
export const FOLLOW_FLAGS = Object.freeze([
	{ flag: "--since", required: true, type: { kind: "integer", min: 0, max: 9007199254740991 } },
	{ flag: "--tag", repeats: true, type: text },
	{ flag: "--max", type: { kind: "integer", min: 1, max: 1000 } },
	{ flag: "--for", type: { kind: "duration", min: "1s", max: "24h" } },
	{ flag: "--quiet", type: { kind: "switch" } },
]);

/** `watch`'s own flags, with an exclusion, a requirement and a group of each kind. */
export const WATCH_FLAGS = Object.freeze([
	{ flag: "--a", excludes: ["--b"], type: text },
	{ flag: "--b", type: text },
	{ flag: "--c", requires: ["--d"], type: { kind: "switch" } },
	{ flag: "--d", type: text },
	{ flag: "--x", type: text },
	{ flag: "--y", type: text },
	{ flag: "--z", type: text },
	{ flag: "--w", type: text },
]);
export const WATCH_GROUPS = Object.freeze([{ exactlyOne: ["--x", "--y"] }, { atLeastOne: ["--z", "--w"] }]);

/** An ending as the call layer gives it, for the operation named. */
export const ending = (fields, operation = "follow") => ({ ...fields, ...ADDRESS, operation });

/**
 * Declares the parts program: `follow` and `watch`, parts commands running `run`, and `read`, which is not.
 * `options` may give `wordPart`, `resume`, `word` and `prepare`; `resume` and `wordPart` go to both parts commands.
 */
export function partsProgram({ run, wordPart, resume, word, prepare, readRun } = {}) {
	const extra = { ...(wordPart === undefined ? {} : { wordPart }), ...(resume === undefined ? {} : { resume }), ...(word === undefined ? {} : { word }) };
	return declareProgram({
		name: "pt",
		settings: SETTINGS,
		commands: [
			{ name: "follow", operation: "follow", changes: false, parts: true, flags: FOLLOW_FLAGS, run, ...extra },
			{ name: "watch", operation: "watch", changes: false, parts: true, flags: WATCH_FLAGS, groups: WATCH_GROUPS, run, ...extra },
			{ name: "read", operation: "read", changes: false, run: readRun ?? run },
		],
		client: prepare === undefined ? {} : { prepare },
		callBound: "--timeout",
		prepareTime: "--connect-timeout",
	});
}

/** The UTF-8 bytes of a text. */
export const bytesOf = (value) => Buffer.byteLength(value, "utf8");

/**
 * A standard output and error to capture. With `hold`, each standard output write returns a promise the test
 * settles through `held`; `refuse(text)` makes a write throw, `reject(text)` makes it return a rejected promise,
 * and `resolved(text)` makes it return an already fulfilled one.
 */
export function capture({ hold = false, refuse, reject, resolved } = {}) {
	const out = [];
	const attempted = [];
	const err = [];
	const held = [];
	let highWater = 0;
	const unwritten = () => held.reduce((sum, h) => sum + h.bytes, 0);
	return {
		out, attempted, err, held, unwritten,
		highWater: () => highWater,
		stdout: (text) => {
			attempted.push(text);
			if (refuse?.(text)) throw new Error("standard output refused the text");
			out.push(text);
			if (reject?.(text)) return Promise.reject(new Error("standard output broke"));
			if (resolved?.(text)) return Promise.resolve();
			if (!hold) return undefined;
			return new Promise((resolve, rejecting) => {
				const entry = { text, bytes: bytesOf(text) };
				entry.release = () => { held.splice(held.indexOf(entry), 1); resolve(); };
				entry.fail = () => { held.splice(held.indexOf(entry), 1); rejecting(new Error("the held write failed")); };
				held.push(entry);
				highWater = Math.max(highWater, unwritten());
			});
		},
		stderr: (text) => { err.push(text); },
		/** Releases every held write, and any made while releasing, one at a time, each settled before the next. */
		async drain() {
			while (held.length > 0) {
				held[0].release();
				await tick();
			}
		},
		get stdoutText() { return out.join(""); },
		get diagnostics() { return err.join("").split("\n").filter((l) => l.length > 0); },
	};
}

/** Interruptions a test fires. */
export function interruptions() {
	const listeners = new Set();
	return { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, fire() { for (const l of [...listeners]) l(); } };
}

/** Lets every queued reaction run. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Runs one command of a program through a capture; gives its status with the capture. */
export async function runParts(program, args, { io = capture(), env = ENV, interrupts } = {}) {
	const status = await program.run({ args, env, stdout: io.stdout, stderr: io.stderr, ...(interrupts ? { interruptions: interrupts } : {}) });
	return { status, io };
}

/** The lines of standard output, the JSON form's: each part's record, then the ending's. */
export function jsonOutput(stdout) {
	const lines = stdout.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
	return { parts: lines.slice(0, -1), ending: lines.at(-1) };
}

/** A fixed size answer: a text answer whose part line, in the JSON form with its number, is exactly `bytes`. */
export function answerForLine(bytes, number = 1, fill = "\u00e9") {
	const frame = bytesOf(`${JSON.stringify({ part: number, answer: "" })}\n`);
	const room = bytes - frame;
	const unit = bytesOf(fill);
	const count = Math.floor(room / unit);
	const answer = fill.repeat(count) + "a".repeat(room - count * unit);
	if (bytesOf(`${JSON.stringify({ part: number, answer })}\n`) !== bytes) throw new Error("the answer's line is not the size asked");
	return answer;
}
