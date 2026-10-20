// parts-output - OC4 and OC5 for parts commands (zorg's D4-E8, Delta 4's amendment 8): a parts command prints
// each part as its client passes it on, numbered from 1, before its ending, which adds `partsTaken`, `lastPart`
// and what `resume` gives; its printing closes when `run` is observed settled, at an overflow of 16777216
// unwritten bytes, at a part that is no plain data and at a failed write; and its ending is given in pieces
// within the bound. Most cases run in this process through a captured standard output whose writes the test
// holds, releases, refuses or rejects; the process adapter's cases run as child processes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";
import { describe, test } from "node:test";
import { answerForLine, bytesOf, capture, ending, ENV, interruptions, jsonOutput, LIMIT, partsProgram, runParts, tick } from "../support/parts-program.js";
import { readRecords, scratch } from "../support/run-command.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PARTS_COMMAND = path.join(here, "..", "support", "parts-command.js");
const REFUSAL = { part: "store", code: "input-misfit", what: "The input does not fit.", why: "A name is required.", fix: "Give a name.", details: { field: "name" }, misfits: [{ pointer: "/name", keyword: "required", expected: "a name", fit: "add it" }] };
const ANSWERED = ending({ ending: "answered", answer: { position: 9 } });
const FOLLOW = ["follow", "--since", "0"];
const aborted = (signal) => new Promise((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
const resumeSince = (lastPart, flags) => ({ since: String(lastPart?.through ?? flags.since) });
const plainLines = (stdout) => stdout.split("\n").filter((l) => l.length > 0);
const nameOf = (line) => line.slice(0, line.indexOf(":"));

/** Waits until a condition holds, letting reactions and timers run. */
async function until(condition, what) {
	for (let i = 0; i < 2000; i++) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	assert.fail(`never: ${what}`);
}

describe("printing parts before the ending", () => {
	const run = async ({ onPart }) => {
		onPart({ n: 1 });
		onPart({ n: 2 });
		onPart("three");
		return ANSWERED;
	};

	test("D4-E8: with --json each part is one line, numbered from 1, before the ending, which adds partsTaken and lastPart last", async () => {
		const { status, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
		assert.equal(status, 0);
		const { parts, ending: record } = jsonOutput(io.stdoutText);
		assert.deepEqual(parts, [{ part: 1, answer: { n: 1 } }, { part: 2, answer: { n: 2 } }, { part: 3, answer: "three" }]);
		assert.deepEqual(Object.keys(parts[0]), ["part", "answer"]);
		assert.deepEqual(Object.keys(record), ["ending", "operation", "invocation", "answer", "partsTaken", "lastPart"]);
		assert.deepEqual([record.answer, record.partsTaken, record.lastPart], [{ position: 9 }, 3, "three"]);
		assert.equal(io.stdoutText.split("\n").length, 5, "three part lines, the ending's line, and its line break");
		assert.deepEqual(io.err, []);
	});

	test("D4-E8: without --json each part is `part: ` and its JSON when no wordPart is given, and the ending's plain lines end with partsTaken and lastPart", async () => {
		const { status, io } = await runParts(partsProgram({ run }), FOLLOW);
		assert.equal(status, 0);
		const lines = plainLines(io.stdoutText);
		assert.deepEqual(lines.slice(0, 3), ['part: {"n":1}', 'part: {"n":2}', 'part: "three"']);
		assert.deepEqual(lines.slice(3).map(nameOf), ["ending", "operation", "invocation", "answer", "partsTaken", "lastPart"]);
		assert.deepEqual(lines.slice(-2), ["partsTaken: 3", "lastPart: three"]);
		assert.deepEqual(io.err, []);
	});

	test("D4-E8: wordPart words each part of the plain form, given the answer and the flags, and leaves the JSON form alone", async () => {
		const seen = [];
		const wordPart = (answer, flags) => {
			seen.push({ frozen: Object.isFrozen(answer), quiet: flags.quiet });
			return typeof answer === "string" ? `last: ${answer}\n` : `item ${answer.n}\nmore ${answer.n}`;
		};
		const plain = await runParts(partsProgram({ run, wordPart }), [...FOLLOW, "--quiet"]);
		assert.deepEqual([plain.status, plain.io.err], [0, []]);
		assert.deepEqual(plainLines(plain.io.stdoutText).slice(0, 5), ["item 1", "more 1", "item 2", "more 2", "last: three"]);
		assert.deepEqual(seen, [{ frozen: true, quiet: true }, { frozen: true, quiet: true }, { frozen: true, quiet: true }]);
		const json = await runParts(partsProgram({ run, wordPart }), [...FOLLOW, "--json"]);
		assert.deepEqual([json.status, json.io.err], [0, []]);
		assert.deepEqual(jsonOutput(json.io.stdoutText).parts.map((p) => p.answer), [{ n: 1 }, { n: 2 }, "three"]);
	});

	test("D4-E8: a wordPart that throws or returns what is not text falls back to the part's JSON, with one diagnostic line however many parts it fails for", async () => {
		const wordPart = (answer) => {
			if (answer.n === 2) throw new Error("wordPart broke");
			if (answer.n === 3) return 42;
			if (answer.n === 4) return Promise.reject(new Error("wordPart's promise rejected"));
			return `item ${answer.n}`;
		};
		const program = partsProgram({ wordPart, run: async ({ onPart }) => { for (let n = 1; n <= 5; n++) onPart({ n }); return ANSWERED; } });
		const { status, io } = await runParts(program, FOLLOW);
		assert.equal(status, 0);
		assert.deepEqual(plainLines(io.stdoutText).slice(0, 5), ["item 1", 'part: {"n":2}', 'part: {"n":3}', 'part: {"n":4}', "item 5"]);
		assert.equal(io.diagnostics.length, 1, io.err.join(""));
		assert.match(io.diagnostics[0], /^diagnostic: a part could not be worded, so it and any later part that cannot be are printed as JSON: wordPart threw .*wordPart broke/);
	});

	test("D4-E8: a command that is not a parts command is given no onPart, and prints no partsTaken or lastPart", async () => {
		let given;
		const program = partsProgram({ run: async () => ANSWERED, readRun: async (context) => { given = Object.keys(context); return ending({ ending: "answered", answer: { ok: true } }, "read"); } });
		const { status, io } = await runParts(program, ["read", "--json"]);
		assert.equal(status, 0);
		assert.ok(!given.includes("onPart"), given.join(", "));
		assert.deepEqual(Object.keys(JSON.parse(io.stdoutText)), ["ending", "operation", "invocation", "answer"]);
		assert.deepEqual(io.err, []);
	});
});

describe("the ending of a parts command: partsTaken, lastPart and resume in every ending, in order", () => {
	const KINDS = {
		answered: { status: 0, fields: ["answer"], make: () => ANSWERED },
		refused: { status: 2, fields: ["refusal"], make: () => ending({ ending: "refused", refusal: REFUSAL }) },
		"not-delivered": { status: 3, fields: ["agpCode", "proxyCode", "earlierAttemptsUncertain"], make: () => ending({ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: false }) },
		unknown: { status: 4, fields: ["reason", "agpCode", "deliveryReport", "repeat"], make: () => ending({ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" }) },
		"run-failed": { status: 4, fields: ["reason", "agpCode", "deliveryReport", "repeat"], make: () => { throw new Error("run broke"); } },
		"prepare-not-delivered": { status: 3, fields: ["agpCode", "proxyCode", "earlierAttemptsUncertain"], prepare: () => ({ ending: "not-delivered", agpCode: "TIMEOUT", proxyCode: null }) },
	};
	for (const [kind, spec] of Object.entries(KINDS)) {
		for (const withResume of [true, false]) {
			test(`D4-E8, amendment 8: ${kind}${withResume ? ", with resume declared" : ", without resume"}: its fields in order in both forms, then partsTaken, lastPart${withResume ? " and resume" : ""}`, async () => {
				const run = async ({ onPart }) => {
					onPart({ through: 5, change: { id: "e1" } });
					return spec.make();
				};
				const options = { run, ...(withResume ? { resume: resumeSince } : {}), ...(spec.prepare ? { prepare: spec.prepare } : {}) };
				const head = ["ending", "operation", "invocation", ...spec.fields, "partsTaken", "lastPart", ...(withResume ? ["resume"] : [])];
				const ran = !spec.prepare;
				const json = await runParts(partsProgram(options), [...FOLLOW, "--json"]);
				assert.equal(json.status, spec.status, json.io.err.join(""));
				const { parts, ending: record } = jsonOutput(json.io.stdoutText);
				assert.deepEqual(Object.keys(record), head);
				assert.equal(record.partsTaken, ran ? 1 : 0);
				assert.deepEqual(record.lastPart, ran ? { through: 5, change: { id: "e1" } } : null);
				assert.equal(parts.length, ran ? 1 : 0);
				if (withResume) assert.deepEqual(record.resume, { since: ran ? "5" : "0" });
				const said = kind === "run-failed" ? [/^diagnostic: run failed: run broke$/] : [];
				assert.equal(json.io.diagnostics.length, said.length, json.io.err.join(""));
				said.forEach((pattern, i) => assert.match(json.io.diagnostics[i], pattern));
				const plain = await runParts(partsProgram(options), FOLLOW);
				assert.equal(plain.status, spec.status);
				assert.equal(plain.io.diagnostics.length, said.length, plain.io.err.join(""));
				const lines = plainLines(plain.io.stdoutText).slice(ran ? 1 : 0);
				assert.deepEqual(lines.map(nameOf), head);
				assert.equal(lines.find((l) => l.startsWith("partsTaken: ")), `partsTaken: ${ran ? 1 : 0}`);
				assert.equal(lines.find((l) => l.startsWith("lastPart: ")), ran ? 'lastPart: {"through":5,"change":{"id":"e1"}}' : "lastPart: null");
				if (withResume) assert.equal(lines.at(-1), `resume: {"since":"${ran ? 5 : 0}"}`);
			});
		}
	}

	test("D4-E8, amendment 8: a resume that fails on an ending that is not unknown gives resume null, with one diagnostic line", async () => {
		const resume = () => { throw new Error("resume broke"); };
		const { status, io } = await runParts(partsProgram({ resume, run: async ({ onPart }) => { onPart({ through: 3 }); return ANSWERED; } }), [...FOLLOW, "--json"]);
		assert.equal(status, 0);
		assert.equal(jsonOutput(io.stdoutText).ending.resume, null);
		assert.equal(io.diagnostics.length, 1);
		assert.match(io.diagnostics[0], /^diagnostic: resume threw .*resume broke.*, so the repeat uses the flags as given$/);
	});
});

describe("when printing closes: run observed settled", () => {
	test("D4-E8: a part passed on in the same turn just before run's native promise is fulfilled is printed; one passed on in a microtask after the fulfilment is not", async () => {
		const run = ({ onPart }) => new Promise((resolve) => {
			setTimeout(() => {
				onPart({ n: 1 });
				resolve(ANSWERED);
				onPart({ n: 2 });
				queueMicrotask(() => onPart({ n: 3 }));
			}, 1);
		});
		const { status, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
		assert.deepEqual([status, io.err], [0, []]);
		const { parts, ending: record } = jsonOutput(io.stdoutText);
		assert.deepEqual(parts.map((p) => p.answer.n), [1, 2], "the part in the same turn as the fulfilment, before the command's reaction, is printed");
		assert.equal(record.partsTaken, 2);
	});

	test("D4-E8: after a synchronous return, and after a synchronous throw, a part passed on in a microtask is not printed", async () => {
		const returns = ({ onPart }) => { onPart({ n: 1 }); queueMicrotask(() => onPart({ n: 2 })); return ANSWERED; };
		const throws = ({ onPart }) => { onPart({ n: 1 }); queueMicrotask(() => onPart({ n: 2 })); throw new Error("run broke"); };
		for (const [run, status] of [[returns, 0], [throws, 4]]) {
			const { status: got, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
			assert.equal(got, status);
			assert.deepEqual(io.diagnostics.map((l) => /^diagnostic: run failed: run broke$/.test(l)), status === 4 ? [true] : []);
			const { parts, ending: record } = jsonOutput(io.stdoutText);
			assert.deepEqual(parts.map((p) => p.answer.n), [1]);
			assert.equal(record.partsTaken, 1);
		}
	});

	test("D4-E8: a part passed on well after run settled is not printed, and the ending stays the last thing printed", async () => {
		let later;
		const run = async ({ onPart }) => { later = onPart; onPart({ n: 1 }); return ANSWERED; };
		const { status, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
		assert.deepEqual([status, io.err], [0, []]);
		const before = io.stdoutText;
		later({ n: 2 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(io.stdoutText, before);
		assert.ok(io.stdoutText.endsWith(`${JSON.stringify(jsonOutput(before).ending)}\n`));
	});
});

describe("interruptions after run", () => {
	test("D4-E8: an interruption fires run's signal; parts passed on while run is pending are printed before the ending, printed with its status; a second changes nothing", async () => {
		const interrupts = interruptions();
		let aborts = 0;
		const run = async ({ onPart, signal }) => {
			signal.addEventListener("abort", () => aborts++);
			onPart({ n: 1 });
			await aborted(signal);
			onPart({ n: 2 });
			await tick();
			onPart({ n: 3 });
			return ending({ ending: "answered", answer: { position: 3 } });
		};
		const io = capture();
		const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io, interrupts });
		await until(() => io.out.length === 1, "the first part printed");
		interrupts.fire();
		interrupts.fire();
		const { status } = await running;
		assert.equal(status, 0);
		assert.equal(aborts, 1);
		const { parts, ending: record } = jsonOutput(io.stdoutText);
		assert.deepEqual(parts.map((p) => p.answer.n), [1, 2, 3]);
		assert.deepEqual([record.partsTaken, record.lastPart], [3, { n: 3 }]);
		assert.deepEqual(io.err, [], "no interruption line: run had been called");
	});
});

describe("the bound on unwritten standard output", () => {
	test("D4-E8: held writes reaching 16777216 unwritten bytes close printing for good: the signal fired once, lastPart the last part printed, no later part however small, one diagnostic line; released, the ending follows whole", async () => {
		let aborts = 0;
		let abortedAtPart;
		const big = (n) => answerForLine(1048576, n, "x");
		const run = async ({ onPart, signal }) => {
			signal.addEventListener("abort", () => aborts++);
			for (let n = 1; n <= 20; n++) {
				onPart(big(n));
				if (signal.aborted && abortedAtPart === undefined) abortedAtPart = n;
			}
			onPart({ through: 1, change: null });
			await aborted(signal);
			return ending({ ending: "answered", answer: { position: 1 } });
		};
		const io = capture({ hold: true });
		const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
		await until(() => io.held.length === 16 && io.diagnostics.length === 1, "16 parts held and the overflow said");
		assert.equal(io.unwritten(), LIMIT, "16 lines of 1048576 bytes: exactly the bound, every one printed");
		assert.equal(abortedAtPart, 17, "the 17th would pass the bound");
		await io.drain();
		const { status } = await running;
		assert.equal(status, 0);
		assert.equal(aborts, 1);
		assert.ok(io.highWater() <= LIMIT, `at most ${LIMIT} unwritten, not ${io.highWater()}`);
		const { parts, ending: record } = jsonOutput(io.stdoutText);
		assert.equal(parts.length, 16);
		assert.deepEqual(parts.map((p) => p.part), Array.from({ length: 16 }, (_, i) => i + 1));
		assert.equal(record.partsTaken, 16);
		assert.equal(record.lastPart, big(16));
		assert.equal(io.diagnostics.length, 1);
		assert.match(io.diagnostics[0], /^diagnostic: standard output would hold more than 16777216 bytes not yet written, so no more parts are printed and the call is cancelled$/);
	});

	test("D4-E8: a part whose line, in multi-byte UTF-8 with its framing and line break, brings the unwritten bytes to exactly 16777216 is printed, and a part a byte longer is not", async () => {
		for (const [size, printed] of [[LIMIT, true], [LIMIT + 1, false]]) {
			const answer = answerForLine(size, 1);
			assert.ok(/\u00e9/.test(answer));
			let after;
			const run = async ({ onPart, signal }) => {
				onPart(answer);
				onPart("a");
				after = signal.aborted;
				return ANSWERED;
			};
			const io = capture({ hold: true });
			const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
			await until(() => io.diagnostics.length === 1, "the overflow said");
			assert.equal(io.unwritten(), printed ? LIMIT : 0);
			await io.drain();
			const done = await running;
			assert.equal(done.status, 0);
			assert.equal(io.diagnostics.length, 1, "the overflow, said once");
			const { ending: record } = jsonOutput(done.io.stdoutText);
			assert.equal(record.partsTaken, printed ? 1 : 0, `a line of ${size} bytes`);
			assert.equal(after, true);
		}
	});

	test("D4-E8: held writes released one at a time free their bytes, so more than 16777216 bytes in all are printed with no overflow", async () => {
		const io = capture({ hold: true });
		const run = async ({ onPart }) => {
			for (let n = 1; n <= 40; n++) {
				onPart(answerForLine(1048576, n, "x"));
				while (io.held.length > 2) {
					io.held[0].release();
					await tick();
				}
			}
			return ANSWERED;
		};
		const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
		await until(() => io.out.length > 40, "the ending given");
		await io.drain();
		assert.equal((await running).status, 0);
		assert.equal(jsonOutput(io.stdoutText).ending.partsTaken, 40);
		assert.ok(bytesOf(io.stdoutText) > 40 * 1048576);
		assert.deepEqual(io.err, []);
	});

	test("D4-E8: a write returning no promise is settled as it returns", async () => {
		const run = async ({ onPart }) => { for (let n = 1; n <= 40; n++) onPart(answerForLine(1048576, n, "x")); return ANSWERED; };
		const { status, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
		assert.equal(status, 0);
		assert.equal(jsonOutput(io.stdoutText).ending.partsTaken, 40);
		assert.deepEqual(io.err, []);
	});

	test("D4-E8: a part passed on after a held write is fulfilled, before the command's reaction runs, counts that write unwritten; one passed on after the reaction does not", async () => {
		for (const afterReaction of [false, true]) {
			const io = capture({ hold: true });
			const run = async ({ onPart }) => {
				onPart(answerForLine(LIMIT - 100, 1));
				io.held[0].release();
				if (afterReaction) await tick();
				onPart(answerForLine(200, 2));
				return ANSWERED;
			};
			const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
			await until(() => io.out.length >= (afterReaction ? 3 : 2), "the ending given");
			await io.drain();
			const done = await running;
			assert.equal(done.status, 0);
			const { ending: record } = jsonOutput(done.io.stdoutText);
			assert.equal(record.partsTaken, afterReaction ? 2 : 1, afterReaction ? "after the reaction" : "before it");
			assert.equal(io.diagnostics.length, afterReaction ? 0 : 1);
		}
	});

	test("D4-E8: an already fulfilled promise a write returns frees its bytes only when the command's reaction runs", async () => {
		for (const afterReaction of [false, true]) {
			const io = capture({ resolved: (text) => text.length > 1000 });
			const run = async ({ onPart }) => {
				onPart(answerForLine(LIMIT - 100, 1));
				if (afterReaction) await tick();
				onPart(answerForLine(200, 2));
				return ANSWERED;
			};
			const { status, io: done } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
			assert.equal(status, 0);
			assert.equal(done.diagnostics.length, afterReaction ? 0 : 1);
			assert.equal(jsonOutput(done.stdoutText).ending.partsTaken, afterReaction ? 2 : 1);
		}
	});

	test("D4-E8: an ending larger than 16777216 bytes is printed whole and in order, in pieces, the unwritten bytes never past the bound", async () => {
		const answer = "\u00e9".repeat(9000000);
		const io = capture({ hold: true });
		const running = runParts(partsProgram({ run: async ({ onPart }) => { onPart({ n: 1 }); return ending({ ending: "answered", answer }); } }), [...FOLLOW, "--json"], { io });
		await until(() => io.held.length >= 2, "the ending begun");
		await io.drain();
		const { status } = await running;
		assert.equal(status, 0);
		assert.ok(io.out.length >= 3, `the ending given in pieces: ${io.out.length} writes`);
		assert.ok(io.highWater() <= LIMIT, `${io.highWater()} unwritten`);
		const record = jsonOutput(io.stdoutText).ending;
		assert.equal(record.answer, answer);
		assert.equal(record.partsTaken, 1);
		assert.deepEqual(io.err, []);
	});
});

describe("failed writes and parts that are no plain data", () => {
	test("D4-E8: a write that throws closes printing with one diagnostic line, its part not counted, the signal fired once; resume is given the last part counted", async () => {
		let aborts = 0;
		const resumes = [];
		const resume = (lastPart, flags) => { resumes.push(lastPart); return resumeSince(lastPart, flags); };
		const run = async ({ onPart, signal }) => {
			signal.addEventListener("abort", () => aborts++);
			onPart({ through: 1 });
			onPart({ through: 2 });
			onPart({ through: 3 });
			return ANSWERED;
		};
		const io = capture({ refuse: (text) => text.startsWith('{"part"') && text.includes('"through":2') });
		const { status } = await runParts(partsProgram({ run, resume }), [...FOLLOW, "--json"], { io });
		assert.equal(status, 0);
		const { parts, ending: record } = jsonOutput(io.stdoutText);
		assert.deepEqual(parts.map((p) => p.answer.through), [1]);
		assert.deepEqual([record.partsTaken, record.lastPart, record.resume], [1, { through: 1 }, { since: "1" }]);
		assert.deepEqual(resumes, [{ through: 1 }]);
		assert.equal(aborts, 1);
		assert.equal(io.diagnostics.length, 1);
		assert.match(io.diagnostics[0], /^diagnostic: standard output could not take a part: .*refused.*, so no more parts are printed and the call is cancelled$/);
	});

	test("D4-E8: a write whose promise rejects counts its part, then closes printing when the rejection is observed, with one diagnostic line", async () => {
		let aborts = 0;
		const run = async ({ onPart, signal }) => {
			signal.addEventListener("abort", () => aborts++);
			onPart({ through: 1 });
			onPart({ through: 2 });
			await tick();
			onPart({ through: 3 });
			return ANSWERED;
		};
		const io = capture({ reject: (text) => text.startsWith('{"part"') && text.includes('"through":2') });
		const { status } = await runParts(partsProgram({ run, resume: resumeSince }), [...FOLLOW, "--json"], { io });
		assert.equal(status, 0);
		const { ending: record } = jsonOutput(io.stdoutText);
		assert.deepEqual([record.partsTaken, record.lastPart, record.resume], [2, { through: 2 }, { since: "2" }]);
		assert.ok(!io.stdoutText.includes('"through":3'));
		assert.equal(aborts, 1);
		assert.equal(io.diagnostics.length, 1);
	});

	test("D4-E8: an earlier write rejecting after a later part was handed over closes printing, both parts counted", async () => {
		const io = capture({ hold: true });
		const run = async ({ onPart }) => {
			onPart({ through: 1 });
			onPart({ through: 2 });
			io.held[0].fail();
			await tick();
			onPart({ through: 3 });
			return ANSWERED;
		};
		const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
		await until(() => io.out.length === 3, "the ending given");
		await io.drain();
		const done = await running;
		assert.equal(done.status, 0);
		const { ending: record } = jsonOutput(done.io.stdoutText);
		assert.deepEqual([record.partsTaken, record.lastPart], [2, { through: 2 }]);
		assert.equal(io.diagnostics.length, 1);
	});

	test("D4-E8: a part passed on after a held write is rejected, before the command's reaction runs, counts that write unwritten; the rejection then closes printing, said once", async () => {
		const io = capture({ hold: true });
		const run = async ({ onPart }) => {
			onPart(answerForLine(LIMIT - 20, 1));
			io.held[0].fail();
			// 30 bytes with 20 of room: refused only while the rejected write still counts.
			onPart(answerForLine(30, 2));
			await tick();
			onPart(answerForLine(30, 3));
			return ANSWERED;
		};
		const running = runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
		await until(() => io.out.length === 2, "the ending given");
		await io.drain();
		const done = await running;
		assert.equal(done.status, 0);
		const { parts, ending: record } = jsonOutput(done.io.stdoutText);
		assert.deepEqual([parts.length, record.partsTaken], [1, 1]);
		assert.equal(io.diagnostics.length, 2, io.err.join(""));
		assert.match(io.diagnostics[0], /^diagnostic: standard output would hold more than 16777216 bytes not yet written/);
		assert.match(io.diagnostics[1], /^diagnostic: standard output could not take a part: .*the held write failed$/);
	});

	test("D4-E8: a part's write rejected after run settled is still said, once, and changes nothing printed", async () => {
		const io = capture({ hold: true });
		const running = runParts(partsProgram({ run: async ({ onPart }) => { onPart({ through: 1 }); return ANSWERED; } }), [...FOLLOW, "--json"], { io });
		await until(() => io.held.length === 2, "the part and the ending held");
		io.held[1].release();
		const done = await running;
		assert.equal(done.status, 0);
		assert.deepEqual(io.err, []);
		io.held[0].fail();
		await tick();
		assert.equal(io.diagnostics.length, 1, io.err.join(""));
		assert.match(io.diagnostics[0], /^diagnostic: standard output could not take a part: .*the held write failed$/);
		assert.equal(jsonOutput(io.stdoutText).ending.partsTaken, 1);
	});

	for (const how of ["throws", "rejects"]) {
		test(`D4-E8: a write of the ending that ${how} leaves the exit status its ending's, with one diagnostic line and no unhandled rejection`, async () => {
			const isEnding = (text) => text.startsWith('{"ending"');
			const io = capture(how === "throws" ? { refuse: isEnding } : { reject: isEnding });
			const run = async ({ onPart }) => { onPart({ n: 1 }); return ending({ ending: "refused", refusal: REFUSAL }); };
			const { status } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"], { io });
			await tick();
			assert.equal(status, 2);
			assert.equal(io.diagnostics.length, 1, io.err.join(""));
			assert.match(io.diagnostics[0], /^diagnostic: standard output could not take the ending: /);
		});
	}

	test("D4-E8: a part whose answer has a getter, a custom prototype or a promise closes printing the same way, with zero getter calls and no unhandled rejection", async () => {
		let reads = 0;
		const malformed = {
			getter: () => ({ get through() { reads++; return 1; } }),
			prototype: () => Object.assign(Object.create({ inherited: true }), { through: 1 }),
			promise: () => ({ through: 1, held: Promise.reject(new Error("the part's promise rejected")) }),
		};
		for (const [name, make] of Object.entries(malformed)) {
			let aborts = 0;
			const run = async ({ onPart, signal }) => {
				signal.addEventListener("abort", () => aborts++);
				onPart({ through: 0 });
				onPart(make());
				onPart({ through: 2 });
				return ANSWERED;
			};
			const { status, io } = await runParts(partsProgram({ run }), [...FOLLOW, "--json"]);
			await tick();
			assert.equal(status, 0, name);
			const { parts, ending: record } = jsonOutput(io.stdoutText);
			assert.deepEqual(parts.map((p) => p.answer.through), [0], name);
			assert.deepEqual([record.partsTaken, record.lastPart], [1, { through: 0 }], name);
			assert.equal(aborts, 1, name);
			assert.equal(io.diagnostics.length, 1, name);
			assert.match(io.diagnostics[0], /^diagnostic: a part's answer is .*, not plain data, so no more parts are printed and the call is cancelled$/, name);
		}
		assert.equal(reads, 0, "no getter called");
	});
});

describe("memory", () => {
	test("D4-E8: the memory a parts command keeps, measured after garbage collection, does not grow with the parts written", async () => {
		v8.setFlagsFromString("--expose-gc");
		const gc = vm.runInNewContext("gc");
		const settle = async () => { for (let i = 0; i < 5; i++) await tick(); gc(); gc(); };
		let first;
		let last;
		const run = async ({ onPart }) => {
			let n = 0;
			const pass = async (count) => { for (let i = 0; i < count; i++) { onPart({ n: ++n, pad: "p".repeat(64) }); if (n % 5000 === 0) await tick(); } };
			await pass(20000);
			await settle();
			first = process.memoryUsage().heapUsed;
			await pass(180000);
			await settle();
			last = process.memoryUsage().heapUsed;
			return ANSWERED;
		};
		let written = 0;
		// Each write fulfils at once, so every reaction the command attaches is attached and run.
		const stdout = (text) => { written += text.length; return Promise.resolve(); };
		let errors = "";
		const status = await partsProgram({ run }).run({ args: [...FOLLOW, "--json"], env: ENV, stdout, stderr: (text) => { errors += text; } });
		assert.deepEqual([status, errors], [0, ""]);
		assert.ok(written > 200000 * 64);
		assert.ok(last - first < 4 * 1024 * 1024, `the heap grew by ${last - first} bytes over 180000 parts`);
	});
});

/** Runs the parts command as a child process through the process adapter, its standard error to a file. */
function startPartsProcess(kind, { pipeStdout = false } = {}) {
	const record = scratch("parts-record.jsonl");
	const outFile = scratch("parts-stdout.txt");
	const errFile = scratch("parts-stderr.txt");
	const outFd = pipeStdout ? "pipe" : fs.openSync(outFile, "w");
	const errFd = fs.openSync(errFile, "w");
	const child = spawn(process.execPath, [PARTS_COMMAND, ...FOLLOW, "--json"], { env: { PATH: process.env.PATH, ...ENV, PT_SCENARIO: JSON.stringify({ kind, record }) }, stdio: ["ignore", outFd, errFd] });
	if (!pipeStdout) fs.closeSync(outFd);
	fs.closeSync(errFd);
	const ended = new Promise((resolve, reject) => {
		const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`the parts command (${kind}) did not exit within 120 s`)); }, 120000);
		child.on("exit", (status, signal) => {
			clearTimeout(timer);
			resolve({ status, signal, stdout: pipeStdout ? "" : fs.readFileSync(outFile, "utf8"), stderr: fs.readFileSync(errFile, "utf8"), records: readRecords(record) });
		});
	});
	return { child, ended };
}

describe("through the process adapter", () => {
	test("D4-E8: a write whose callback is held though write returned true counts as unwritten: 16 parts of 1048576-byte lines printed, then the ending once the callbacks are released", async () => {
		const result = await startPartsProcess("held-callbacks").ended;
		assert.equal(result.status, 0, result.stderr);
		const { parts, ending: record } = jsonOutput(result.stdout);
		assert.equal(parts.length, 16);
		assert.equal(record.partsTaken, 16);
		assert.deepEqual(result.records.find((r) => r.event === "parts-passed"), { event: "parts-passed", aborted: true, aborts: 1 });
		assert.match(result.stderr, /^diagnostic: standard output would hold more than 16777216 bytes not yet written[^\n]*\n$/);
	});

	test("D4-E8: a standard output that breaks fails its writes and leaves the command's exit status its ending's", async () => {
		const { child, ended } = startPartsProcess("broken-output", { pipeStdout: true });
		child.stdout.destroy();
		const result = await ended;
		assert.equal(result.signal, null);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.records.some((r) => r.event === "parts-passed"));
		assert.match(result.stderr, /diagnostic: standard output could not take/);
		assert.doesNotMatch(result.stderr, /\n\s+at /, "no stack: nothing escaped");
	});

	test("D4-E8: the memory a command keeps through the process adapter, measured after garbage collection, does not grow with the parts written", async () => {
		const result = await startPartsProcess("memory").ended;
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		const heap = result.records.find((r) => r.event === "heap");
		assert.equal(heap.parts, 200000);
		assert.ok(heap.last - heap.first < 4 * 1024 * 1024, `the heap grew by ${heap.last - heap.first} bytes over 180000 parts`);
	});

	for (const [kind, said] of [["late-part-failure", "a part"], ["late-ending-failure", "the ending"]]) {
		test(`D4-E8: a write of ${said} that fails after run has settled and the ending was handed over is said before the process exits, which keeps the ending's status`, async () => {
			const result = await startPartsProcess(kind).ended;
			assert.deepEqual([result.status, result.signal], [0, null], result.stderr);
			assert.equal(jsonOutput(result.stdout).ending.partsTaken, 1);
			const lines = result.stderr.split("\n").filter((l) => l.length > 0);
			assert.equal(lines.length, 1, result.stderr);
			assert.match(lines[0], new RegExp(`^diagnostic: standard output could not take ${said}: .*the write failed late$`));
		});
	}
});
