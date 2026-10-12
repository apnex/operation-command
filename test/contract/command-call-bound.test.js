// command-call-bound - OC3 (E19): a command fixes its invocation identity first, calls the client's `prepare`
// with the deadline its preparation setting gives on the injected clock port, keeps no timer of its own
// while preparing and trusts the decided result, and calls `run` with its bound setting as the call's bound,
// the identity, the repeat flag and an abort signal - or, when preparing does not reach ready, never calls
// `run` and reports the command not delivered. Commands run as child processes of the fixture application.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declareProgram } from "@apnex/operation-command";
import { sleep, within } from "../support/clock-timer.js";
import { fixtureDeclaration, MALFORMED } from "../support/fixture-program.js";
import { BASE_ENV, plainFacts, runFixture, startFixture } from "../support/run-command.js";

const INVOCATION = /^[0-9]{13}-[0-9a-f]{16}$/;
const GIVEN = "1791540000000-3f9a0c1d2b4e5f60";
const answered = { ending: { ending: "answered", answer: { ok: true } } };
const events = (result) => result.records.map((r) => r.event);
const only = (result, event) => {
	const found = result.records.filter((r) => r.event === event);
	assert.equal(found.length, 1, `one ${event} record`);
	return found[0];
};

/** Runs a scenario with --json and without, giving both results. */
async function bothForms(args, scenario, env = BASE_ENV) {
	return { json: await runFixture([...args, "--json"], { env, scenario }), plain: await runFixture(args, { env, scenario }) };
}

/** Asserts the not-delivered ending a command reports for its preparing, whole, in both forms, run never called. */
function assertPrepareEnding({ json, plain }, { operation, agpCode, proxyCode, earlierAttemptsUncertain = false, invocation }) {
	for (const result of [json, plain]) {
		assert.equal(result.status, 3, result.stderr);
		assert.ok(!events(result).includes("run"), "run is never called");
	}
	const record = JSON.parse(json.stdout);
	assert.match(record.invocation, INVOCATION);
	if (invocation) assert.equal(record.invocation, invocation);
	assert.deepEqual(record, { ending: "not-delivered", operation, invocation: record.invocation, agpCode, proxyCode, earlierAttemptsUncertain });
	assert.equal(json.stdout, `${JSON.stringify(record)}\n`, "one JSON object on one line");
	const facts = plainFacts(plain.stdout);
	assert.match(facts.invocation, INVOCATION);
	assert.equal(plain.stdout, `ending: not-delivered\noperation: ${operation}\ninvocation: ${facts.invocation}\nagpCode: ${agpCode ?? "null"}\nproxyCode: ${proxyCode ?? "null"}\nearlierAttemptsUncertain: ${earlierAttemptsUncertain}\n`);
}

/** Asserts that prepare settled at or before its deadline, on the clock port, in both forms, as the case's premise says. */
function assertSettledBeforeDeadline({ json, plain }) {
	for (const result of [json, plain]) {
		const prepare = only(result, "prepare");
		assert.ok(only(result, "prepare-settled").at <= prepare.deadline, `settled at ${only(result, "prepare-settled").at}, at or before the deadline ${prepare.deadline}`);
	}
}

