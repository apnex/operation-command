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

	test("answers and refusal details holding a member named __proto__, its value an object or a scalar, nested too: each record printed whole, as the call layer's ending holds it, in both forms", async () => {
		const payloads = [
			JSON.parse('{"__proto__":{"kept":true},"nested":{"__proto__":"text","list":[{"__proto__":{"deeper":1}}]},"safe":1}'),
			JSON.parse('{"__proto__":"text","nested":{"__proto__":{"kept":[1,2]}},"list":[{"__proto__":7}]}'),
		];
		for (const payload of payloads) {
			for (const [mode, field, status] of [["answer", "answer", 0], ["refuse", "refusal", 2]]) {
				const scenario = { payload, operations: { read: { mode } } };
				const json = await run(["read", "--name", "a", "--json"], { scenario });
				const plain = await run(["read", "--name", "a"], { scenario });
				for (const r of [json, plain]) {
					assert.deepEqual([r.status, r.signal, r.stderr], [status, null, ""], `${mode} ${r === json ? "--json" : "plain"}`);
					// The call layer's ending, as operation-call gave it over AGP, holds the member at every depth.
					const given = only(r.records.filter((x) => x.event === "call-ending"), "call-ending").ending;
					assert.deepEqual(field === "answer" ? given.answer : given.refusal.details, payload);
					assert.ok(Object.hasOwn(field === "answer" ? given.answer : given.refusal.details, "__proto__"));
					const expected = { ending: given.ending, operation: "read", invocation: given.invocation, [field]: given[field] };
					if (r === json) {
						assert.deepEqual(JSON.parse(r.stdout), expected);
						assert.equal(r.stdout, `${JSON.stringify(expected)}\n`);
					} else assert.equal(r.stdout, `ending: ${given.ending}\noperation: read\ninvocation: ${given.invocation}\n${field}: ${JSON.stringify(given[field])}\n`);
				}
			}
		}
	});

	test("real answers and refusals returned by run inside an ending with a custom prototype or with a non-enumerable ending: no plain data, so unknown with run-failed, its repeat and one diagnostic line in both forms, the operation having received its request", async () => {
		for (const envelope of ["custom-prototype", "ending-not-enumerable"]) {
			for (const mode of ["answer", "refuse"]) {
				const scenario = { envelope, operations: { read: { mode } } };
				const json = await run(["read", "--name", "a", "--json"], { scenario });
				const plain = await run(["read", "--name", "a"], { scenario });
				for (const r of [json, plain]) {
					const what = `${envelope} ${mode} ${r === json ? "--json" : "plain"}`;
					assert.deepEqual([r.status, r.signal], [4, null], what);
					assert.match(r.stderr, /^diagnostic: run returned [^\n]*, not an ending the caller interface gives, read as plain data\n$/, what);
					// The call layer's ending, as operation-call gave it over AGP, before run wrapped it: the operation was invoked.
					const given = only(r.records.filter((x) => x.event === "call-ending"), "call-ending").ending;
					assert.equal(given.ending, mode === "answer" ? "answered" : "refused");
					assert.equal(given.invocation, only(received(r), "request").invocation);
				}
				const record = JSON.parse(json.stdout);
				const invocation = only(received(json), "request").invocation;
				assert.equal(json.stdout, `${JSON.stringify({ ending: "unknown", operation: "read", invocation, reason: "run-failed", agpCode: null, deliveryReport: null, repeat: record.repeat })}\n`);
				// read changes nothing, so its repeat is a fresh run, with no identity.
				assert.deepEqual([record.repeat[0], record.repeat.includes("--invocation"), record.repeat.includes("--json")], ["read", false, true]);
				const facts = plainFacts(plain.stdout);
				assert.deepEqual([facts.ending, facts.operation, facts.invocation, facts.reason, facts.agpCode, facts.deliveryReport], ["unknown", "read", only(received(plain), "request").invocation, "run-failed", "null", "null"]);
				assert.deepEqual((await shellWords(facts.repeat)).slice(0, 2), [NAME, "read"]);
			}
		}
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

	test("after the ending, and during its printing: the call layer's ending, unchanged, each signal received before the process exits", async () => {
		for (const [args, scenario, signal] of [
			[["read", "--name", "a", "--json"], { selfSignal: "SIGINT", holdWrite: { until: ["SIGINT"] } }, "SIGINT"],
			[["read", "--name", "a"], { holdWrite: { until: ["SIGTERM"], duringWrite: "SIGTERM" } }, "SIGTERM"],
		]) {
			const r = await run(args, { scenario });
			assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
			const got = only(received(r), "request");
			const answer = { node: "host-a", service: "store", operation: "read", input: got.input };
			if (args.includes("--json")) assert.deepEqual(JSON.parse(r.stdout), { ending: "answered", operation: "read", invocation: got.invocation, answer });
			else assert.equal(r.stdout, `ending: answered\noperation: read\ninvocation: ${got.invocation}\nanswer: ${JSON.stringify(answer)}\n`);
			const receipt = only(r.records.filter((x) => x.event === "signal-received"), "receipt");
			assert.deepEqual([receipt.signal, receipt.listeners], [signal, 2], "received with the process adapter's handler among its listeners");
			assert.ok(r.records.findIndex((x) => x.event === "signal-received") < r.records.findIndex((x) => x.event === "write-released"), "received before the ending was released to standard output");
			if (scenario.holdWrite.duringWrite) assert.ok(r.records.findIndex((x) => x.event === "write-held") < r.records.findIndex((x) => x.event === "signal-received"), "received while the ending was being written");
		}
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

	test("each kind of usage error, groups with none and too many included, exits 1 with one line on standard error and nothing on standard output, the kinds alternating with --json and without, nothing prepared or invoked", async () => {
		const cases = [
			[[], /^usage: no command was given; the commands are publish, read, find, label, watch\n$/],
			[["unpublish"], /^usage: unknown command "unpublish"/],
			[["read", "--name", "a", "--colour", "red"], /^usage: unknown flag "--colour" for the command read\n$/],
			[["read", "a"], /^usage: unexpected argument "a" to the command read/],
			[["read", "--name"], /^usage: the flag --name has no value\n$/],
			[["read", "--name", "a", "--verbose=yes"], /^usage: the switch --verbose takes no value, and was given "yes"\n$/],
			[["read", "--name", "a", "--json=yes"], /^usage: the switch --json takes no value, and was given "yes"\n$/],
			[["read", "--name", "a", "--name", "b"], /^usage: the flag --name was given twice and may not repeat\n$/],
			[["read", "--name", "a"], /^usage: the flag --identity, or its variable FIX_IDENTITY, is required\n$/, { FIX_HOST: "host-a", FIX_IDENTITY: "" }],
			[["publish", "--name", "a"], /^usage: the flag --summary is required by the command publish\n$/],
			[["read", "--id", "0123abcdx"], /^usage: the value "0123abcdx" of --id does not match the pattern/],
			[["read", "--name", "a", "--timeout", "10"], /^usage: the value "10" of --timeout is not a duration/],
			[["read", "--name", "a"], /^usage: the value "1y" of the variable FIX_TIMEOUT, standing in for --timeout, is not a duration/, { ...ENV, FIX_TIMEOUT: "1y" }],
			[["read", "--name", "a", "--timeout", "0ms"], /^usage: the value "0ms" of --timeout is not a duration from 1ms to 24h\n$/],
			[["label", "--name", "a", "--tag", "k:v", "--priority", "two"], /^usage: the value "two" of --priority is not a whole number\n$/],
			[["label", "--name", "a", "--tag", "k:v", "--priority", "6"], /^usage: the value "6" of --priority is not a whole number from 1 to 5\n$/],
			[["label", "--name", "a", "--tag", "k:v", "--link", "http://x.test/"], /^usage: the value "http:\/\/x.test\/" of --link is not a URL of the scheme https\n$/],
			[["label", "--name", "a", "--tag", "k:v", "--clear"], /^usage: the flags --tag and --clear exclude each other\n$/],
			[["label", "--name", "a", "--clear", "--force"], /^usage: the flag --force requires --priority, which was not given\n$/],
			[["label", "--name", "a"], /^usage: the command label needs at least one of --tag, --clear, and was given none\n$/],
			[["read"], /^usage: the command read needs exactly one of --name, --id, and was given none\n$/],
			[["read", "--name", "a", "--id", "0123abcd"], /^usage: the command read needs exactly one of --name, --id, and was given 2\n$/],
			[["publish", "--name", "a", "--summary", "s", "--invocation", "123"], /^usage: the value "123" of --invocation is not an invocation identity/],
		];
		// The kinds alternate between the two forms, so each form meets usage errors of every sort on the real path.
		const runs = cases.map(([args, says, env = ENV], i) => ({ args: i % 2 === 1 ? [args[0], "--json", ...args.slice(1)] : args, says, env }));
		// Four commands at a time, each its own process, so the matrix does not wait on each start in turn.
		const pending = [...runs];
		await Promise.all(Array.from({ length: 4 }, async () => {
			for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
				const r = await run(next.args, { env: next.env });
				assert.deepEqual([r.status, r.signal, r.stdout], [1, null, ""], `${next.args.join(" ")}: ${r.stderr}`);
				assert.match(r.stderr, next.says);
				assert.match(r.stderr, /^usage: [^\n]+\n$/, "one line on standard error");
				assert.deepEqual(r.records, [], "neither prepare, run nor the operation was reached");
			}
		}));
		// Each group with one, and the at-least-one group with two, its relations kept, reaches the operation on the real path.
		for (const args of [["label", "--name", "a", "--clear"], ["label", "--name", "a", "--tag", "k:v", "--tag", "a:b", "--priority", "2", "--force", "--link", "https://x.test/"], ["read", "--id", "0123abcd"]]) {
			const r = await run([...args, "--json"]);
			assert.equal(r.status, 0, r.stderr);
			assert.equal(received(r).length, 1);
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

describe("OC7 - a parts command through the real call layer (D4-E8)", { concurrency: 2 }, () => {
	test("D4-E8: a parts command prints a real host's parts before its ending, in both forms", async () => {
		const json = await run(["watch", "--count", "3", "--json"]);
		assert.deepEqual([json.status, json.stderr], [0, ""]);
		const lines = json.stdout.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
		assert.deepEqual(lines.slice(0, 3), [1, 2, 3].map((n) => ({ part: n, answer: { n, service: "store" } })));
		const invocation = only(received(json), "request").invocation;
		assert.deepEqual(lines[3], { ending: "answered", operation: "stream", invocation, answer: { parts: 3, stopped: false }, partsTaken: 3, lastPart: { n: 3, service: "store" } });
		const plain = await run(["watch", "--count", "2"]);
		assert.equal(plain.status, 0);
		assert.match(plain.stdout, /^part 1 from store\npart 2 from store\nending: answered\n/);
		assert.match(plain.stdout, /\npartsTaken: 2\nlastPart: \{"n":2,"service":"store"\}\n$/);
	});

	test("D4-E8: interrupted after its first part, a parts command cancels the call, the host's signal fires, and the ending the call layer gives is printed with its status", async () => {
		const command = begin(["watch", "--count", "1", "--until-cancel", "--json"]);
		await command.waitFor("host-waiting");
		command.signal("SIGINT");
		const result = await command.ended;
		assert.deepEqual([result.status, result.signal], [0, null], result.stderr);
		assert.ok(result.records.some((r) => r.event === "host-signal"), "the cancel reached the host and fired its signal");
		const lines = result.stdout.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
		assert.deepEqual(lines[0], { part: 1, answer: { n: 1, service: "store" } });
		assert.deepEqual([lines[1].ending, lines[1].answer, lines[1].partsTaken, lines[1].lastPart], ["answered", { parts: 1, stopped: true }, 1, { n: 1, service: "store" }]);
		assert.equal(result.stderr, "");
	});
});
