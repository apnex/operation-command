// ending-exit-status - OC4 (E19): each ending exits with its own status and prints its record on standard
// output, whole, as one JSON object or one fact per line; a usage error and an interruption before `run`
// exit with status 1, printing only on standard error; interruptions after `run` fire its abort signal once
// and never end the wait for the ending the call layer gives. Each case checks both streams and the status,
// with the fixture application run as a child process and real signals sent to it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declareProgram, EXIT_STATUS, INTERRUPTED_LINE } from "@apnex/operation-command";
import { sleep, within } from "../support/clock-timer.js";
import { fixtureDeclaration } from "../support/fixture-program.js";
import { BASE_ENV, plainFacts, runFixture, startFixture } from "../support/run-command.js";

const INVOCATION = /^[0-9]{13}-[0-9a-f]{16}$/;
const REFUSAL = { part: "store", code: "input-misfit", what: "The input does not fit.", why: "A name is required.", fix: "Give a name.", details: { field: "name" }, misfits: [{ pointer: "/name", keyword: "required", expected: "a name", fit: "add it" }] };
const events = (result) => result.records.map((r) => r.event);
const BASE = ["publish", "--name", "a", "--summary", "it's \"quoted\""];

/** Runs the fixture's publish with an ending, with --json and without. */
async function ended(ending, scenario = {}) {
	const s = { prepare: { settle: "ready" }, run: { ending }, ...scenario };
	return { json: await runFixture([...BASE, "--json"], { env: BASE_ENV, scenario: s }), plain: await runFixture(BASE, { env: BASE_ENV, scenario: s }) };
}

