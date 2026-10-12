// declared-command-dispatch - OC1 and OC2 (E19): a program declared as data, a declaration that breaks a
// rule refused by a thrown error naming the rule before any argument is read, and every way a command can
// break its declaration refused as a usage error - one line on standard error, status 1, nothing on standard
// output, nothing prepared and nothing invoked. Commands run as child processes of the fixture application.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declareProgram, DeclarationError } from "@apnex/operation-command";
import { fixtureDeclaration, SETTINGS } from "../support/fixture-program.js";
import { BASE_ENV, runFixture } from "../support/run-command.js";

const run = () => ({ ending: "answered", invocation: "x", attempt: "x", operation: "op", answer: null });
/** A declaration that keeps every rule, with one part replaced. */
const declaration = (change = {}) => ({
	name: "probe",
	settings: [
		{ flag: "--timeout", variable: "P_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" } },
		{ flag: "--wait", default: "5s", type: { kind: "duration", min: "0ms", max: "1h" } },
		{ flag: "--json", type: { kind: "switch" } },
	],
	commands: [{ name: "go", operation: "go", changes: false, run }],
	client: {},
	callBound: "--timeout",
	prepareTime: "--wait",
	...change,
});
const withSetting = (setting) => declaration({ settings: [...declaration().settings, setting] });
const withFlag = (flag, extra = {}) => declaration({ commands: [{ name: "go", operation: "go", changes: false, run, flags: [flag], ...extra }] });
const refused = (decl, rule) => assert.throws(() => declareProgram(decl), (error) => error instanceof DeclarationError && error.rule === rule && error.message.startsWith(`${rule}: `));