describe("OC3 - preparing with the deadline on the injected clock port", { concurrency: 4 }, () => {
	test("prepare is given the clock port's reading when the command began reading its arguments plus its preparation setting, the clock port itself, and an abort signal", async () => {
		for (const [args, env, ms] of [[[], BASE_ENV, 5000], [["--connect-timeout", "750ms"], BASE_ENV, 750], [[], { ...BASE_ENV, FIX_CONNECT_TIMEOUT: "2m" }, 120000]]) {
			const result = await runFixture(["read", "--name", "a", ...args], { env, scenario: { clockOffset: 7_000_000_000, prepare: { settle: "ready" }, run: answered } });
			assert.equal(result.status, 0, result.stderr);
			const began = only(result, "clock-began").at;
			const prepare = only(result, "prepare");
			assert.ok(began > 7_000_000_000, "the injected clock port was read");
			assert.equal(prepare.deadline, began + ms, "deadline = first reading + preparation setting");
			assert.equal(prepare.clockInjected, true, "prepare is given the injected clock port");
			assert.equal(prepare.signalIsAbortSignal, true);
			assert.ok(prepare.calledAt >= began);
		}
	});

	test("prepare settling ready before the deadline reaches run", async () => {
		const result = await runFixture(["read", "--name", "a", "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready", afterCallMs: 20 }, run: answered } });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(events(result).filter((e) => e.startsWith("prepare") || e === "run"), ["prepare", "prepare-settled", "run"]);
		assert.ok(only(result, "prepare-settled").at < only(result, "prepare").deadline);
	});

	test("a ready decided before the deadline but observed after it reaches run: the command trusts the decided result and keeps no timer of its own", async () => {
		const result = await runFixture(["read", "--name", "a", "--connect-timeout", "2s", "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready", decided: true, afterDeadlineMs: 300 }, run: answered } });
		assert.equal(result.status, 0, result.stderr);
		const prepare = only(result, "prepare");
		assert.equal(only(result, "prepare-decided").beforeDeadline, true);
		assert.ok(only(result, "prepare-settled").at > prepare.deadline, "observed after the deadline");
		assert.ok(!events(result).includes("prepare-aborted"), "prepare's signal is not fired at the deadline");
		assert.equal(only(result, "run").invocation, JSON.parse(result.stdout).invocation);
	});

	test("prepare settling not delivered with an agpCode, before the deadline, is printed whole with its operation and invocation, run never called", async () => {
		const both = await bothForms(["read", "--name", "a"], { prepare: { settle: { ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null } }, run: answered });
		assertSettledBeforeDeadline(both);
		assertPrepareEnding(both, { operation: "read", agpCode: "NO_ROUTE", proxyCode: null });
	});

	test("prepare settling not delivered with a proxyCode, before the deadline, is printed whole", async () => {
		const both = await bothForms(["publish", "--name", "a", "--summary", "s"], { prepare: { settle: { ending: "not-delivered", proxyCode: "key-mismatch" }, afterCallMs: 10 }, run: answered });
		assertSettledBeforeDeadline(both);
		assertPrepareEnding(both, { operation: "create", agpCode: null, proxyCode: "key-mismatch" });
	});

	test("prepare settling not delivered after the deadline, with an agpCode and with a proxyCode: the command waits for it, keeping no timer that ends it sooner", async () => {
		for (const settle of [{ ending: "not-delivered", agpCode: "TIMEOUT", proxyCode: null, invocation: "ignored", earlierAttemptsUncertain: true }, { ending: "not-delivered", agpCode: null, proxyCode: "proxy-unreachable" }]) {
			const started = performance.now();
			const both = await bothForms(["read", "--name", "a", "--connect-timeout", "50ms"], { prepare: { settle, afterDeadlineMs: 700 }, run: answered });
			assert.ok(performance.now() - started >= 2 * 750, "each command waited for its client's decision, well past the deadline");
			for (const result of [both.json, both.plain]) {
				const prepare = only(result, "prepare");
				assert.ok(only(result, "prepare-settled").at >= prepare.deadline + 700, "settled long after the deadline");
				assert.ok(!events(result).includes("prepare-aborted"), "the command fires prepare's signal only on an interruption, never at the deadline");
			}
			assertPrepareEnding(both, { operation: "read", agpCode: settle.agpCode, proxyCode: settle.proxyCode });
		}
	});

	test("prepare rejecting ends the command not delivered with null codes and one diagnostic line, run never called", async () => {
		const both = await bothForms(["read", "--name", "a"], { prepare: { settle: { reject: "the socket\nwould not open" } }, run: answered });
		assertPrepareEnding(both, { operation: "read", agpCode: null, proxyCode: null });
		for (const result of [both.json, both.plain]) assert.equal(result.stderr, "diagnostic: prepare failed: Error: the socket would not open\n");
	});

	test("prepare settling to anything else ends the command not delivered with null codes and one diagnostic line, run never called", async () => {
		for (const settle of [{ ready: true }, 42, "Ready", null, { ending: "answered", answer: 1 }, { ending: "not-delivered", agpCode: 7 }, { ending: "not-delivered", proxyCode: false }]) {
			const both = await bothForms(["read", "--name", "a"], { prepare: { settle }, run: answered });
			assertPrepareEnding(both, { operation: "read", agpCode: null, proxyCode: null });
			for (const result of [both.json, both.plain]) assert.match(result.stderr, /^diagnostic: prepare settled to [^\n]*, neither ready nor a not-delivered ending\n$/);
		}
	});

	test("a prepare result that cannot be read - a thenable, a throwing getter on it, a rejected inner promise - ends the command not delivered with null codes and one diagnostic line, run never called, through the process adapter", async () => {
		for (const [malformed, diagnostic] of [
			["throwing-ending", "prepare settled to what could not be read: Error: the ending getter threw"],
			["throwing-code", "prepare settled to what could not be read: Error: the code getter threw"],
			["throwing-then", "prepare failed: Error: the then getter threw"],
			["thenable-throws", "prepare failed: Error: then threw"],
			["thenable-throwing-ending", "prepare settled to what could not be read: Error: the settled ending getter threw"],
			["thenable-rejected-inner", "prepare failed: Error: the inner promise rejected"],
			// Written from what was read, never by reading the result again: what is no JSON is written as what it was.
			["rejected-code", "prepare settled to {\"ending\":\"not-delivered\",\"agpCode\":<a promise>,\"proxyCode\":null,\"earlierAttemptsUncertain\":false}, neither ready nor a not-delivered ending"],
			["bigint-answer", "prepare settled to {\"ending\":\"answered\",\"answer\":1n}, neither ready nor a not-delivered ending"],
			["cyclic-answer", "prepare settled to {\"ending\":\"answered\",\"answer\":{\"a\":1,\"self\":<itself>}}, neither ready nor a not-delivered ending"],
			["first-read-rejected-code", "prepare settled to {\"ending\":\"not-delivered\",\"agpCode\":<a promise>,\"proxyCode\":null,\"earlierAttemptsUncertain\":false}, neither ready nor a not-delivered ending"],
			["throwing-rejected-code", "prepare settled to what could not be read: <a promise>"],
		]) {
			const both = await bothForms(["read", "--name", "a"], { prepare: { malformed }, run: answered });
			assertPrepareEnding(both, { operation: "read", agpCode: null, proxyCode: null });
			for (const result of [both.json, both.plain]) assert.deepEqual([result.signal, result.stderr], [null, `diagnostic: ${diagnostic}\n`], malformed);
		}
	});

	test("reading a malformed prepare result lets no rejection escape and observes every promise it holds, a result settling after the interruption that ended the command included", async () => {
		const escaped = [];
		const onRejection = (reason) => escaped.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			for (const malformed of Object.keys(MALFORMED)) {
				let runs = 0;
				const decl = fixtureDeclaration({});
				decl.client = { prepare: () => MALFORMED[malformed]() };
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: 1 }; } });
				const out = [];
				const err = [];
				const status = await within(declareProgram(decl).run({ args: ["read", "--name", "a", "--json"], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), malformed);
				assert.deepEqual([status, runs, JSON.parse(out.join("")).ending, err.length], [3, 0, "not-delivered", 1], malformed);
				// Interrupted while preparing, then prepare settles to the malformed result: still nothing escapes.
				let settle;
				decl.client = { prepare: () => new Promise((resolve) => { settle = resolve; }) };
				const listeners = new Set();
				const interrupted = declareProgram(decl).run({ args: ["read", "--name", "a", "--json"], env: BASE_ENV, stdout: () => assert.fail("nothing on standard output"), stderr: () => undefined, interruptions: { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } } });
				await sleep(5);
				for (const l of [...listeners]) l();
				assert.equal(await within(interrupted, malformed), 1);
				settle(MALFORMED[malformed]());
				assert.equal(runs, 0);
			}
			await sleep(50);
			assert.deepEqual(escaped, [], "no unhandled rejection");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});

	test("a prepare result whose getter gives a rejected promise on its first read only, or throws one: each promise consumed as it is read, so with standard output's write held the command still exits 3 with one diagnostic line", async () => {
		const escaped = [];
		const onRejection = (reason) => escaped.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			for (const malformed of ["first-read-rejected-code", "throwing-rejected-code"]) {
				const made = MALFORMED[malformed]();
				let reads = 0;
				// Counting the reads of agpCode: one only, whatever the result is judged and written as.
				const counted = Object.defineProperty({ ending: "not-delivered", proxyCode: null, earlierAttemptsUncertain: false }, "agpCode", { enumerable: true, get() { reads++; return Object.getOwnPropertyDescriptor(made, "agpCode").get.call(made); } });
				const decl = fixtureDeclaration({});
				decl.client = { prepare: () => counted };
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => assert.fail("run is never called") });
				const err = [];
				const status = await declareProgram(decl).run({ args: ["read", "--name", "a", "--json"], env: BASE_ENV, stdout: () => undefined, stderr: (t) => err.push(t) });
				assert.deepEqual([status, reads, err.length], [3, 1, 1], malformed);
			}
			await sleep(50);
			assert.deepEqual(escaped, [], "no unhandled rejection in this process");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
		for (const [malformed, diagnostic] of [
			["first-read-rejected-code", "prepare settled to {\"ending\":\"not-delivered\",\"agpCode\":<a promise>,\"proxyCode\":null,\"earlierAttemptsUncertain\":false}, neither ready nor a not-delivered ending"],
			["throwing-rejected-code", "prepare settled to what could not be read: <a promise>"],
		]) {
			for (const json of [true, false]) {
				// Standard output's write is held until the command received SIGINT, sent well after the ending was
				// written: a rejection left unhandled would end the process with status 1 before the write completes.
				const command = startFixture(["read", "--name", "a", ...(json ? ["--json"] : [])], { env: BASE_ENV, scenario: { prepare: { malformed }, run: answered, holdWrite: { until: ["SIGINT"] } } });
				await command.waitFor("write-held");
				await sleep(200);
				command.signal("SIGINT");
				const r = await command.ended;
				assert.deepEqual([r.status, r.signal, r.stderr], [3, null, `diagnostic: ${diagnostic}\n`], `${malformed} ${json ? "--json" : "plain"}`);
				assert.ok(events(r).includes("signal-received") && events(r).includes("write-released"), "the process lived until the held write was released");
				assert.ok(!events(r).includes("run"), "run is never called");
				if (json) {
					const record = JSON.parse(r.stdout);
					assert.match(record.invocation, INVOCATION);
					assert.equal(r.stdout, `${JSON.stringify({ ending: "not-delivered", operation: "read", invocation: record.invocation, agpCode: null, proxyCode: null, earlierAttemptsUncertain: false })}\n`);
				} else {
					assert.equal(r.stdout, `ending: not-delivered\noperation: read\ninvocation: ${plainFacts(r.stdout).invocation}\nagpCode: null\nproxyCode: null\nearlierAttemptsUncertain: false\n`);
				}
			}
		}
	});

	test("a client that offers no prepare goes straight to run", async () => {
		const result = await runFixture(["read", "--name", "a", "--json"], { env: BASE_ENV, scenario: { run: answered } });
		assert.equal(result.status, 0);
		assert.ok(!events(result).includes("prepare"));
		assert.ok(events(result).includes("run"));
	});
});

