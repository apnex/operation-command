// command-call-bound - OC3 (E19): a command fixes its invocation identity first, calls the client's `prepare`
// with the deadline its preparation setting gives on the injected clock port, keeps no timer of its own
// while preparing and trusts the decided result, and calls `run` with its bound setting as the call's bound,
// the identity, the repeat flag and an abort signal - or, when preparing does not reach ready, never calls
// `run` and reports the command not delivered. Commands run as child processes of the fixture application.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declareProgram, INTERRUPTED_LINE } from "@apnex/operation-command";
import { sleep, within } from "../support/clock-timer.js";
import { CYCLIC_ERRORS, fixtureDeclaration, MALFORMED } from "../support/fixture-program.js";
import { BASE_ENV, plainFacts, runFixture, startFixture } from "../support/run-command.js";
import { DATA_FORMS, dataEnding, oneGetterEnding, GETTER_FORMS, gettersEnding } from "../support/structural-ending.js";
import { ending as partsEnding, partsProgram, runParts } from "../support/parts-program.js";

const INVOCATION = /^[0-9]{13}-[0-9a-f]{16}$/;
const GIVEN = "1791540000000-3f9a0c1d2b4e5f60";
const answered = { ending: { ending: "answered", answer: { ok: true } } };
const events = (result) => result.records.map((r) => r.event);
const only = (result, event) => {
	const found = result.records.filter((r) => r.event === event);
	assert.equal(found.length, 1, `one ${event} record`);
	return found[0];
};

/** The diagnostic of a prepare result that is neither ready nor a plain-data not-delivered ending, as one line. */
const NEITHER = /^diagnostic: prepare settled to [^\n]*, neither ready nor a not-delivered ending read as plain data\n$/;
const neither = (described) => `prepare settled to ${described}, neither ready nor a not-delivered ending read as plain data`;
const getterCode = '{"ending": "not-delivered", "agpCode": <getter>, "proxyCode": null, "earlierAttemptsUncertain": false}';
// What a Proxy of attempt 5's F1 shows once its one rejected promise was handed back or thrown: its target's own fields.
const proxiedCode = '{"ending": "not-delivered", "agpCode": "TIMEOUT", "proxyCode": null, "earlierAttemptsUncertain": false}';

/** Each malformed prepare result and its diagnostic, written from own data descriptors: no getter, then or conversion runs. */
const PREPARE_MALFORMED = Object.freeze({
	"throwing-ending": neither('{"ending": <getter>}'),
	"throwing-code": neither(getterCode),
	"throwing-then": neither('{"then": <getter>}'),
	"thenable-throws": neither('{"then": <a function>}'),
	"thenable-throwing-ending": neither('{"then": <a function>}'),
	"thenable-rejected-inner": neither('{"then": <a function>}'),
	"rejected-code": neither('{"ending": "not-delivered", "agpCode": <a promise>, "proxyCode": null, "earlierAttemptsUncertain": false}'),
	"rejected-answer": neither('{"ending": "answered", "answer": <a promise>}'),
	"throwing-answer": neither('{"ending": "answered", "answer": <getter>}'),
	"bigint-answer": neither('{"ending": "answered", "answer": 1n}'),
	"cyclic-answer": neither('{"ending": "answered", "answer": {"a": 1, "self": <cycle>}}'),
	"first-read-rejected-code": neither(getterCode),
	"throwing-rejected-code": neither(getterCode),
	"proxy-first-read-rejected-code": neither(proxiedCode),
	"proxy-trap-throws-rejected-code": neither(proxiedCode),
	// Its trap throws on every read, the diagnostic's own included, so the diagnostic cannot read it.
	"proxy-trap-always-throws-rejected-code": neither("<unreadable>"),
	// Its prototype trap throws when prepare's result is asked whether it is a promise: prepare failed with the promise it threw.
	"proxy-prototype-trap-throws-rejected-code": "prepare failed: <a promise>",
	"extra-field": neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": null, "extra": true}'),
	"proxy-nested-first-code": neither('{"ending": "not-delivered", "agpCode": "TIMEOUT", "proxyCode": null, "earlierAttemptsUncertain": false, "hidden": 1}'),
	"proxy-caught-object-code": neither('{"ending": "not-delivered", "agpCode": {}, "proxyCode": null, "earlierAttemptsUncertain": false}'),
	// Its prototype trap throws when prepare's result is asked whether it is a promise: prepare failed with what it threw.
	"proxy-prototype-once-throws-code": 'prepare failed: {"held": <a promise>}',
});