describe("OC1 - the declaration", () => {
	test("the fixture application's declaration, with every type, source, group, relation and a local command, is accepted", () => {
		const program = declareProgram(fixtureDeclaration({}));
		assert.equal(program.name, "fixture");
		assert.equal(typeof program.run, "function");
		assert.ok(declareProgram(declaration()));
	});

	test("a setting with a variable but neither a default nor required is refused, naming the rule", () => {
		refused(withSetting({ flag: "--hub", variable: "P_HUB", type: { kind: "string", pattern: "^.*$" } }), "setting-without-value");
		assert.ok(declareProgram(withSetting({ flag: "--hub", variable: "P_HUB", required: true, type: { kind: "string", pattern: "^.*$" } })));
		assert.ok(declareProgram(withSetting({ flag: "--hub", variable: "P_HUB", default: "x", type: { kind: "string", pattern: "^.*$" } })));
	});

	test("a switch with a variable, or with a default, is refused, naming the rule", () => {
		refused(withSetting({ flag: "--quiet", variable: "P_QUIET", type: { kind: "switch" } }), "switch-form");
		refused(withSetting({ flag: "--quiet", default: "on", type: { kind: "switch" } }), "switch-form");
		refused(withSetting({ flag: "--quiet", variable: "P_QUIET", default: "", type: { kind: "switch" } }), "switch-form");
		assert.ok(declareProgram(withSetting({ flag: "--quiet", type: { kind: "switch" } })));
	});

	test("a command's own flag with a variable, a default or a secret is refused", () => {
		refused(withFlag({ flag: "--name", variable: "P_NAME", type: { kind: "string", pattern: "^.*$" } }), "command-flag-form");
		refused(withFlag({ flag: "--name", default: "x", type: { kind: "string", pattern: "^.*$" } }), "command-flag-form");
		refused(withFlag({ flag: "--name", secret: true, type: { kind: "string", pattern: "^.*$" } }), "command-flag-form");
	});

	test("--invocation is operation-command's own, and no setting or flag of the application's", () => {
		refused(withSetting({ flag: "--invocation", type: { kind: "string", pattern: "^.*$" } }), "invocation-reserved");
		refused(withFlag({ flag: "--invocation", type: { kind: "string", pattern: "^.*$" } }), "invocation-reserved");
	});

	test("types and their valid values are checked: pattern, whole-number bounds, duration bounds, URL schemes, kind", () => {
		refused(withSetting({ flag: "--a", type: { kind: "string", pattern: "(" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "string" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "integer", min: 5, max: 1 } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "integer", min: 0, max: 1.5 } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1s", max: "10" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1h", max: "1m" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1S", max: "1m" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: [] } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws:"] } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "float" } }), "value-type");
		refused(withSetting({ flag: "--a" }), "value-type");
	});

	test("a default that is not a valid value, and a setting both required and defaulted, are refused", () => {
		refused(withSetting({ flag: "--n", variable: "P_N", default: "11", type: { kind: "integer", min: 0, max: 10 } }), "default-invalid");
		refused(withSetting({ flag: "--n", variable: "P_N", default: "10", required: true, type: { kind: "integer", min: 0, max: 10 } }), "required-with-default");
	});

	test("flags, variables and commands are well formed and named once", () => {
		refused(withSetting({ flag: "-a", type: { kind: "switch" } }), "flag-form");
		refused(withSetting({ flag: "--A", type: { kind: "switch" } }), "flag-form");
		refused(withSetting({ flag: "--json", type: { kind: "switch" } }), "flag-taken");
		refused(withFlag({ flag: "--json", type: { kind: "switch" } }), "flag-taken");
		refused(withSetting({ flag: "--b", variable: "P_TIMEOUT", default: "1", type: { kind: "integer", min: 0, max: 9 } }), "variable-taken");
		refused(withSetting({ flag: "--b", variable: "1BAD", default: "1", type: { kind: "integer", min: 0, max: 9 } }), "variable-form");
		refused(declaration({ commands: [{ name: "go", operation: "go", changes: false, run }, { name: "go", operation: "go", changes: true, run }] }), "command-taken");
		refused(declaration({ commands: [{ name: "Go", operation: "go", changes: false, run }] }), "command-form");
		refused(declaration({ commands: [{ name: "go", operation: "Go!", changes: false, run }] }), "operation-name");
		refused(declaration({ commands: [{ name: "go", operation: "go", run }] }), "command-form");
		refused(declaration({ commands: [{ name: "go", operation: "go", changes: false }] }), "command-form");
		refused(declaration({ commands: [] }), "program-form");
		refused(declaration({ name: "" }), "program-form");
	});

	test("a field the declaration does not have is refused rather than ignored", () => {
		refused(withSetting({ flag: "--a", type: { kind: "switch" }, secrete: true }), "unknown-field");
		refused(declaration({ commands: [{ name: "go", operation: "go", changes: false, run, chnages: true }] }), "unknown-field");
		refused({ ...declaration(), bound: "--timeout" }, "unknown-field");
	});

	test("relations and groups name flags of their own scope", () => {
		refused(withFlag({ flag: "--a", excludes: ["--b"], type: { kind: "switch" } }), "flag-relation");
		refused(withFlag({ flag: "--a", requires: ["--a"], type: { kind: "switch" } }), "flag-relation");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ exactlyOne: ["--a", "--json"] }] }), "group-form");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ oneOf: ["--a"] }] }), "group-form");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ atLeastOne: [] }] }), "group-form");
	});

	test("a program that invokes names a bound and a preparation setting, each a duration that always takes a value, the bound within 1 ms to 2147483647 ms, and declares the switch --json", () => {
		refused(declaration({ callBound: undefined }), "call-settings");
		refused(declaration({ prepareTime: "--nothing" }), "call-settings");
		refused(declaration({ callBound: "--json" }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", type: { kind: "duration", min: "1ms", max: "1h" } }, ...declaration().settings.slice(1)] }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", default: "1s", type: { kind: "duration", min: "0ms", max: "1h" } }, ...declaration().settings.slice(1)] }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", default: "1s", type: { kind: "duration", min: "1ms", max: "25d" } }, ...declaration().settings.slice(1)] }), "call-settings");
		refused(declaration({ settings: declaration().settings.slice(0, 2) }), "json-switch");
		const local = { name: "go", local: true, run: () => 0 };
		assert.ok(declareProgram({ name: "p", settings: [], commands: [local], client: {} }), "a program of local commands only needs neither");
	});

	test("a refused declaration is refused when given, before any argument is read or anything run", () => {
		let ran = 0;
		const decl = declaration({ commands: [{ name: "go", operation: "go", changes: false, run: () => { ran++; return run(); } }], settings: [...declaration().settings, { flag: "--x", variable: "P_X", type: { kind: "switch" } }] });
		refused(decl, "switch-form");
		assert.equal(ran, 0);
	});

	test("the fixture's settings are listed in the declaration's order, which a repeat keeps", () => {
		assert.deepEqual(SETTINGS.map((s) => s.flag), ["--host", "--service", "--url", "--identity", "--token", "--timeout", "--connect-timeout", "--retries", "--label", "--note", "--verbose", "--json"]);
	});
});

