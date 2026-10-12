// integrated-commands - OC7 (E19): a fixture application's declared commands, and the printed repeats of
// their unknown endings, run as child processes through operation-call's real caller over AGP's production
// in-process carrier, comparing the input, host, service, principal and invocation identity the operation
// receives, and the output, with the declaration's; with interruptions, sent as real signals, before the
// send is admitted, after admission and after the ending, each reporting the call layer's ending unchanged.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sleep } from "../support/clock-timer.js";
import { INTEGRATED_COMMAND, plainFacts, programDirectory, runShellLine, shellWords, start } from "../support/run-command.js";

const NAME = "inte grated's";
const dir = programDirectory(NAME, INTEGRATED_COMMAND);
const ENV = Object.freeze({ FIX_HOST: "host-a", FIX_IDENTITY: "alice" });
const REFUSAL = { part: "fixture", code: "declined", what: "The operation declined.", why: "The scenario says so.", fix: "Change the scenario.", details: { scenario: true } };
const begin = (args, { env = ENV, scenario = {} } = {}) => start(process.execPath, [INTEGRATED_COMMAND, ...args], { env, scenario: { name: NAME, ...scenario } });
const run = (args, options) => begin(args, options).ended;
const received = (result) => result.records.filter((r) => r.event === "received");
const only = (list, what) => {
	assert.equal(list.length, 1, `exactly one ${what}`);
	return list[0];
};

describe("OC7 - each ending through the real call layer, plainly and as JSON, unchanged", { concurrency: 3 }, () => {
	test("answered: the operation receives the input the declaration builds, at the host, service and principal the settings name, under the identity printed", async () => {
		const args = ["publish", "--name", "a", "--summary", "it's \"here\"", "--tag", "k:v", "--tag", "a:b", "--service", "other", "--token", "s3cret", "--verbose"];
		const json = await run([...args, "--json"], { env: { ...ENV, FIX_HOST: "host-b" } });
		assert.deepEqual([json.status, json.stderr], [0, ""]);
		const got = only(received(json), "request");
		const input = { name: "a", summary: "it's \"here\"", tags: ["k:v", "a:b"], token: "s3cret", verbose: true };
		assert.deepEqual({ node: got.node, service: got.service, operation: got.operation, principal: got.principal, input: got.input }, { node: "host-b", service: "other", operation: "create", principal: "alice", input });
		const record = JSON.parse(json.stdout);
		assert.equal(record.invocation, got.invocation);
		assert.equal(json.stdout, `${JSON.stringify({ ending: "answered", operation: "create", invocation: got.invocation, answer: { node: "host-b", service: "other", operation: "create", input } })}\n`);
		const plain = await run(args, { env: { ...ENV, FIX_HOST: "host-b" } });
		assert.equal(plain.status, 0);
		const inv = only(received(plain), "request").invocation;
		assert.equal(plain.stdout, `ending: answered\noperation: create\ninvocation: ${inv}\nanswer: ${JSON.stringify({ node: "host-b", service: "other", operation: "create", input })}\n`);
	});

	test("refused: the operation's refusal record, unchanged, status 2", async () => {
		const json = await run(["read", "--name", "a", "--json"], { scenario: { operations: { read: { mode: "refuse" } } } });
		assert.deepEqual([json.status, json.stderr], [2, ""]);
		assert.deepEqual(JSON.parse(json.stdout), { ending: "refused", operation: "read", invocation: only(received(json), "request").invocation, refusal: REFUSAL });
		const plain = await run(["read", "--name", "a"], { scenario: { operations: { read: { mode: "refuse" } } } });
		assert.equal(plain.status, 2);
		assert.equal(plainFacts(plain.stdout).refusal, JSON.stringify(REFUSAL));
	});

	test("not delivered: a host no route reaches, AGP's code unchanged, status 3, the operation never receiving it", async () => {
		const json = await run(["publish", "--name", "a", "--summary", "s", "--host", "host-z", "--json"]);
		assert.deepEqual([json.status, json.stderr], [3, ""]);
		const record = JSON.parse(json.stdout);
		assert.deepEqual({ ...record, agpCode: ["NO_ROUTE", "INSTANCE_UNREACHABLE"].includes(record.agpCode) }, { ending: "not-delivered", operation: "create", invocation: record.invocation, agpCode: true, proxyCode: null, earlierAttemptsUncertain: false });
		assert.deepEqual(received(json), []);
		const plain = await run(["publish", "--name", "a", "--summary", "s", "--host", "host-z"]);
		assert.equal(plain.status, 3);
		assert.equal(plainFacts(plain.stdout).earlierAttemptsUncertain, "false");
	});

	test("unknown: the call's bound from the bound setting passes with the operation silent, status 4, with its repeat", async () => {
		const started = performance.now();
		const json = await run(["publish", "--name", "a", "--summary", "s", "--timeout", "400ms", "--json"], { scenario: { operations: { create: { mode: "silent" } } } });
		assert.ok(performance.now() - started >= 400);
		assert.deepEqual([json.status, json.stderr], [4, ""]);
		const record = JSON.parse(json.stdout);
		assert.equal(record.reason, "bound-passed");
		assert.equal(record.agpCode, null);
		assert.ok(["delivered", "unknown", null].includes(record.deliveryReport));
		assert.equal(json.records.find((r) => r.event === "run").bound, 400);
		assert.deepEqual(record.repeat.slice(-2), ["--invocation", only(received(json), "request").invocation]);
	});

	test("a command of several calls that changes nothing, given --invocation: its first call under that identity, none marked a repeat, its not-delivered ending saying earlierAttemptsUncertain false", async () => {
		const id = "1791540000000-0000000000000abc";
		const answered = await run(["find", "--tag", "k:v", "--invocation", id, "--json"]);
		assert.equal(answered.status, 0, answered.stderr);
		const pages = received(answered);
		assert.equal(pages.length, 2);
		assert.equal(pages[0].invocation, id);
		assert.notEqual(pages[1].invocation, id);
		assert.equal(answered.records.find((r) => r.event === "run").repeat, false);
		const lost = await run(["find", "--host", "host-z", "--invocation", id, "--json"]);
		assert.equal(lost.status, 3);
		assert.equal(JSON.parse(lost.stdout).earlierAttemptsUncertain, false);
		const marked = await run(["publish", "--name", "a", "--summary", "s", "--host", "host-z", "--invocation", id, "--json"]);
		assert.equal(JSON.parse(marked.stdout).earlierAttemptsUncertain, true, "a repeat of a command that changes something is marked");
	});
});

