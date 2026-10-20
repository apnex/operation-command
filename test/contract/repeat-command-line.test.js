// repeat-command-line - OC5 (E19): every unknown ending carries `repeat`, the arguments after the program's
// name, and the plain form prints it as one command line of single-quoted shell words. Each printed repeat
// is run through the real parser - the JSON array as the fixture command's arguments, the plain line
// through /bin/sh - in a changed environment, and the settings and flags it reads are compared with the
// first run's, in both forms.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BASE_ENV, plainFacts, programDirectory, runFixture, runShellLine, shellWords } from "../support/run-command.js";
import { ending as partsEnding, jsonOutput, partsProgram, runParts } from "../support/parts-program.js";

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

describe("OC5 - the repeat of a parts command, from what resume gives (D4-E8)", () => {
	const UNKNOWN_PART = partsEnding({ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" });
	const SETTINGS_WRITTEN = ["--host", "hub-a", "--timeout", "10s", "--connect-timeout", "5s"];

	/** A parts program whose run records the flags it reads, passes on one part and ends unknown; resume as given. */
	function program(resume, { calls } = {}) {
		const reads = [];
		const counted = calls ?? { n: 0 };
		const wrapped = resume === undefined ? undefined : (lastPart, flags) => { counted.n++; return resume(lastPart, flags); };
		const run = async ({ onPart, flags, command }) => {
			reads.push({ command, flags });
			onPart({ through: 7 });
			return partsEnding({ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" }, command);
		};
		return { program: partsProgram({ run, ...(wrapped ? { resume: wrapped } : {}) }), reads, calls: counted };
	}

	/** Runs args in both forms; gives the JSON record, the plain repeat line, and what each repeat, run through the parser, reads. */
	async function repeated(made, args) {
		const json = await runParts(made.program, [...args, "--json"]);
		const plain = await runParts(made.program, args);
		assert.equal(json.status, 4, json.io.err.join(""));
		const record = jsonOutput(json.io.stdoutText).ending;
		const line = plain.io.stdoutText.split("\n").find((l) => l.startsWith("repeat: ")).slice("repeat: ".length);
		const words = await shellWords(line);
		assert.equal(words[0], "pt");
		const before = made.reads.length;
		await runParts(made.program, record.repeat);
		await runParts(made.program, words.slice(1));
		return { record, plain, words, firstFlags: made.reads[0].flags, again: made.reads.slice(before).map((r) => r.flags), diagnostics: [...json.io.diagnostics, ...plain.io.diagnostics] };
	}

	test("D4-E8: resume replaces a flag's value and a repeating flag's values in place of the first given, adds a flag not given in declared order, turns a switch off and leaves a flag out; the exact repeat array and its quoted line, each run through the real parser", async () => {
		const made = program(() => ({ since: "7", tag: ["x"], max: "3", quiet: false, for: null }));
		const args = ["follow", "--tag", "a", "--since", "0", "--tag", "b", "--quiet", "--for", "5s"];
		const { record, words, again, diagnostics } = await repeated(made, args);
		assert.deepEqual(record.repeat, ["follow", ...SETTINGS_WRITTEN, "--json", "--tag", "x", "--since", "7", "--max", "3"]);
		assert.deepEqual(words.slice(1), ["follow", ...SETTINGS_WRITTEN, "--tag", "x", "--since", "7", "--max", "3"]);
		assert.deepEqual(record.resume, { since: "7", tag: ["x"], max: "3", quiet: false, for: null });
		const expected = { host: "hub-a", token: "public", timeout: 10000, "connect-timeout": 5000, since: 7, tag: ["x"], max: 3, quiet: false };
		for (const flags of again) assert.deepEqual({ ...flags }, expected);
		assert.deepEqual(diagnostics, []);
	});

	test("D4-E8: a resume that turns a switch on, and one that names nothing, continue as it says", async () => {
		const on = await repeated(program(() => ({ quiet: true })), ["follow", "--since", "2"]);
		assert.deepEqual(on.record.repeat, ["follow", ...SETTINGS_WRITTEN, "--json", "--since", "2", "--quiet"]);
		assert.ok(on.again.every((f) => f.quiet === true));
		const none = await repeated(program(() => ({})), ["follow", "--since", "2", "--tag", "t"]);
		assert.deepEqual(none.record.repeat, ["follow", ...SETTINGS_WRITTEN, "--json", "--since", "2", "--tag", "t"]);
		assert.deepEqual(none.record.resume, {});
	});

	const FALLBACKS = {
		throws: { args: ["follow", "--since", "0"], resume: () => { throw new Error("resume broke"); }, why: /resume threw .*resume broke/ },
		"returns a promise": { args: ["follow", "--since", "0"], resume: () => Promise.resolve({ since: "1" }), why: /resume returned a promise/ },
		"returns a rejecting promise": { args: ["follow", "--since", "0"], resume: () => Promise.reject(new Error("resume rejected")), why: /resume returned a promise/ },
		"returns a list": { args: ["follow", "--since", "0"], resume: () => ["--since", "1"], why: /not an object of the command's own flags/ },
		"returns an object with a getter": { args: ["follow", "--since", "0"], resume: () => ({ get since() { throw new Error("read"); } }), why: /not an object of the command's own flags/ },
		"names a setting": { args: ["follow", "--since", "0"], resume: () => ({ host: "hub-b" }), why: /resume named "host", which is not one of the command follow's own flags/ },
		"names an unknown flag": { args: ["follow", "--since", "0"], resume: () => ({ nope: "1" }), why: /resume named "nope"/ },
		"names a flag written with --": { args: ["follow", "--since", "0"], resume: () => ({ "--since": "1" }), why: /resume named "--since"/ },
		"gives a value its type refuses": { args: ["follow", "--since", "0"], resume: () => ({ since: "seven" }), why: /resume gave flags the command does not read: the value "seven" of --since/ },
		"gives a text to a switch": { args: ["follow", "--since", "0"], resume: () => ({ quiet: "yes" }), why: /resume gave --quiet "yes", which is not true, false or null/ },
		"gives a flag that may not repeat two values": { args: ["follow", "--since", "0"], resume: () => ({ since: ["1", "2"] }), why: /resume gave --since \["1", "2"\], which is not a text or null/ },
		"leaves out a required flag": { args: ["follow", "--since", "0"], resume: () => ({ since: null }), why: /the flag --since is required/ },
		"breaks an exclusion": { args: ["watch", "--a", "1", "--x", "1", "--z", "1"], resume: () => ({ b: "2" }), why: /the flags --a and --b exclude each other/ },
		"breaks a requirement": { args: ["watch", "--x", "1", "--z", "1"], resume: () => ({ c: true }), why: /the flag --c requires --d/ },
		"leaves an exactly-one group with two": { args: ["watch", "--x", "1", "--z", "1"], resume: () => ({ y: "2" }), why: /needs exactly one of --x, --y, and was given 2/ },
		"leaves an at-least-one group with none": { args: ["watch", "--x", "1", "--z", "1"], resume: () => ({ z: null }), why: /needs at least one of --z, --w, and was given none/ },
	};
	for (const [name, spec] of Object.entries(FALLBACKS)) {
		test(`D4-E8: a resume that ${name} gives the flags as given, resume null and one diagnostic line`, async () => {
			const made = program(spec.resume);
			const json = await runParts(made.program, [...spec.args, "--json"]);
			assert.equal(json.status, 4);
			const record = jsonOutput(json.io.stdoutText).ending;
			assert.equal(record.resume, null);
			assert.deepEqual(record.repeat, [spec.args[0], ...SETTINGS_WRITTEN, "--json", ...spec.args.slice(1)]);
			assert.equal(json.io.diagnostics.length, 1, json.io.err.join(""));
			assert.match(json.io.diagnostics[0], spec.why);
			assert.match(json.io.diagnostics[0], /, so the repeat uses the flags as given$/);
		});
	}

	test("D4-E8: resume is called exactly once for an ending, its result in both the repeat and the ending's resume", async () => {
		const calls = { n: 0 };
		const made = program((lastPart) => ({ since: String(lastPart.through) }), { calls });
		const { status, io } = await runParts(made.program, ["follow", "--since", "0", "--json"]);
		assert.equal(status, 4);
		assert.equal(calls.n, 1);
		const record = jsonOutput(io.stdoutText).ending;
		assert.deepEqual(record.resume, { since: "7" });
		assert.deepEqual(record.repeat.slice(-2), ["--since", "7"]);
	});

	test("D4-E8: resume is given the last part and the frozen flags as read - an integer, a duration, a repeating flag, a flag not given absent and a switch off - and, for an ending whose client could not get ready, null", async () => {
		const given = [];
		const resume = (lastPart, flags) => { given.push({ lastPart, flags: { ...flags }, frozen: Object.isFrozen(flags) }); return {}; };
		const expected = { host: "hub-a", token: "public", timeout: 10000, "connect-timeout": 5000, since: 4, tag: ["a", "b"], for: 5000, quiet: false };
		const ran = partsProgram({ resume, run: async ({ onPart }) => { onPart({ through: 9 }); return UNKNOWN_PART; } });
		await runParts(ran, ["follow", "--since", "4", "--tag", "a", "--tag", "b", "--for", "5s"]);
		const unready = partsProgram({ resume, run: async () => UNKNOWN_PART, prepare: () => ({ ending: "not-delivered", agpCode: "TIMEOUT", proxyCode: null }) });
		const { status } = await runParts(unready, ["follow", "--since", "4", "--tag", "a", "--tag", "b", "--for", "5s"]);
		assert.equal(status, 3);
		assert.deepEqual(given, [{ lastPart: { through: 9 }, flags: expected, frozen: true }, { lastPart: null, flags: expected, frozen: true }]);
	});
});