describe("OC3 - what run is given", { concurrency: 4 }, () => {
	test("run is given the bound setting as the call's bound, from its flag, its variable or its default, unspent by preparing", async () => {
		for (const [args, env, bound] of [[["--timeout", "250ms"], BASE_ENV, 250], [[], { ...BASE_ENV, FIX_TIMEOUT: "3s" }, 3000], [[], BASE_ENV, 10000]]) {
			const result = await runFixture(["read", "--name", "a", "--json", ...args], { env, scenario: { prepare: { settle: "ready", afterCallMs: 300 }, run: answered } });
			assert.equal(result.status, 0, result.stderr);
			assert.equal(only(result, "run").bound, bound);
		}
	});

	test("run is given a new identity as EM11 writes it, which the command prints, unmarked, with an abort signal, its context frozen", async () => {
		const result = await runFixture(["publish", "--name", "a", "--summary", "s", "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: answered } });
		const run = only(result, "run");
		assert.match(run.invocation, INVOCATION);
		assert.equal(run.invocation, JSON.parse(result.stdout).invocation);
		assert.equal(run.repeat, false);
		assert.equal(run.signalIsAbortSignal, true);
		assert.equal(run.frozen, true);
		assert.equal(run.operation, "create");
		assert.equal(run.command, "publish");
	});

	test("--invocation given to a command that changes something marks a repeat: run is given that identity and true, and a preparing that fails says earlier attempts are uncertain", async () => {
		for (const form of [["--invocation", GIVEN], [`--invocation=${GIVEN}`]]) {
			const result = await runFixture(["update", "--name", "a", "--summary", "s", ...form, "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: { ending: { ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: "repeat" } } } });
			assert.equal(result.status, 3);
			const run = only(result, "run");
			assert.deepEqual([run.invocation, run.repeat], [GIVEN, true]);
			assert.equal(JSON.parse(result.stdout).earlierAttemptsUncertain, true);
			assert.equal(JSON.parse(result.stdout).invocation, GIVEN);
		}
		assertPrepareEnding(await bothForms(["update", "--name", "a", "--summary", "s", "--invocation", GIVEN], { prepare: { settle: { ending: "not-delivered", agpCode: null, proxyCode: "proxy-unreachable" } } }), { operation: "update", agpCode: null, proxyCode: "proxy-unreachable", earlierAttemptsUncertain: true, invocation: GIVEN });
	});

	test("--invocation given to a command of several calls that changes nothing names its first call and marks nothing, and its not-delivered ending says earlierAttemptsUncertain false", async () => {
		const result = await runFixture(["find", "--tag", "k:v", "--invocation", GIVEN, "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: { calls: 3, ending: { ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: "repeat" } } } });
		assert.equal(result.status, 3, result.stderr);
		const run = only(result, "run");
		assert.deepEqual([run.invocation, run.repeat], [GIVEN, false]);
		const calls = result.records.filter((r) => r.event === "call");
		assert.equal(calls.length, 3);
		assert.equal(calls[0].invocation, GIVEN);
		assert.equal(new Set(calls.map((c) => c.invocation)).size, 3, "later calls take new identities");
		assert.ok(calls.every((c) => c.repeat === false), "none marked a repeat");
		assert.deepEqual(JSON.parse(result.stdout), { ending: "not-delivered", operation: "find", invocation: GIVEN, agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: false });
		assertPrepareEnding(await bothForms(["read", "--name", "a", "--invocation", GIVEN], { prepare: { settle: { ending: "not-delivered", agpCode: "NO_ROUTE" } } }), { operation: "read", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: false, invocation: GIVEN });
	});
});