/**
 * Runs a command whose operation stays silent, with --json and without, and runs each printed repeat - the
 * JSON array as arguments, the plain line through /bin/sh - in a changed environment with the secret
 * supplied again, comparing what the operation receives and what is printed.
 */
async function repeats(args, operation, changes) {
	const scenario = { operations: { [operation]: { mode: "silent" } } };
	const env = { ...ENV, FIX_TOKEN: "s3cret", FIX_SERVICE: "other" };
	const changed = { FIX_HOST: "host-b", FIX_IDENTITY: "bob", FIX_SERVICE: "store", FIX_TIMEOUT: "1h", FIX_TOKEN: "s3cret" };
	const json = await run([...args, "--json"], { env, scenario });
	const plain = await run(args, { env, scenario });
	const record = JSON.parse(json.stdout);
	const line = plain.stdout.split("\n").find((l) => l.startsWith("repeat: ")).slice(8);
	assert.deepEqual((await shellWords(line)).slice(0, 1), [NAME]);
	const again = await run(record.repeat, { env: changed, scenario });
	const shell = await runShellLine(line, { dir, env: changed, scenario: { name: NAME, ...scenario } });
	for (const [first, repeat] of [[json, again], [plain, shell]]) {
		assert.deepEqual([first.status, repeat.status], [4, 4], repeat.stderr);
		const a = only(received(first), "first request");
		const b = only(received(repeat), "repeated request");
		assert.deepEqual([b.node, b.service, b.operation, b.principal, b.input], [a.node, a.service, a.operation, a.principal, a.input], "the same host, service and principal with the same input");
		assert.deepEqual([a.node, a.service, a.principal], ["host-a", "other", "alice"]);
		assert.equal(b.input.token, "s3cret");
		if (changes) assert.equal(b.invocation, a.invocation, "under the same identity");
		else assert.notEqual(b.invocation, a.invocation, "afresh");
		assert.equal(repeat.records.find((r) => r.event === "run").repeat, changes);
	}
	assert.equal(again.stdout.startsWith("{"), true, "the JSON repeat prints in the same form");
	assert.equal(shell.stdout.startsWith("ending: unknown\n"), true, "the plain repeat prints in the same form");
	if (changes) assert.deepEqual(JSON.parse(again.stdout).repeat, record.repeat, "a repeat that ends unknown repeats with one --invocation");
	return { record, again };
}

