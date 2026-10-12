// repeat-command-line - OC5 (E19): every unknown ending carries `repeat`, the arguments after the program's
// name, and the plain form prints it as one command line of single-quoted shell words. Each printed repeat
// is run through the real parser - the JSON array as the fixture command's arguments, the plain line
// through /bin/sh - in a changed environment, and the settings and flags it reads are compared with the
// first run's, in both forms.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BASE_ENV, plainFacts, programDirectory, runFixture, runShellLine, shellWords } from "../support/run-command.js";

const UNKNOWN = { ending: { ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" } };
const NAME = "fix ture's";
const dir = programDirectory(NAME);
const scenario = { name: NAME, prepare: { settle: "ready" }, run: UNKNOWN };
const runOf = (result) => result.records.find((r) => r.event === "run");
const repeatLineOf = (stdout) => {
	const line = stdout.split("\n").find((l) => l.startsWith("repeat: "));
	assert.ok(line, "the plain form prints a repeat line");
	return line.slice("repeat: ".length);
};

/**
 * Runs a command that ends unknown with --json and without, then runs each printed repeat in `changed`
 * (an environment in which the variables were changed or unset), and compares what each repeat read with
 * its first run. Gives both first runs and both repeats.
 */
async function roundTrip(args, { env = BASE_ENV, changed = { FIX_HOST: "host-z", FIX_IDENTITY: "zed", FIX_SERVICE: "other", FIX_TIMEOUT: "1h" }, changes }) {
	const json = await runFixture([...args, "--json"], { env, scenario });
	const plain = await runFixture(args, { env, scenario });
	assert.equal(json.status, 4, json.stderr);
	assert.equal(plain.status, 4, plain.stderr);
	const record = JSON.parse(json.stdout);
	const array = record.repeat;
	assert.ok(Array.isArray(array) && array.every((a) => typeof a === "string"), "repeat is an array of strings");
	assert.equal(array[0], args[0], "it begins with the command's name");
	const invocations = array.filter((a) => a === "--invocation");
	if (changes) assert.deepEqual([invocations.length, array.at(-2), array.at(-1)], [1, "--invocation", record.invocation], "one --invocation, the last two elements");
	else assert.equal(invocations.length, 0, "a command that changes nothing writes no identity");

	// The plain line, split as a POSIX shell splits it, names exactly the program with the arguments unchanged.
	const line = repeatLineOf(plain.stdout);
	const words = await shellWords(line);
	const plainInvocation = plainFacts(plain.stdout).invocation;
	const expected = array.filter((a) => a !== "--json").map((a) => a === record.invocation ? plainInvocation : a);
	assert.deepEqual(words, [NAME, ...expected]);
	assert.equal(line, words.map((w) => `'${w.replaceAll("'", "'\\''")}'`).join(" "), "each word, the program's name included, in single quotes");

	// Each repeat, through the real parser, in the changed environment, reads what its first run read.
	const again = await runFixture(array, { env: changed, scenario });
	const shell = await runShellLine(line, { dir, env: changed, scenario });
	for (const [first, repeat] of [[json, again], [plain, shell]]) {
		assert.equal(repeat.status, 4, repeat.stderr);
		assert.deepEqual(runOf(repeat).flags, runOf(first).flags, "the repeat reads the settings and flags of its first run");
		if (changes) assert.deepEqual([runOf(repeat).invocation, runOf(repeat).repeat], [runOf(first).invocation, true], "under its invocation identity, marked a repeat");
		else {
			assert.notEqual(runOf(repeat).invocation, runOf(first).invocation, "a fresh run, under a new identity");
			assert.equal(runOf(repeat).repeat, false);
		}
	}
	// --json is operation-command's own, so run reads the same flags in either form, --json among none of them.
	assert.deepEqual(runOf(json).flags, runOf(plain).flags);
	assert.equal("json" in runOf(json).flags, false);
	return { json, plain, again, shell, array, record };
}

describe("OC5 - repeating an unknown ending", { concurrency: 3 }, () => {
	test("a program's name holding a space and a single quote, and an argument holding spaces and quotes", async () => {
		const { array } = await roundTrip(["publish", "--name", "a", "--summary", "it's a \"quoted\" 'summary' $HOME `x` \\n"], { changes: true });
		assert.ok(array.includes("it's a \"quoted\" 'summary' $HOME `x` \\n"));
	});

	test("settings taken from flags, from variables and from defaults, the variables then changed or unset, in the declaration's order", async () => {
		const env = { ...BASE_ENV, FIX_SERVICE: "from-var", FIX_RETRIES: "7", FIX_URL: "wss://example.test:9/x" };
		const { array, record } = await roundTrip(["publish", "--summary", "s", "--name", "a", "--host", "from-flag"], { env, changes: true });
		assert.deepEqual(array, ["publish", "--host", "from-flag", "--service", "from-var", "--url", "wss://example.test:9/x", "--identity", "alice", "--timeout", "10s", "--connect-timeout", "5s", "--retries", "7", "--json", "--summary", "s", "--name", "a", "--invocation", record.invocation]);
		await roundTrip(["read", "--name", "a"], { env, changed: { FIX_HOST: "elsewhere", FIX_IDENTITY: "bob" }, changes: false });
	});

	test("a duration setting is written as it was written", async () => {
		const { array } = await roundTrip(["read", "--name", "a", "--timeout", "1500ms"], { env: { ...BASE_ENV, FIX_CONNECT_TIMEOUT: "2m" }, changes: false });
		assert.deepEqual(array.slice(array.indexOf("--timeout"), array.indexOf("--timeout") + 4), ["--timeout", "1500ms", "--connect-timeout", "2m"]);
	});

	test("a switch on is written as its flag alone, and a switch off is left out", async () => {
		const on = await roundTrip(["update", "--name", "a", "--no-tags", "--verbose"], { changes: true });
		assert.ok(on.array.includes("--verbose") && on.array.includes("--no-tags"));
		// --json, when given, follows the settings and comes before the command's own flags.
		assert.equal(on.array[on.array.indexOf("--verbose") + 1], "--json");
		assert.equal(on.array[on.array.indexOf("--json") + 1], "--name");
		const off = await roundTrip(["update", "--name", "a", "--summary", "s"], { changes: true });
		assert.ok(!off.array.includes("--verbose") && !off.array.includes("--no-tags"));
		assert.equal(runOf(off.again).flags.verbose, false);
	});

	test("a repeating setting and a repeating flag are written once for each value, in order", async () => {
		const { array } = await roundTrip(["publish", "--name", "a", "--summary", "s", "--tag", "b:2", "--label", "one two", "--tag=a:1", "--label", "it's"], { changes: true });
		assert.deepEqual(array.slice(array.indexOf("--label"), array.indexOf("--label") + 4), ["--label", "one two", "--label", "it's"]);
		assert.deepEqual(array.slice(array.indexOf("--name"), -2), ["--name", "a", "--summary", "s", "--tag", "b:2", "--tag", "a:1"]);
	});

	test("a setting with no value is left out, and stays without one when the repeat runs", async () => {
		const { array, again } = await roundTrip(["read", "--name", "a"], { changes: false });
		assert.ok(!array.includes("--note") && !array.includes("--label"));
		assert.equal("note" in runOf(again).flags, false);
	});

	test("a secret setting is never written, and supplied again, by its flag or its variable, the repeat reads what the first run read", async () => {
		const json = await runFixture(["publish", "--name", "a", "--summary", "s", "--token", "s3cret", "--json"], { env: BASE_ENV, scenario });
		const array = JSON.parse(json.stdout).repeat;
		assert.ok(!array.includes("--token") && !array.includes("s3cret"));
		for (const [args, env] of [[array, { FIX_HOST: "x", FIX_IDENTITY: "y", FIX_TOKEN: "s3cret" }], [[...array, "--token", "s3cret"], { FIX_HOST: "x", FIX_IDENTITY: "y" }]]) {
			const again = await runFixture(args, { env, scenario });
			assert.deepEqual(runOf(again).flags, runOf(json).flags);
		}
		const plain = await runFixture(["publish", "--name", "a", "--summary", "s", "--token", "s3cret"], { env: BASE_ENV, scenario });
		const line = repeatLineOf(plain.stdout);
		assert.ok(!line.includes("token") && !line.includes("s3cret"));
		const shell = await runShellLine(line, { dir, env: { FIX_TOKEN: "s3cret" }, scenario });
		assert.deepEqual(runOf(shell).flags, runOf(plain).flags);
	});

	test("an invocation given as --invocation <identity> and as --invocation=<identity> is never copied: the identity is only the last two elements", async () => {
		const id = "1791540000000-00000000000000ab";
		for (const form of [["--invocation", id], [`--invocation=${id}`]]) {
			const { array } = await roundTrip(["update", "--name", "a", ...form, "--summary", "s"], { changes: true });
			assert.deepEqual(array.slice(-2), ["--invocation", id]);
			assert.equal(array.filter((a) => a.includes(id)).length, 1);
			const unchanged = await roundTrip(["read", ...form, "--name", "a"], { changes: false });
			assert.ok(!unchanged.array.some((a) => a.includes("invocation") || a.includes(id)));
		}
	});

	test("a repeat that itself ends unknown gives a repeat with one --invocation, its identity unchanged", async () => {
		const { again, shell, record } = await roundTrip(["publish", "--name", "a", "--summary", "s"], { changes: true });
		const second = JSON.parse(again.stdout);
		assert.equal(second.invocation, record.invocation);
		assert.deepEqual(second.repeat, record.repeat);
		const third = await runFixture(second.repeat, { env: BASE_ENV, scenario });
		assert.deepEqual(JSON.parse(third.stdout).repeat, record.repeat);
		const line = repeatLineOf(shell.stdout);
		assert.equal((await shellWords(line)).filter((w) => w === "--invocation").length, 1);
	});

	test("a command whose own flags exclude and require others repeats keeping every relation its first run kept, settings from flags, variables and defaults included, in a changed environment", async () => {
		const env = { ...BASE_ENV, FIX_SERVICE: "from-var", FIX_RETRIES: "7" };
		const changed = { FIX_HOST: "host-z", FIX_IDENTITY: "zed", FIX_SERVICE: "other", FIX_RETRIES: "1", FIX_TIMEOUT: "1h", FIX_URL: "wss://elsewhere.test/x" };
		// --force requires --expect-revision, given; --tag excludes --no-tags, not given.
		const kept = await roundTrip(["update", "--name", "a", "--tag", "k:v", "--force", "--expect-revision", "3", "--verbose", "--timeout", "2s"], { env, changed, changes: true });
		assert.deepEqual(kept.array.slice(kept.array.indexOf("--json") + 1, -2), ["--name", "a", "--tag", "k:v", "--force", "--expect-revision", "3"]);
		for (const run of [kept.again, kept.shell]) assert.deepEqual([runOf(run).flags.force, runOf(run).flags["expect-revision"], runOf(run).flags.tag], [true, 3, ["k:v"]]);
		// --no-tags excludes --tag, and the switch --force is off: the repeat reads none of them given.
		const other = await roundTrip(["update", "--id", "0123abcd", "--no-tags"], { env, changed, changes: true });
		for (const run of [other.again, other.shell]) assert.deepEqual([runOf(run).flags["no-tags"], runOf(run).flags.force, "tag" in runOf(run).flags], [true, false, false]);
	});

	test("a command that changes nothing repeats as a fresh run", async () => {
		const { array } = await roundTrip(["find", "--tag", "k:v", "--limit", "5"], { changes: false });
		assert.deepEqual(array.slice(-5), ["--json", "--tag", "k:v", "--limit", "5"]);
	});
});