describe("OC4 - each ending's status, its JSON object whole and its plain form", { concurrency: 4 }, () => {
	test("the exit statuses: answered 0, refused 2, not delivered 3, unknown 4, a usage error and an interruption before run 1", () => {
		assert.deepEqual({ ...EXIT_STATUS }, { answered: 0, refused: 2, "not-delivered": 3, unknown: 4, usage: 1, interrupted: 1 });
	});

	test("answered: status 0, the answer as the operation gave it, worded by the application in the plain form", async () => {
		const answer = { ok: true, position: 7, nested: [1, { a: null }] };
		const { json, plain } = await ended({ ending: "answered", answer });
		for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [0, ""]);
		const record = JSON.parse(json.stdout);
		assert.match(record.invocation, INVOCATION);
		assert.equal(json.stdout, `${JSON.stringify({ ending: "answered", operation: "create", invocation: record.invocation, answer })}\n`);
		const facts = plainFacts(plain.stdout);
		assert.equal(plain.stdout, `ending: answered\noperation: create\ninvocation: ${facts.invocation}\nanswer-ok: true\nanswer-json: ${JSON.stringify(answer)}\nverbose: false\n`);
		const unworded = await runFixture(BASE, { env: BASE_ENV, scenario: { plainAnswer: true, run: { ending: { ending: "answered", answer } } } });
		assert.equal(unworded.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(unworded.stdout).invocation}\nanswer: ${JSON.stringify(answer)}\n`, "an answer the application does not word is printed as JSON");
	});

	test("refused: status 2, the refusal record unchanged", async () => {
		const { json, plain } = await ended({ ending: "refused", refusal: REFUSAL });
		for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [2, ""]);
		const record = JSON.parse(json.stdout);
		assert.equal(json.stdout, `${JSON.stringify({ ending: "refused", operation: "create", invocation: record.invocation, refusal: REFUSAL })}\n`);
		assert.equal(plain.stdout, `ending: refused\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nrefusal: ${JSON.stringify(REFUSAL)}\n`);
	});

	test("not delivered: status 3, agpCode, proxyCode and earlierAttemptsUncertain as the call layer gave them", async () => {
		for (const ending of [{ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: false }, { ending: "not-delivered", agpCode: null, proxyCode: "proxy-unreachable", earlierAttemptsUncertain: true }]) {
			const { json, plain } = await ended(ending);
			for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [3, ""]);
			const { ending: e, agpCode, proxyCode, earlierAttemptsUncertain } = ending;
			assert.equal(json.stdout, `${JSON.stringify({ ending: e, operation: "create", invocation: JSON.parse(json.stdout).invocation, agpCode, proxyCode, earlierAttemptsUncertain })}\n`);
			assert.equal(plain.stdout, `ending: not-delivered\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nagpCode: ${agpCode}\nproxyCode: ${proxyCode}\nearlierAttemptsUncertain: ${earlierAttemptsUncertain}\n`);
		}
	});

	test("unknown: status 4, reason, agpCode, deliveryReport and repeat, the plain form's repeat one command line", async () => {
		for (const ending of [{ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" }, { ending: "unknown", reason: "answer-not-sendable", agpCode: "MESSAGE_TOO_LARGE", deliveryReport: null }]) {
			const { json, plain } = await ended(ending);
			for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [4, ""]);
			const record = JSON.parse(json.stdout);
			const settings = ["--host", "host-a", "--service", "store", "--url", "ws://127.0.0.1:47100/agp", "--identity", "alice", "--timeout", "10s", "--connect-timeout", "5s", "--retries", "3"];
			assert.deepEqual(record, { ending: "unknown", operation: "create", invocation: record.invocation, reason: ending.reason, agpCode: ending.agpCode, deliveryReport: ending.deliveryReport,
				repeat: ["publish", ...settings, "--json", "--name", "a", "--summary", "it's \"quoted\"", "--invocation", record.invocation] });
			assert.equal(json.stdout, `${JSON.stringify(record)}\n`);
			const inv = plainFacts(plain.stdout).invocation;
			const line = ["fixture", "publish", ...settings, "--name", "a", "--summary", "it's \"quoted\"", "--invocation", inv].map((w) => `'${w.replaceAll("'", "'\\''")}'`).join(" ");
			assert.equal(plain.stdout, `ending: unknown\noperation: create\ninvocation: ${inv}\nreason: ${ending.reason}\nagpCode: ${ending.agpCode}\ndeliveryReport: ${ending.deliveryReport}\nrepeat: ${line}\n`);
		}
	});

	test("a run that rejects, or returns what is no ending, cannot say whether it invoked: unknown, with its repeat and one diagnostic line", async () => {
		for (const run of [{ throws: "the client broke" }, { returns: { ending: "maybe" } }, { returns: { ending: "unknown", reason: "x" } }, { returns: null }]) {
			const result = await runFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { run } });
			assert.equal(result.status, 4);
			const record = JSON.parse(result.stdout);
			assert.deepEqual([record.ending, record.reason, record.agpCode, record.deliveryReport, record.repeat.at(-2)], ["unknown", "run-failed", null, null, "--invocation"]);
			assert.match(result.stderr, /^diagnostic: (run failed: Error: the client broke|run returned [^\n]*)\n$/);
		}
	});

	test("a usage error, with --json and without, leaves standard output empty and exits 1", async () => {
		for (const args of [["publish", "--name", "a"], ["publish", "--name", "a", "--json"]]) {
			const r = await runFixture(args, { env: BASE_ENV, scenario: { prepare: { settle: "ready" } } });
			assert.deepEqual([r.status, r.stdout], [1, ""]);
			assert.equal(r.stderr, "usage: the flag --summary is required by the command publish\n");
		}
	});
});

describe("OC4 - interruptions, sent to the command as real signals", { concurrency: 3 }, () => {
	test("an interruption before run, while preparing, with --json and without, by SIGINT and by SIGTERM: status 1, the line on standard error, standard output empty, prepare's signal fired", async () => {
		for (const [args, sig] of [[BASE, "SIGINT"], [[...BASE, "--json"], "SIGINT"], [BASE, "SIGTERM"], [[...BASE, "--json"], "SIGTERM"]]) {
			const command = startFixture(args, { env: BASE_ENV, scenario: { prepare: { untilAbort: true, afterCallMs: 60_000 } } });
			await command.waitFor("prepare");
			command.signal(sig);
			const r = await command.ended;
			assert.deepEqual([r.status, r.signal, r.stdout, r.stderr], [1, null, "", `${INTERRUPTED_LINE}\n`], `${sig} ${args.join(" ")}`);
			assert.ok(events(r).includes("prepare-aborted"));
			assert.ok(!events(r).includes("run"));
		}
	});

	test("an interruption while preparing, after which prepare settles ready: run is never called", async () => {
		const command = startFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { prepare: { untilAbort: true, settle: "ready" } } });
		await command.waitFor("prepare");
		command.signal("SIGINT");
		const r = await command.ended;
		assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", `${INTERRUPTED_LINE}\n`]);
		assert.deepEqual(events(r).filter((e) => e !== "clock-began"), ["prepare", "prepare-aborted", "prepare-settled"], "prepare settled ready afterwards, and nothing more was called");
		assert.equal(r.records.find((x) => x.event === "prepare-settled").settle, "ready");
	});

	test("an interruption after run with the send not yet admitted: run's signal fires, and the call layer's not-delivered ending with ABORTED is reported", async () => {
		const abortEnding = { ending: "not-delivered", agpCode: "ABORTED", proxyCode: null, earlierAttemptsUncertain: false };
		const command = startFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: { untilAbort: true, abortEnding } } });
		await command.waitFor("run-waiting");
		command.signal("SIGINT");
		const r = await command.ended;
		assert.deepEqual([r.status, r.stderr], [3, ""]);
		assert.deepEqual(JSON.parse(r.stdout), { ending: "not-delivered", operation: "create", invocation: JSON.parse(r.stdout).invocation, agpCode: "ABORTED", proxyCode: null, earlierAttemptsUncertain: false });
		assert.equal(r.records.filter((x) => x.event === "run-aborted").length, 1);
	});

	test("an interruption after admission: the abort changes nothing, and the ending the call layer gives is reported", async () => {
		const command = startFixture(BASE, { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: { afterMs: 1500, ending: { ending: "answered", answer: { ok: "late" } } } } });
		await command.waitFor("run-waiting");
		command.signal("SIGTERM");
		const r = await command.ended;
		assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
		assert.equal(plainFacts(r.stdout)["answer-ok"], "late");
		assert.equal(plainFacts(r.stdout).ending, "answered");
		assert.ok(r.records.findIndex((x) => x.event === "run-aborted") < r.records.findIndex((x) => x.event === "run-returned"));
	});

	test("a second and a third interruption after admission change nothing: the command still reports the ending the call layer gives", async () => {
		const ending = { ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "unknown" };
		const command = startFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, run: { afterMs: 3000, ending } } });
		await command.waitFor("run-waiting");
		for (const sig of ["SIGINT", "SIGINT", "SIGTERM"]) {
			command.signal(sig);
			await sleep(250);
		}
		const r = await command.ended;
		assert.deepEqual([r.status, r.signal, r.stderr], [4, null, ""]);
		const record = JSON.parse(r.stdout);
		assert.deepEqual([record.ending, record.reason, record.deliveryReport, record.repeat.at(-1)], ["unknown", "bound-passed", "unknown", record.invocation]);
		assert.equal(r.records.filter((x) => x.event === "run-aborted").length, 1, "run's signal fired once");
	});

	test("an interruption after the ending was given, and one during its printing, change nothing: the ending is printed whole with its status", async () => {
		const ending = { ending: "answered", answer: { ok: "printed" } };
		for (const [args, scenario] of [[[...BASE, "--json"], { run: { ending, selfSignal: "SIGINT" } }], [BASE, { run: { ending, selfSignal: "SIGTERM" }, wordSelfSignal: "SIGINT" }]]) {
			const r = await runFixture(args, { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, ...scenario } });
			assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
			if (args.includes("--json")) assert.deepEqual(JSON.parse(r.stdout).answer, { ok: "printed" });
			else {
				assert.equal(r.stdout.split("\n").length, 7, "every line printed");
				assert.ok(events(r).includes("wording"));
			}
		}
	});
});

describe("OC4 - interruptions at exact moments, through an injected interruption source", () => {
	/** Runs the fixture program in this process with in-memory streams and an interruption source the test fires. */
	function inProcess(args, scenario, { duringWrite = false } = {}) {
		const listeners = new Set();
		const fire = () => { for (const l of [...listeners]) l(); };
		const out = [];
		const err = [];
		const io = { args, env: BASE_ENV, stdout: (t) => { if (duringWrite) fire(); out.push(t); if (duringWrite) fire(); }, stderr: (t) => err.push(t), interruptions: { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } } };
		return { fire, out, err, status: declareProgram(fixtureDeclaration(scenario)).run(io) };
	}

	test("interruptions while the ending is being written change nothing: it is written whole and the status is the ending's", async () => {
		const c = inProcess([...BASE, "--json"], { run: { ending: { ending: "refused", refusal: REFUSAL } } }, { duringWrite: true });
		assert.equal(await within(c.status, "the command's status"), 2);
		assert.equal(c.out.length, 1);
		assert.deepEqual(JSON.parse(c.out[0]).refusal, REFUSAL);
		assert.deepEqual(c.err, []);
	});

	test("prepare settling ready after the interruption that ended the command never reaches run", async () => {
		let resolvePrepare;
		let runs = 0;
		const decl = fixtureDeclaration({});
		decl.client = { prepare: () => new Promise((resolve) => { resolvePrepare = resolve; }) };
		decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { runs++; return { ending: "answered", answer: 1 }; } });
		const listeners = new Set();
		const out = [];
		const err = [];
		const status = declareProgram(decl).run({ args: [...BASE, "--json"], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t), interruptions: { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } } });
		await sleep(20);
		for (const l of [...listeners]) l();
		assert.equal(await within(status, "the command's status after its interruption"), 1);
		resolvePrepare("ready");
		await sleep(20);
		assert.equal(runs, 0);
		assert.deepEqual([out, err], [[], [`${INTERRUPTED_LINE}\n`]]);
	});
});