describe("OC7 - printed repeats, run in a changed environment through the same parser and path", { concurrency: 3 }, () => {
	for (const verbose of [true, false]) {
		const sw = verbose ? ["--verbose"] : [];
		test(`a command that changes something, with its switch ${verbose ? "on" : "off"}`, async () => {
			const { record } = await repeats(["publish", "--name", "a", "--summary", "it's a 'test'", "--tag", "k:v", "--timeout", "400ms", ...sw], "create", true);
			assert.equal(record.repeat.includes("--verbose"), verbose);
		});
		test(`a command that changes nothing, with its switch ${verbose ? "on" : "off"}`, async () => {
			const { record } = await repeats(["read", "--name", "a", "--timeout", "400ms", ...sw], "read", false);
			assert.equal(record.repeat.includes("--verbose"), verbose);
			assert.ok(!record.repeat.includes("--invocation"));
		});
	}
});

describe("OC7 - interruptions through the real call layer, as real signals", { concurrency: 2 }, () => {
	test("before the send is admitted: not delivered with ABORTED, the operation never receiving the request", async () => {
		const command = begin(["publish", "--name", "a", "--summary", "s", "--json"], { scenario: { holdSend: true } });
		await command.waitFor("send-held");
		command.signal("SIGINT");
		const r = await command.ended;
		assert.deepEqual([r.status, r.signal, r.stderr], [3, null, ""]);
		const record = JSON.parse(r.stdout);
		assert.deepEqual(record, { ending: "not-delivered", operation: "create", invocation: record.invocation, agpCode: "ABORTED", proxyCode: null, earlierAttemptsUncertain: false });
		assert.ok(r.records.some((x) => x.event === "released"), "the queue was released and drained before the command reported");
		assert.deepEqual(received(r), [], "the operation never received the request");
	});

	test("after admission, and a second time: the call layer's ending, unchanged", async () => {
		const command = begin(["read", "--name", "a", "--json"], { scenario: { operations: { read: { mode: "delayed", ms: 2000 } } } });
		await command.waitFor("received");
		command.signal("SIGINT");
		await sleep(300);
		command.signal("SIGTERM");
		const r = await command.ended;
		assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
		const got = only(received(r), "request");
		assert.deepEqual(JSON.parse(r.stdout), { ending: "answered", operation: "read", invocation: got.invocation, answer: { node: "host-a", service: "store", operation: "read", input: got.input } });
	});

	test("after the ending: the call layer's ending, unchanged", async () => {
		const r = await run(["read", "--name", "a", "--json"], { scenario: { selfSignal: "SIGINT" } });
		assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
		assert.equal(JSON.parse(r.stdout).answer.operation, "read");
	});
});

describe("OC7 - reading and preparing on the real path (E19)", { concurrency: 3 }, () => {
	test("a flag overrides its variable and a variable its default: the operation is reached at the service each gives", async () => {
		const flag = await run(["read", "--name", "a", "--service", "other", "--json"], { env: { ...ENV, FIX_SERVICE: "store" } });
		const variable = await run(["read", "--name", "a", "--json"], { env: { ...ENV, FIX_SERVICE: "other", FIX_HOST: "host-b" } });
		const defaulted = await run(["read", "--name", "a", "--json"]);
		assert.deepEqual([flag, variable, defaulted].map((r) => r.status), [0, 0, 0]);
		assert.deepEqual([flag, variable, defaulted].map((r) => { const g = only(received(r), "request"); return [g.node, g.service]; }), [["host-a", "other"], ["host-b", "other"], ["host-a", "store"]]);
	});

	test("a usage error, a group's included, exits 1 with nothing prepared or invoked", async () => {
		for (const args of [["read"], ["read", "--name", "a", "--id", "0123abcd"], ["publish", "--name", "a"], ["read", "--name", "a", "--timeout", "0ms", "--json"]]) {
			const r = await run(args);
			assert.deepEqual([r.status, r.stdout], [1, ""]);
			assert.match(r.stderr, /^usage: [^\n]+\n$/);
			assert.deepEqual(r.records, [], "neither prepare, run nor the operation was reached");
		}
	});

	test("a client that fails to prepare within its time ends the command not delivered, with nothing invoked", async () => {
		const r = await run(["publish", "--name", "a", "--summary", "s", "--connect-timeout", "1ms", "--json"]);
		assert.deepEqual([r.status, r.stderr], [3, ""]);
		const record = JSON.parse(r.stdout);
		assert.deepEqual(record, { ending: "not-delivered", operation: "create", invocation: record.invocation, agpCode: null, proxyCode: null, earlierAttemptsUncertain: false });
		assert.ok(r.records.some((x) => x.event === "prepare"));
		assert.ok(!r.records.some((x) => x.event === "run"));
		assert.deepEqual(received(r), []);
	});
});