/** A scenario whose client prepares and whose run answers, so a test can see that neither was reached. */
const ANSWERING = { prepare: { settle: "ready" }, run: { ending: { ending: "answered", answer: { ok: true } } } };

/** Runs the fixture and asserts a usage error: status 1, one line on standard error, nothing on standard output, nothing prepared or invoked. */
async function usageError(args, { env = BASE_ENV, says } = {}) {
	for (const json of [false, true]) {
		const result = await runFixture(json ? [...args.slice(0, 1), "--json", ...args.slice(1)] : args, { env, scenario: ANSWERING });
		assert.equal(result.status, 1, `${args.join(" ")}: status 1, not ${result.status}; ${result.stderr}`);
		assert.equal(result.stdout, "", "nothing on standard output");
		assert.match(result.stderr, /^usage: [^\n]+\n$/, "one line on standard error, beginning usage:");
		if (says) assert.match(result.stderr, says);
		assert.deepEqual(result.records.filter((r) => ["prepare", "run", "call", "local"].includes(r.event)), [], "nothing prepared, nothing invoked");
	}
}

/** Runs the fixture to an answer and gives the flags run was given. */
async function flagsRead(args, env = BASE_ENV) {
	const result = await runFixture(args, { env, scenario: ANSWERING });
	assert.equal(result.status, 0, result.stderr);
	return result.records.find((r) => r.event === "run").flags;
}