/** The Proxy results of attempt 6's F1: an object holding a rejected promise as a descriptor's first value, before a hidden field; a one-time prototype trap throwing an object holding one, on agpCode or on the result itself. */
const ONCE_OBJECT = Object.freeze(["proxy-nested-first-code", "proxy-caught-object-code", "proxy-prototype-once-throws-code"]);

/** The Proxy results of attempt 5's F1: a rejected promise as a descriptor's value on its first read only, or thrown by the descriptor trap, once or on every read, or by the prototype trap. */
const PROXIED = Object.freeze(["proxy-first-read-rejected-code", "proxy-trap-throws-rejected-code", "proxy-trap-always-throws-rejected-code", "proxy-prototype-trap-throws-rejected-code"]);

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
		// Its own message only: the name an error inherits is never read (zorg's D54).
		for (const result of [both.json, both.plain]) assert.equal(result.stderr, "diagnostic: prepare failed: the socket would not open\n");
	});

	test("prepare settling to anything else ends the command not delivered with null codes and one diagnostic line, run never called", async () => {
		for (const settle of [{ ready: true }, 42, "Ready", null, { ending: "answered", answer: 1 }, { ending: "not-delivered", agpCode: 7 }, { ending: "not-delivered", proxyCode: false },
			{ ending: "not-delivered", agpCode: "NO_ROUTE", extra: 1 }, { ending: "not-delivered", earlierAttemptsUncertain: "yes" }, { ending: "not-delivered", invocation: 1 }, ["not-delivered"]]) {
			const both = await bothForms(["read", "--name", "a"], { prepare: { settle }, run: answered });
			assertPrepareEnding(both, { operation: "read", agpCode: null, proxyCode: null });
			for (const result of [both.json, both.plain]) assert.match(result.stderr, NEITHER, JSON.stringify(settle));
		}
	});

	test("a prepare result that is no plain data - a non-native thenable, a getter on it, a promise in a field, no JSON - ends the command not delivered with null codes and one diagnostic line, no getter or then called, run never called, through the process adapter", async () => {
		for (const [malformed, diagnostic] of Object.entries(PREPARE_MALFORMED)) {
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
			// Every promise the result holds is observed, rejected-answer's included, though no ending field holds it.
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

	test("a prepare result whose getter would give a rejected promise on its first read only, or throw one: the getter is never called, so with standard output's write held the command still exits 3 with one diagnostic line", async () => {
		const escaped = [];
		const onRejection = (reason) => escaped.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			for (const malformed of ["first-read-rejected-code", "throwing-rejected-code"]) {
				const made = MALFORMED[malformed]();
				let reads = 0;
				// Counting the reads of agpCode: none, since a getter is no plain data and is never called (zorg's D54).
				const counted = Object.defineProperty({ ending: "not-delivered", proxyCode: null, earlierAttemptsUncertain: false }, "agpCode", { enumerable: true, get() { reads++; return Object.getOwnPropertyDescriptor(made, "agpCode").get.call(made); } });
				const decl = fixtureDeclaration({});
				decl.client = { prepare: () => counted };
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => assert.fail("run is never called") });
				const err = [];
				const status = await declareProgram(decl).run({ args: ["read", "--name", "a", "--json"], env: BASE_ENV, stdout: () => undefined, stderr: (t) => err.push(t) });
				assert.deepEqual([status, reads, err.length], [3, 0, 1], malformed);
			}
			await sleep(50);
			assert.deepEqual(escaped, [], "no unhandled rejection in this process");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
		for (const malformed of ["first-read-rejected-code", "throwing-rejected-code"]) {
			const diagnostic = PREPARE_MALFORMED[malformed];
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

	test("a prepare result that is a Proxy handing back a rejected promise as a descriptor's value on its first read only, or whose descriptor or prototype trap throws a rejected promise: that very promise is observed, so in this process and with standard output's write held the command exits 3 with one diagnostic line, run never called", async () => {
		// In this process, with --json and without: not delivered with null codes, the diagnostic exact, nothing escaping.
		await noRejectionEscapes(async () => {
			for (const malformed of PROXIED) {
				for (const r of await preparedInProcess(() => ({ value: MALFORMED[malformed]() }))) {
					assert.deepEqual([r.status, r.runs, r.stderr], [3, 0, `diagnostic: ${PREPARE_MALFORMED[malformed]}\n`], `${malformed} ${r.json ? "--json" : "plain"}`);
					assert.equal(r.stdout, preparedRecord(r.json, r.stdout, null, null));
				}
			}
		});
		// Through the process adapter, with no rejection listener: standard output's write is held until the command
		// received SIGINT, sent well after the ending was written, so a rejection left unhandled would end it with status 1.
		for (const malformed of PROXIED) {
			for (const json of [true, false]) {
				const command = startFixture(["read", "--name", "a", ...(json ? ["--json"] : [])], { env: BASE_ENV, scenario: { prepare: { malformed }, run: answered, holdWrite: { until: ["SIGINT"] } } });
				await command.waitFor("write-held");
				await sleep(200);
				command.signal("SIGINT");
				const r = await command.ended;
				assert.deepEqual([r.status, r.signal, r.stderr], [3, null, `diagnostic: ${PREPARE_MALFORMED[malformed]}\n`], `${malformed} ${json ? "--json" : "plain"}`);
				assert.ok(events(r).includes("signal-received") && events(r).includes("write-released"), "the process lived until the held write was released");
				assert.ok(!events(r).includes("run"), "run is never called");
				assert.equal(r.stdout, preparedRecord(json, r.stdout, null, null));
			}
		}
	});

	test("a prepare result that is a Proxy handing back an object holding a rejected promise as a descriptor's first value before a hidden field (nested-first), or whose one-time prototype trap throws an object holding one (caught-object), and prepare throwing or rejecting a Proxy of a long-messaged error whose detail is fresh on every read (diagnostic-new): every promise obtained is observed, so in this process and with standard output's write held the command exits 3 with one diagnostic line, run never called", async () => {
		const fresh = cut(`diagnostic: prepare failed: ${CYCLIC_ERRORS["long-message-fresh-detail"].said}`);
		assert.equal(fresh.length, 1003, "cut at 1000 characters, ... added");
		await noRejectionEscapes(async () => {
			for (const malformed of ONCE_OBJECT) {
				for (const r of await preparedInProcess(() => ({ value: MALFORMED[malformed]() }))) {
					assert.deepEqual([r.status, r.runs, r.stderr], [3, 0, `diagnostic: ${PREPARE_MALFORMED[malformed]}\n`], `${malformed} ${r.json ? "--json" : "plain"}`);
					assert.equal(r.stdout, preparedRecord(r.json, r.stdout, null, null));
				}
			}
			for (const rejects of [false, true]) {
				for (const json of [true, false]) {
					let runs = 0;
					const decl = fixtureDeclaration({});
					decl.client = { prepare: () => { const e = CYCLIC_ERRORS["long-message-fresh-detail"].make(); if (rejects) return Promise.reject(e); throw e; } };
					decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: 1 }; } });
					const out = [];
					const err = [];
					const status = await within(declareProgram(decl).run({ args: ["read", "--name", "a", ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), "diagnostic-new");
					assert.deepEqual([status, runs, err], [3, 0, [`${fresh}\n`]], `${rejects ? "rejects" : "throws"} ${json ? "--json" : "plain"}`);
					assert.equal(out.join(""), preparedRecord(json, out.join(""), null, null));
				}
			}
		});
		// Through the process adapter, with no rejection listener: standard output's write is held until the command
		// received SIGINT, sent well after the ending was written, so a rejection left unhandled would end it with status 1.
		const scenarios = [
			...ONCE_OBJECT.map((malformed) => ({ prepare: { malformed }, diagnostic: `diagnostic: ${PREPARE_MALFORMED[malformed]}\n` })),
			...[false, true].map((rejects) => ({ prepare: { fails: { error: "long-message-fresh-detail", rejects } }, diagnostic: `${fresh}\n` })),
		];
		for (const { prepare, diagnostic } of scenarios) {
			for (const json of [true, false]) {
				const command = startFixture(["read", "--name", "a", ...(json ? ["--json"] : [])], { env: BASE_ENV, scenario: { prepare, run: answered, holdWrite: { until: ["SIGINT"] } } });
				await command.waitFor("write-held");
				await sleep(200);
				command.signal("SIGINT");
				const r = await command.ended;
				assert.deepEqual([r.status, r.signal, r.stderr], [3, null, diagnostic], `${JSON.stringify(prepare)} ${json ? "--json" : "plain"}`);
				assert.ok(events(r).includes("signal-received") && events(r).includes("write-released"), "the process lived until the held write was released");
				assert.ok(!events(r).includes("run"), "run is never called");
				assert.equal(r.stdout, preparedRecord(json, r.stdout, null, null));
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

/** Runs read --name a in this process, with --json and without, prepare giving what `settle` makes afresh for each; run counted. */
async function preparedInProcess(settle) {
	const results = [];
	for (const json of [true, false]) {
		let runs = 0;
		const decl = fixtureDeclaration({});
		const made = settle();
		decl.client = { prepare: () => made.value };
		decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: { ok: true } }; } });
		const out = [];
		const err = [];
		const status = await within(declareProgram(decl).run({ args: ["read", "--name", "a", ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), "the command's status");
		results.push({ json, status, runs, stdout: out.join(""), stderr: err.join(""), made });
	}
	return results;
}

/** The not-delivered record a command prints for its preparing, in either form, under the invocation it printed. */
function preparedRecord(json, stdout, agpCode, proxyCode) {
	const invocation = json ? JSON.parse(stdout).invocation : plainFacts(stdout).invocation;
	assert.match(invocation, INVOCATION);
	return json
		? `${JSON.stringify({ ending: "not-delivered", operation: "read", invocation, agpCode, proxyCode, earlierAttemptsUncertain: false })}\n`
		: `ending: not-delivered\noperation: read\ninvocation: ${invocation}\nagpCode: ${agpCode ?? "null"}\nproxyCode: ${proxyCode ?? "null"}\nearlierAttemptsUncertain: false\n`;
}

/** A diagnostic line as OC4 cuts it: at 1000 characters, with ... added. */
const cut = (line) => line.length > 1000 ? `${line.slice(0, 1000)}...` : line;

/** Collects unhandled rejections while `body` runs, and a little after. */
async function noRejectionEscapes(body) {
	const escaped = [];
	const onRejection = (reason) => escaped.push(reason);
	process.on("unhandledRejection", onRejection);
	try {
		await body();
		await sleep(50);
	} finally {
		process.off("unhandledRejection", onRejection);
	}
	assert.deepEqual(escaped, [], "no unhandled rejection");
}

describe("OC3 - what prepare settles to: the string ready, or a not-delivered ending read by its declared fields", { concurrency: 4 }, () => {
	test("prepare settling to the string \"ready\" reaches run: status 0, standard error empty, the whole record in both forms", async () => {
		const { json, plain } = await bothForms(["read", "--name", "a"], { prepare: { settle: "ready" }, run: answered });
		for (const r of [json, plain]) {
			assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
			assert.equal(only(r, "prepare-settled").settle, "ready");
			assert.equal(only(r, "run").command, "read");
		}
		const invocation = only(json, "run").invocation;
		assert.equal(json.stdout, `${JSON.stringify({ ending: "answered", operation: "read", invocation, answer: { ok: true } })}\n`);
		assert.equal(plain.stdout, `ending: answered\noperation: read\ninvocation: ${only(plain, "run").invocation}\nanswer-ok: true\nanswer-json: {"ok":true}\nverbose: false\n`);
	});

	test("plain-data not-delivered endings, with the codes alone or with the caller interface's other not-delivered fields, a null prototype included: the command not delivered with that ending's codes and no diagnostic", async () => {
		const address = { invocation: "1791540000000-1234567890abcdef", attempt: null, operation: "read", earlierAttemptsUncertain: true };
		for (const [fields, agpCode, proxyCode] of [
			[{ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null }, "NO_ROUTE", null],
			[{ ending: "not-delivered", proxyCode: "key-mismatch" }, null, "key-mismatch"],
			[{ ending: "not-delivered" }, null, null],
			[{ ending: "not-delivered", agpCode: "TIMEOUT", proxyCode: null, ...address }, "TIMEOUT", null],
			[Object.assign(Object.create(null), { ending: "not-delivered", agpCode: null, proxyCode: "proxy-unreachable", ...address }), null, "proxy-unreachable"],
		]) {
			for (const r of await preparedInProcess(() => ({ value: fields }))) {
				assert.deepEqual([r.status, r.runs, r.stderr], [3, 0, ""], JSON.stringify(fields));
				assert.equal(r.stdout, preparedRecord(r.json, r.stdout, agpCode, proxyCode));
			}
		}
	});

	test("not-delivered endings with a custom prototype, an inherited field, a non-enumerable field or a getter: no plain data, so not delivered with null codes and one diagnostic line, zero getter calls, run never called", async () => {
		for (const [agpCode, proxyCode] of [["NO_ROUTE", null], [null, "key-mismatch"]]) {
			const fields = { ending: "not-delivered", agpCode, proxyCode };
			for (const form of GETTER_FORMS) {
				for (const r of await preparedInProcess(() => gettersEnding(fields, form, ["extra"]))) {
					assert.deepEqual([r.status, r.runs], [3, 0], `${form} ${agpCode}`);
					assert.match(r.stderr, NEITHER, form);
					assert.equal(r.stdout, preparedRecord(r.json, r.stdout, null, null), form);
					assert.deepEqual(r.made.reads, {}, `${form}: no getter called`);
					assert.deepEqual(r.made.touched, [], `${form}: no field touched`);
				}
			}
			for (const form of DATA_FORMS) {
				for (const r of await preparedInProcess(() => ({ value: dataEnding(fields, form) }))) {
					assert.deepEqual([r.status, r.runs], [3, 0], form);
					assert.match(r.stderr, NEITHER, form);
					assert.equal(r.stdout, preparedRecord(r.json, r.stdout, null, null), form);
				}
			}
		}
	});

	test("an object that is no not-delivered ending - an extra field, a getter that would throw or give a promise, a native promise in a field, a non-native thenable: not delivered with null codes and one diagnostic line, no getter or then called, run never called, no rejection escaping", async () => {
		const nd = { ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null };
		const calls = [];
		/** A plain object holding `fields`, with `name` an own enumerable getter recording each call. */
		const getter = (name, gives) => ({ value: Object.defineProperty({ ...nd }, name, { enumerable: true, get() {
			calls.push(name);
			if (gives === "throws") throw new Error(`the ${name} getter threw`);
			return Promise.reject(new Error(`the ${name} getter's promise rejected`));
		} }) });
		await noRejectionEscapes(async () => {
			for (const [make, diagnostic] of [
				[() => ({ value: dataEnding({ ending: "answered", answer: 1 }, "class-instance") }), neither('{"ending": "answered", "answer": 1}')],
				[() => ({ value: { ...nd, extra: true } }), neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": null, "extra": true}')],
				[() => getter("ending", "throws"), neither('{"ending": <getter>, "agpCode": "NO_ROUTE", "proxyCode": null}')],
				[() => getter("agpCode", "throws"), neither('{"ending": "not-delivered", "agpCode": <getter>, "proxyCode": null}')],
				[() => getter("ending", "promise"), neither('{"ending": <getter>, "agpCode": "NO_ROUTE", "proxyCode": null}')],
				[() => getter("proxyCode", "promise"), neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": <getter>}')],
				[() => ({ value: { ...nd, proxyCode: Promise.reject(new Error("the proxyCode promise rejected")) } }), neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": <a promise>}')],
				[() => ({ value: { ...nd, invocation: { inner: [Promise.reject(new Error("the invocation's inner promise rejected"))] } } }), neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": null, "invocation": {"inner": [<a promise>]}}')],
				[() => ({ value: { ...nd, then(resolve) { calls.push("then"); resolve("ready"); } } }), neither('{"ending": "not-delivered", "agpCode": "NO_ROUTE", "proxyCode": null, "then": <a function>}')],
				[() => ({ value: { then(resolve) { calls.push("then"); resolve("ready"); } } }), neither('{"then": <a function>}')],
			]) {
				for (const r of await preparedInProcess(make)) {
					assert.deepEqual([r.status, r.runs, r.stderr], [3, 0, `diagnostic: ${diagnostic}\n`]);
					assert.equal(r.stdout, preparedRecord(r.json, r.stdout, null, null));
				}
			}
		});
		assert.deepEqual(calls, [], "no getter and no then called");
	});

	test("prepare rejecting or throwing an error whose own message is itself, which holds a value that holds it, whose own name or own message exceeds 1000 characters beside a rejected promise in another own property, and one too long for a line: not delivered with null codes and one finite diagnostic line, no unhandled rejection, run never called, through the process adapter", async () => {
		const cases = [...["name-itself", "message-itself", "holds-its-holder", "long-name-rejected-message", "long-name-rejected-detail", "long-name-rejecting-getter", "long-message-rejected-detail", "long-message-fresh-detail"].flatMap((error) => [{ error, rejects: true }, { error, rejects: false }]), { error: "long-message", rejects: true }];
		for (const fails of cases) {
			// An unhandled rejection would end the child with status 1 before its ending is written.
			const both = await bothForms(["read", "--name", "a"], { prepare: { fails }, run: answered });
			const line = cut(`diagnostic: prepare failed: ${CYCLIC_ERRORS[fails.error].said}`);
			if (fails.error.startsWith("long-")) assert.equal(line.length, 1003, "cut at 1000 characters, ... added");
			for (const r of [both.json, both.plain]) {
				assert.deepEqual([r.status, r.signal, r.stderr], [3, null, `${line}\n`], `${fails.error} ${fails.rejects ? "rejects" : "throws"}`);
				assert.ok(!events(r).includes("run"), "run is never called");
				assert.equal(r.stdout, preparedRecord(r === both.json, r.stdout, null, null));
			}
		}
		// In this process too, in both forms: no rejection escapes, for each long-named or long-messaged error thrown or rejected.
		await noRejectionEscapes(async () => {
			for (const error of ["long-name-rejected-message", "long-name-rejected-detail", "long-name-rejecting-getter", "long-message-rejected-detail", "long-message-fresh-detail"]) {
				for (const rejects of [true, false]) {
					for (const json of [true, false]) {
						let runs = 0;
						const decl = fixtureDeclaration({});
						decl.client = { prepare: () => { const e = CYCLIC_ERRORS[error].make(); if (rejects) return Promise.reject(e); throw e; } };
						decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: 1 }; } });
						const out = [];
						const err = [];
						const status = await within(declareProgram(decl).run({ args: ["read", "--name", "a", ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), error);
						const line = cut(`diagnostic: prepare failed: ${CYCLIC_ERRORS[error].said}`);
						assert.equal(line.length, 1003, "cut at 1000 characters, ... added");
						assert.deepEqual([status, runs, err], [3, 0, [`${line}\n`]], `${error} ${rejects} ${json ? "--json" : "plain"}`);
						assert.equal(out.join(""), preparedRecord(json, out.join(""), null, null));
					}
				}
			}
		});
	});

	test("each of these settling after an interruption while preparing leaves the interruption's report and status 1 alone, reaches nothing, and lets no rejection escape", async () => {
		const nd = { ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null };
		const late = [
			...GETTER_FORMS.map((form) => () => ({ value: gettersEnding(nd, form, ["extra"]).value })),
			...DATA_FORMS.map((form) => () => ({ value: dataEnding(nd, form) })),
			() => ({ value: "ready" }),
			// A plain not-delivered ending whose sole defect is an extra own data field (attempt 5's F2).
			() => ({ value: { ...nd, extra: true } }),
			() => ({ value: dataEnding({ ending: "answered", answer: 1 }, "class-instance") }),
			// A Proxy handing back a rejected promise on its first descriptor read, or throwing one from its trap (attempt 5's F1).
			...PROXIED.map((malformed) => () => ({ value: MALFORMED[malformed]() })),
			// A Proxy handing back an object holding a rejected promise, or a one-time prototype trap throwing one (attempt 6's F1).
			...ONCE_OBJECT.map((malformed) => () => ({ value: MALFORMED[malformed]() })),
			() => ({ value: oneGetterEnding(nd, "agpCode", "throws").value }),
			() => ({ value: oneGetterEnding(nd, "agpCode", "promise").value }),
			...Object.values(CYCLIC_ERRORS).map((e) => () => ({ error: e.make() })),
		];
		await noRejectionEscapes(async () => {
			for (const make of late) {
				for (const json of [true, false]) {
					let runs = 0;
					let resolve;
					let reject;
					const decl = fixtureDeclaration({});
					decl.client = { prepare: () => new Promise((y, n) => { resolve = y; reject = n; }) };
					decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: 1 }; } });
					const listeners = new Set();
					const out = [];
					const err = [];
					const status = declareProgram(decl).run({ args: ["read", "--name", "a", ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t), interruptions: { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } } });
					await sleep(5);
					for (const l of [...listeners]) l();
					assert.equal(await within(status, "the interrupted command's status"), 1);
					const settled = make();
					if ("error" in settled) reject(settled.error);
					else resolve(settled.value);
					await sleep(5);
					assert.deepEqual([runs, out, err], [0, [], [`${INTERRUPTED_LINE}\n`]]);
				}
			}
		});
		// Through the process adapter: prepare settles once its signal fired, and the command's report is the interruption's alone.
		for (const prepare of [{ untilAbort: true, fails: { error: "name-itself", rejects: true } }, { untilAbort: true, fails: { error: "holds-its-holder", rejects: false } }, { untilAbort: true, malformed: "throwing-rejected-code" },
			{ untilAbort: true, malformed: "extra-field" }, { untilAbort: true, fails: { error: "long-message-rejected-detail", rejects: true } }, ...PROXIED.map((malformed) => ({ untilAbort: true, malformed }))]) {
			for (const json of [true, false]) {
				const command = startFixture(["read", "--name", "a", ...(json ? ["--json"] : [])], { env: BASE_ENV, scenario: { prepare, run: answered } });
				await command.waitFor("prepare");
				command.signal("SIGINT");
				const r = await command.ended;
				assert.deepEqual([r.status, r.signal, r.stdout, r.stderr], [1, null, "", `${INTERRUPTED_LINE}\n`], JSON.stringify(prepare));
				assert.deepEqual(events(r).filter((e) => e !== "clock-began"), ["prepare", "prepare-aborted", "prepare-settled"], "prepare settled after the interruption, and nothing more was called");
			}
		}
	});
});

describe("OC3 - what a parts command's run is given (D4-E8)", () => {
	test("D4-E8: run of a parts command is given onPart, a function, with the call's other settings; run of any other command is given none", async () => {
		const seen = {};
		const record = (name) => async (context) => {
			seen[name] = { keys: Object.keys(context), onPart: typeof context.onPart, frozen: Object.isFrozen(context), bound: context.bound, signal: context.signal instanceof AbortSignal };
			return partsEnding({ ending: "answered", answer: null }, name);
		};
		const program = partsProgram({ run: record("follow"), readRun: record("read") });
		assert.equal((await runParts(program, ["follow", "--since", "0", "--timeout", "3s"])).status, 0);
		assert.equal((await runParts(program, ["read", "--timeout", "3s"])).status, 0);
		assert.deepEqual(seen.follow, { keys: ["client", "command", "operation", "flags", "bound", "invocation", "repeat", "signal", "onPart"], onPart: "function", frozen: true, bound: 3000, signal: true });
		assert.deepEqual(seen.read, { keys: ["client", "command", "operation", "flags", "bound", "invocation", "repeat", "signal"], onPart: "undefined", frozen: true, bound: 3000, signal: true });
	});

	test("D4-E8: onPart returns nothing and never throws, whatever it is given and whenever it is called", async () => {
		const returned = [];
		const program = partsProgram({ run: async ({ onPart }) => {
			returned.push(onPart({ n: 1 }), onPart(undefined), onPart({ get x() { throw new Error("a getter threw"); } }), onPart(Symbol("s")));
			return partsEnding({ ending: "answered", answer: null });
		} });
		const { status } = await runParts(program, ["follow", "--since", "0"]);
		assert.equal(status, 0);
		assert.deepEqual(returned, [undefined, undefined, undefined, undefined]);
	});
});