describe("OC2 - reading a command: each kind of usage error", { concurrency: 4 }, () => {
	test("an unknown command, and no command at all", async () => {
		await usageError(["unpublish", "--name", "a"], { says: /unknown command "unpublish"/ });
		await usageError(["--name"], { says: /unknown command "--name"/ });
		const none = await runFixture([], { env: BASE_ENV, scenario: ANSWERING });
		assert.equal(none.status, 1);
		assert.equal(none.stdout, "");
		assert.match(none.stderr, /^usage: no command was given; the commands are publish, read, update, find, local-echo\n$/);
	});
	test("an unknown flag, and an argument that is no flag", async () => {
		await usageError(["read", "--name", "a", "--colour", "red"], { says: /unknown flag "--colour"/ });
		await usageError(["read", "--name", "a", "--draft"], { says: /unknown flag "--draft" for the command read/ });
		await usageError(["read", "a"], { says: /unexpected argument "a"/ });
	});
	test("a flag without its value", async () => {
		await usageError(["read", "--name"], { says: /the flag --name has no value/ });
		await usageError(["read", "--name", "a", "--host"], { says: /the flag --host has no value/ });
	});
	test("a switch given a value", async () => {
		await usageError(["read", "--name", "a", "--verbose=yes"], { says: /the switch --verbose takes no value/ });
		await usageError(["read", "--name", "a", "--verbose="], { says: /the switch --verbose takes no value/ });
	});
	test("a flag given twice that may not repeat, a setting's and a command's own, in either form", async () => {
		await usageError(["read", "--name", "a", "--name=b"], { says: /the flag --name was given twice and may not repeat/ });
		await usageError(["read", "--name", "a", "--service", "s", "--service", "s"], { says: /the flag --service was given twice/ });
		await usageError(["read", "--name", "a", "--verbose", "--verbose"], { says: /the flag --verbose was given twice/ });
	});
	test("a required flag missing: a setting with neither flag nor variable, and a command's own", async () => {
		await usageError(["read", "--name", "a"], { env: { FIX_HOST: "host-a" }, says: /the flag --identity, or its variable FIX_IDENTITY, is required/ });
		await usageError(["publish", "--name", "a"], { says: /the flag --summary is required by the command publish/ });
	});
	test("a value of the wrong type: text against its pattern, a whole number, a duration, a URL", async () => {
		await usageError(["read", "--name", "Not_A_Name"], { says: /does not match the pattern/ });
		await usageError(["read", "--name", "a", "--retries", "two"], { says: /"two" of --retries is not a whole number/ });
		await usageError(["read", "--name", "a", "--timeout", "10"], { says: /"10" of --timeout is not a duration/ });
		await usageError(["read", "--name", "a", "--timeout", "10S"], { says: /is not a duration/ });
		await usageError(["read", "--name", "a", "--timeout", "+10s"], { says: /is not a duration/ });
		await usageError(["read", "--name", "a", "--url", "not a url"], { says: /is not a URL/ });
	});
	test("a value outside its valid values: bounds of a whole number and a duration, a URL's scheme", async () => {
		await usageError(["read", "--name", "a", "--retries", "10"], { says: /is not a whole number from 0 to 9/ });
		await usageError(["read", "--name", "a", "--retries", "-1"], { says: /is not a whole number from 0 to 9/ });
		await usageError(["read", "--name", "a", "--timeout", "25h"], { says: /is not a duration from 1ms to 24h/ });
		await usageError(["read", "--name", "a", "--timeout", "0ms"], { says: /is not a duration from 1ms to 24h/ });
		await usageError(["read", "--name", "a", "--url", "http://host:1/"], { says: /is not a URL of the schemes ws, wss/ });
	});
	test("a variable's value of the wrong type is a usage error naming the variable", async () => {
		await usageError(["read", "--name", "a"], { env: { ...BASE_ENV, FIX_RETRIES: "many" }, says: /the variable FIX_RETRIES, standing in for --retries, is not a whole number/ });
		await usageError(["read", "--name", "a"], { env: { ...BASE_ENV, FIX_TIMEOUT: "1y" }, says: /FIX_TIMEOUT/ });
	});
	test("two flags that exclude each other", async () => {
		await usageError(["update", "--name", "a", "--tag", "k:v", "--no-tags"], { says: /the flags --tag and --no-tags exclude each other/ });
	});
	test("a flag missing that another requires", async () => {
		await usageError(["update", "--name", "a", "--summary", "s", "--force"], { says: /the flag --force requires --expect-revision/ });
		const given = await flagsRead(["update", "--name", "a", "--summary", "s", "--force", "--expect-revision", "2"]);
		assert.equal(given.force, true);
		assert.equal(given["expect-revision"], 2);
	});
	test("an --invocation that is not an invocation identity as EM11 writes it", async () => {
		await usageError(["publish", "--name", "a", "--summary", "s", "--invocation", "123"], { says: /--invocation is not an invocation identity/ });
		await usageError(["read", "--name", "a", "--invocation=1791540000000-3F9A0C1D2B4E5F60"], { says: /is not an invocation identity/ });
		await usageError(["read", "--name", "a", "--invocation"], { says: /--invocation has no value/ });
		await usageError(["local-echo", "--invocation", "1791540000000-3f9a0c1d2b4e5f60"], { says: /unknown flag "--invocation"/ });
	});
});

describe("OC2 - groups with none, one and two of their flags", { concurrency: 4 }, () => {
	test("exactly one of --name and --id: none and two are usage errors, one is read", async () => {
		await usageError(["read"], { says: /needs exactly one of --name, --id, and was given none/ });
		await usageError(["read", "--name", "a", "--id", "0123abcd"], { says: /needs exactly one of --name, --id, and was given 2/ });
		assert.equal((await flagsRead(["read", "--id", "0123abcd"])).id, "0123abcd");
		assert.equal((await flagsRead(["read", "--name", "a"])).name, "a");
	});
	test("at least one of the update flags: none is a usage error, one and two are read", async () => {
		await usageError(["update", "--name", "a"], { says: /needs at least one of --rename, --summary, --tag, --no-tags, and was given none/ });
		assert.equal((await flagsRead(["update", "--name", "a", "--no-tags"]))["no-tags"], true);
		const two = await flagsRead(["update", "--id", "0123abcd", "--rename", "b", "--summary", "s"]);
		assert.deepEqual([two.rename, two.summary], ["b", "s"]);
	});
});

describe("OC2 - where a setting's value comes from", { concurrency: 4 }, () => {
	test("a flag overrides its variable, and a variable its default", async () => {
		const env = { ...BASE_ENV, FIX_SERVICE: "from-variable", FIX_TIMEOUT: "2m" };
		const flagged = await flagsRead(["read", "--name", "a", "--service", "from-flag", "--timeout=1500ms"], env);
		assert.equal(flagged.service, "from-flag");
		assert.equal(flagged.timeout, 1500);
		const variable = await flagsRead(["read", "--name", "a"], env);
		assert.equal(variable.service, "from-variable");
		assert.equal(variable.timeout, 120000);
		const defaulted = await flagsRead(["read", "--name", "a"]);
		assert.equal(defaulted.service, "store");
		assert.equal(defaulted.timeout, 10000);
		assert.equal(defaulted.retries, 3);
	});
	test("a variable set to the empty string counts as unset: the default is taken, and a required setting is missing", async () => {
		assert.equal((await flagsRead(["read", "--name", "a"], { ...BASE_ENV, FIX_SERVICE: "" })).service, "store");
		await usageError(["read", "--name", "a"], { env: { ...BASE_ENV, FIX_HOST: "" }, says: /the flag --host, or its variable FIX_HOST, is required/ });
	});
	test("a repeated flag is kept in order, a command's own and a setting's", async () => {
		const read = await flagsRead(["publish", "--name", "a", "--summary", "s", "--tag", "b:2", "--label", "z", "--tag=a:1", "--label", "y", "--tag", "b:0"]);
		assert.deepEqual(read.tag, ["b:2", "a:1", "b:0"]);
		assert.deepEqual(read.label, ["z", "y"]);
	});
	test("values are given to run by type: text, whole numbers, durations in milliseconds, switches on and off; a setting with no value is absent", async () => {
		const read = await flagsRead(["publish", "--name", "a", "--summary", "--not-a-flag", "--priority", "5", "--draft", "--connect-timeout", "1d"]);
		assert.equal(read.summary, "--not-a-flag", "the argument after a flag is its value whatever it holds");
		assert.equal(read.priority, 5);
		assert.equal(read.draft, true);
		assert.equal(read.verbose, false);
		assert.equal(read["connect-timeout"], 86_400_000);
		assert.equal(read.token, "public");
		assert.equal("note" in read, false);
		assert.equal("label" in read, false);
		assert.equal("tag" in read, false);
	});
	test("a local command reads its flags and settings and passes them to the application's code, whose exit is its own, preparing and invoking nothing", async () => {
		const result = await runFixture(["local-echo", "--message", "hello there", "--verbose"], { env: BASE_ENV, scenario: { ...ANSWERING, localStatus: 7 } });
		assert.equal(result.status, 7);
		assert.equal(result.stdout, "local: hello there\n");
		const local = result.records.find((r) => r.event === "local");
		assert.equal(local.flags.message, "hello there");
		assert.equal(local.flags.verbose, true);
		assert.equal(local.flags.host, "host-a");
		assert.deepEqual(result.records.filter((r) => ["prepare", "run"].includes(r.event)), []);
	});
});
