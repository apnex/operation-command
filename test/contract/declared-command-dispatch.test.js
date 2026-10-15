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

	test("a switch required or repeating is refused, naming the rule, a setting's and a command's own", () => {
		refused(withSetting({ flag: "--quiet", required: true, type: { kind: "switch" } }), "switch-form");
		refused(withSetting({ flag: "--quiet", repeats: true, type: { kind: "switch" } }), "switch-form");
		refused(withFlag({ flag: "--quiet", required: true, type: { kind: "switch" } }), "switch-form");
		refused(withFlag({ flag: "--quiet", repeats: true, type: { kind: "switch" } }), "switch-form");
		assert.throws(() => declareProgram(withFlag({ flag: "--quiet", repeats: true, type: { kind: "switch" } })), /^DeclarationError: switch-form: the flag --quiet is a switch, which is on when given and off otherwise, so it is neither required nor repeats$/);
		assert.ok(declareProgram(withFlag({ flag: "--quiet", type: { kind: "switch" } })));
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

	test("--json is operation-command's own switch, and no setting or flag of the application's, of any type", () => {
		refused(withSetting({ flag: "--json", type: { kind: "switch" } }), "json-reserved");
		refused(withSetting({ flag: "--json", default: "x", type: { kind: "string", pattern: ".*" } }), "json-reserved");
		refused(withFlag({ flag: "--json", type: { kind: "switch" } }), "json-reserved");
		refused(declaration({ commands: [{ name: "go", local: true, run: () => 0, flags: [{ flag: "--json", type: { kind: "switch" } }] }] }), "json-reserved");
		assert.throws(() => declareProgram(withSetting({ flag: "--json", type: { kind: "switch" } })), /^DeclarationError: json-reserved: --json is operation-command's own switch/);
	});

	test("a string's pattern is checked standing alone, not as made whole", () => {
		refused(withSetting({ flag: "--a", type: { kind: "string", pattern: "a)(b" } }), "value-type");
		refused(withSetting({ flag: "--a", default: "xabcx", type: { kind: "string", pattern: "abc" } }), "default-invalid");
		refused(withSetting({ flag: "--a", default: "lowx", type: { kind: "string", pattern: "low|high" } }), "default-invalid");
		assert.ok(declareProgram(withSetting({ flag: "--a", default: "abc", type: { kind: "string", pattern: "abc" } })));
		assert.ok(declareProgram(withSetting({ flag: "--a", default: "high", type: { kind: "string", pattern: "low|high" } })));
	});

	test("types and their valid values are checked: pattern, whole-number bounds, duration bounds, URL schemes, kind", () => {
		refused(withSetting({ flag: "--a", type: { kind: "string", pattern: "(" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "string" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "integer", min: 5, max: 1 } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "integer", min: 0, max: 1.5 } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1s", max: "10" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1h", max: "1m" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1S", max: "1m" } }), "value-type");
		// A duration's bounds are whole numbers of milliseconds held exactly, so the range compared is the range declared.
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1ms", max: "9007199254740992ms" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "duration", min: "1ms", max: `${"9".repeat(400)}d` } }), "value-type");
		assert.ok(declareProgram(withSetting({ flag: "--a", type: { kind: "duration", min: "0ms", max: "9007199254740991ms" } })));
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: [] } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws:"] } }), "value-type");
		// A URL type's pattern is text and a regular expression standing alone, as a string's is (OC1).
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: 5 } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: null } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: "(" } }), "value-type");
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: "a)(b" } }), "value-type");
		assert.throws(() => declareProgram(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: "(" } })), /^DeclarationError: value-type: the setting --a's pattern "\(" is not a regular expression$/);
		refused(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: "ws:.*", ports: [1] } }), "unknown-field");
		assert.ok(declareProgram(withSetting({ flag: "--a", type: { kind: "url", schemes: ["ws"], pattern: "ws://[^/]+:[0-9]+/.*" } })));
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
		refused(withSetting({ flag: "--timeout", type: { kind: "switch" } }), "flag-taken");
		refused(withFlag({ flag: "--wait", type: { kind: "switch" } }), "flag-taken");
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
		assert.ok(declareProgram(declaration({ commands: [{ name: "go", operation: "go", changes: false, run, flags: [
			{ flag: "--a", excludes: ["--b"], requires: ["--c"], type: { kind: "switch" } }, { flag: "--b", type: { kind: "switch" } }, { flag: "--c", type: { kind: "switch" } }] }] })), "a command's own flags relate to each other");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ exactlyOne: ["--a", "--wait"] }] }), "group-form");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ exactlyOne: ["--a", "--json"] }] }), "group-form");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ oneOf: ["--a"] }] }), "group-form");
		refused(withFlag({ flag: "--a", type: { kind: "switch" } }, { groups: [{ atLeastOne: [] }] }), "group-form");
	});

	test("excludes and requires are declared only among a command's own flags: a setting that declares either, and a command's flag relating a setting, are refused, naming the rule", () => {
		const text = { kind: "string", pattern: "[\\s\\S]*" };
		const settings = declaration().settings;
		const message = /^flag-relation: the setting --a declares (excludes|requires), but a setting excludes and requires nothing: only a command's own flag may exclude or require another of that command's own flags$/;
		// The two declarations whose repeats the reader once refused: a defaulted setting excluding, and requiring, another setting.
		for (const key of ["excludes", "requires"]) {
			const decl = declaration({ settings: [...settings, { flag: "--a", default: "x", type: text, [key]: ["--b"] }, { flag: "--b", type: text }] });
			refused(decl, "flag-relation");
			assert.throws(() => declareProgram(decl), (error) => message.test(error.message));
			// A setting relating a command's own flag, or relating nothing at all, declares a relation all the same.
			refused(declaration({ settings: [...settings, { flag: "--a", variable: "P_A", required: true, type: text, [key]: ["--name"] }], commands: [{ name: "go", operation: "go", changes: false, run, flags: [{ flag: "--name", type: text }] }] }), "flag-relation");
			refused(withSetting({ flag: "--a", type: { kind: "switch" }, [key]: [] }), "flag-relation");
			// A command's own flag relating a setting, by its variable and default or a switch.
			for (const setting of ["--timeout", "--wait"]) {
				refused(withFlag({ flag: "--a", [key]: [setting], type: { kind: "switch" } }), "flag-relation");
				assert.throws(() => declareProgram(withFlag({ flag: "--a", [key]: [setting], type: { kind: "switch" } })), /^DeclarationError: flag-relation: --a excludes or requires "--(timeout|wait)", which is not another of the command go's own flags; a flag relates only to its command's own flags, never to a setting$/);
			}
		}
		let ran = 0;
		const counting = declaration({ settings: [...settings, { flag: "--a", default: "x", type: text, excludes: ["--b"] }, { flag: "--b", type: text }], commands: [{ name: "go", operation: "go", changes: false, run: () => { ran++; return run(); } }] });
		refused(counting, "flag-relation");
		assert.equal(ran, 0, "refused when given, before any argument is read");
	});

	test("the bound setting's declared range lies wholly within 1 to 2147483647 milliseconds, and the preparation setting's within 0 to that maximum, each bound checked; a range partly or wholly outside is refused", () => {
		const bound = (min, max, def) => ({ flag: "--timeout", default: def, type: { kind: "duration", min, max } });
		const wait = (min, max, def) => ({ flag: "--wait", default: def, type: { kind: "duration", min, max } });
		const [timeout, waiting] = declaration().settings;
		let ran = 0;
		const counted = (settings) => declaration({ settings, commands: [{ name: "go", operation: "go", changes: false, run: () => { ran++; return run(); } }], client: { prepare: () => { ran++; return "ready"; } } });
		for (const [min, max, def, what] of [
			["25d", "30d", "25d", "wholly above"], ["2147483649ms", "2147483650ms", "2147483649ms", "wholly above, just past the maximum"],
			["0ms", "0ms", "0ms", "wholly below"], ["1ms", "25d", "1s", "its upper bound above"], ["1s", "2147483648ms", "1s", "its upper bound one past the maximum"],
			["0ms", "1h", "1s", "its lower bound below"], ["0ms", "2147483648ms", "1s", "both bounds outside"],
		]) {
			refused(counted([bound(min, max, def), waiting]), "call-settings");
			assert.throws(() => declareProgram(counted([bound(min, max, def), waiting])), (error) => error.message.startsWith(`call-settings: --timeout, giving the call's bound, declares the range `) && error.message.endsWith("which does not lie within 1 to 2147483647 milliseconds"), what);
		}
		for (const [min, max, def, what] of [["25d", "30d", "25d", "wholly above"], ["0ms", "25d", "1s", "its upper bound above"], ["1ms", "2147483648ms", "1s", "its upper bound one past the maximum"]]) {
			refused(counted([timeout, wait(min, max, def)]), "call-settings");
			assert.throws(() => declareProgram(counted([timeout, wait(min, max, def)])), /which does not lie within 0 to 2147483647 milliseconds$/, what);
		}
		assert.equal(ran, 0, "each refused when given, before anything is prepared or run");
		assert.ok(declareProgram(counted([bound("1ms", "2147483647ms", "1s"), wait("0ms", "2147483647ms", "0ms")])), "the exact ends of each range are within it");
		assert.ok(declareProgram(counted([bound("2147483647ms", "2147483647ms", "2147483647ms"), wait("2147483647ms", "2147483647ms", "2147483647ms")])));
	});

	test("a program that invokes names a bound and a preparation setting, each a duration that always takes a value, the bound within 1 ms to 2147483647 ms, and declares no --json", () => {
		refused(declaration({ callBound: undefined }), "call-settings");
		refused(declaration({ prepareTime: "--nothing" }), "call-settings");
		refused(declaration({ callBound: "--json" }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", type: { kind: "duration", min: "1ms", max: "1h" } }, ...declaration().settings.slice(1)] }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", default: "1s", type: { kind: "duration", min: "0ms", max: "1h" } }, ...declaration().settings.slice(1)] }), "call-settings");
		refused(declaration({ settings: [{ flag: "--timeout", default: "1s", type: { kind: "duration", min: "1ms", max: "25d" } }, ...declaration().settings.slice(1)] }), "call-settings");
		assert.ok(declareProgram(declaration()), "a program that invokes declares no --json: the switch is operation-command's own");
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
		assert.deepEqual(SETTINGS.map((s) => s.flag), ["--host", "--service", "--url", "--identity", "--token", "--timeout", "--connect-timeout", "--retries", "--label", "--note", "--verbose"]);
	});
});

/** A scenario whose client prepares and whose run answers, so a test can see that neither was reached. */
const ANSWERING = { prepare: { settle: "ready" }, run: { ending: { ending: "answered", answer: { ok: true } } } };

/** Runs the fixture and asserts a usage error: status 1, one line on standard error, nothing on standard output, nothing prepared or invoked. */
async function usageError(args, { env = BASE_ENV, says } = {}) {
	// --json is offered by every command that is not local; a local command's unknown --json is tested apart.
	for (const json of args[0] === "local-echo" ? [false] : [false, true]) {
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
		assert.deepEqual(none.records.filter((r) => ["prepare", "run", "call", "local"].includes(r.event)), [], "nothing prepared, nothing invoked");
		await usageError(["--json"], { says: /^usage: unknown command "--json"; the commands are publish, read, update, find, local-echo\n$/ });
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
	test("a switch given a value, the application's and operation-command's own --json", async () => {
		await usageError(["read", "--name", "a", "--verbose=yes"], { says: /the switch --verbose takes no value/ });
		await usageError(["read", "--name", "a", "--verbose="], { says: /the switch --verbose takes no value/ });
		await usageError(["read", "--name", "a", "--json=yes"], { says: /the switch --json takes no value/ });
	});
	test("--json given twice, and --json given to a local command, which is not offered it", async () => {
		await usageError(["read", "--name", "a", "--json", "--json"], { says: /the flag --json was given twice and may not repeat/ });
		await usageError(["local-echo", "--message", "m", "--json"], { says: /unknown flag "--json" for the command local-echo/ });
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
		// A pattern matches the whole value: a value of which only a part matches is a usage error.
		// The fixture states these patterns without ^ and $, so a part of each value matching proves nothing.
		await usageError(["read", "--id", "x0123abcd"], { says: /"x0123abcd" of --id does not match the pattern \[0-9a-f\]\{8\} as a whole/ });
		await usageError(["read", "--id", "0123abcd9"], { says: /"0123abcd9" of --id does not match the pattern/ });
		await usageError(["find", "--tag", "k:v k:v!"], { says: /"k:v k:v!" of --tag does not match the pattern/ });
		await usageError(["find", "--order", "newestx"], { says: /"newestx" of --order does not match the pattern newest\|oldest as a whole/ });
		await usageError(["find", "--order", "xoldest"], { says: /"xoldest" of --order does not match the pattern/ });
		const whole = await flagsRead(["find", "--order", "oldest", "--tag", "k:v"]);
		assert.deepEqual([whole.order, whole.tag], ["oldest", ["k:v"]], "a value the whole of which matches is read");
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
	test("a URL type with a pattern: the parser, then the scheme, then the pattern, the value kept as taken", async () => {
		const PATTERN = "ws://[^/]+:[0-9]+/.*";
		const probe = async (args, env = {}) => {
			let prepared = 0, invoked = 0, flags;
			const program = declareProgram(declaration({
				settings: [...declaration().settings, { flag: "--hub", variable: "P_HUB", required: true, type: { kind: "url", schemes: ["ws"], pattern: PATTERN } }],
				commands: [{ name: "go", operation: "go", changes: false, run: (context) => { invoked++; flags = context.flags; return { ending: "answered", invocation: context.invocation, attempt: `${context.invocation}.0000000a`, operation: context.operation, answer: null }; } }],
				client: { prepare: () => { prepared++; return "ready"; } },
			}));
			let stdout = "", stderr = "";
			const status = await program.run({ args, env, stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; } });
			return { status, stdout, stderr, prepared, invoked, flags };
		};
		const usage = async (args, env, says) => {
			const result = await probe(args, env);
			assert.deepEqual([result.status, result.stdout, result.prepared, result.invoked], [1, "", 0, 0], `${JSON.stringify(args)}: ${result.stderr}`);
			assert.match(result.stderr, /^usage: [^\n]+\n$/);
			assert.match(result.stderr, says);
		};
		// Parsed, of the scheme, matching: accepted, and run is given the text exactly as it was taken, not the parser's form.
		for (const text of ["ws://host.example:1/agp", "ws://Host.Example:47100/a/../b?q=1", "ws://xn--bcher-kva.example:47100/agp"]) {
			const result = await probe(["go", "--hub", text]);
			assert.deepEqual([result.status, result.prepared, result.invoked, result.flags?.hub], [0, 1, 1, text], result.stderr);
		}
		// Parsed and of the scheme, not matching: the pattern's usage error.
		await usage(["go", "--hub", "ws://host.example/agp"], {}, /^usage: the value "ws:\/\/host\.example\/agp" of --hub does not match the pattern ws:\/\/\[\^\/\]\+:\[0-9\]\+\/\.\* as a whole\n$/);
		// The pattern matches the whole text: one that holds a matching part, here in its query, does not match.
		await usage(["go", "--hub", "ws://host.example/x?u=ws://a:1/"], {}, /of --hub does not match the pattern .* as a whole\n$/);
		// Matching the pattern, refused by the parser: the parser's usage error, checked first.
		for (const text of ["ws://xn--abc.example:1/", "ws://xn--a-ecp.example:1/", "ws://999.999.999.999:1/", "ws://[1:2:3]:1/"]) {
			assert.ok(new RegExp(`^(?:${PATTERN})$`).test(text), `${text} matches the pattern`);
			await usage(["go", "--hub", text], {}, /^usage: the value "[^"]+" of --hub is not a URL\n$/);
		}
		// Refused by the parser and not matching the pattern either: the parser's usage error, checked before the pattern.
		await usage(["go", "--hub", "ws://xn--abc.example/agp"], {}, /^usage: the value "ws:\/\/xn--abc\.example\/agp" of --hub is not a URL\n$/);
		// Taken by the parser but not back from the form it writes for it: refused as no URL, before the scheme and the
		// pattern. Which texts these are is the runtime's parser's; Node 24's writes a host led by U+00E9 and then "xn-"
		// as a label beginning "xn--xn-", which it refuses. Each case is judged by this runtime's own parser, and at
		// least one must be such a text, or the rule goes unexercised.
		const readsBack = (text) => { const url = new URL(text); try { return new URL(url.href).href === url.href; } catch { return false; } };
		const unwritable = ["ws://\u00E9xn--a:1/x", "ws://x.\u00C9XN--A:1/x", "ws://\u00E9xn-:1/x", "http://\u00E9xn--a:1/x"];
		assert.ok(unwritable.some((text) => !readsBack(text)), "this runtime's parser takes back every case, so the rule is not exercised: choose a text it does not");
		for (const text of unwritable) {
			if (readsBack(text)) continue;
			await usage(["go", "--hub", text], {}, /^usage: the value "[^"]+" of --hub is not a URL: the parser writes it as "[^"]+", which it does not take back unchanged\n$/);
			await usage(["go"], { P_HUB: text }, /the variable P_HUB, standing in for --hub, is not a URL: the parser writes it as/);
		}
		// Parsed, of another scheme, not matching either: the scheme's usage error, checked before the pattern.
		await usage(["go", "--hub", "http://host.example/agp"], {}, /is not a URL of the scheme ws\n$/);
		// The variable is read the same way, and its usage error names it.
		await usage(["go"], { P_HUB: "ws://xn--abc.example:1/" }, /the variable P_HUB, standing in for --hub, is not a URL\n$/);
		const fromVariable = await probe(["go"], { P_HUB: "ws://h:2/x" });
		assert.deepEqual([fromVariable.status, fromVariable.flags.hub], [0, "ws://h:2/x"]);
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

	test("a declared pattern holding a line feed, a carriage return and a tab: its usage error is still exactly one line beginning usage:, with --json and without, nothing prepared or invoked", async () => {
		let prepared = 0;
		let runs = 0;
		const decl = declaration({
			client: { prepare: () => { prepared++; return "ready"; } },
			commands: [{ name: "go", operation: "go", changes: false, run: () => { runs++; return run(); }, flags: [{ flag: "--text", type: { kind: "string", pattern: "first\nsecond\r\tthird" } }] }],
		});
		for (const json of [false, true]) {
			const out = [];
			const err = [];
			const status = await declareProgram(decl).run({ args: ["go", ...(json ? ["--json"] : []), "--text", "other"], env: {}, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
			const stderr = err.join("");
			assert.deepEqual([status, out], [1, []], json ? "--json" : "plain");
			assert.equal(stderr.split("\n").length, 2, `exactly one physical line: ${JSON.stringify(stderr)}`);
			assert.match(stderr, /^usage: the value "other" of --text does not match the pattern first second third as a whole\n$/);
		}
		assert.deepEqual([prepared, runs], [0, 0], "nothing prepared, nothing invoked");
	});
});

describe("OC2 - where several usage errors apply, the first met is reported", { concurrency: 4 }, () => {
	test("the arguments in the order given, before the settings' variables", async () => {
		await usageError(["read", "--bad", "--retries", "bad"], { says: /^usage: unknown flag "--bad" for the command read\n$/ });
		await usageError(["read", "--retries", "bad", "--bad"], { says: /^usage: the value "bad" of --retries is not a whole number\n$/ });
		await usageError(["read", "--name", "a", "--name", "b", "--colour"], { says: /^usage: the flag --name was given twice and may not repeat\n$/ });
		await usageError(["read", "--colour"], { env: { FIX_RETRIES: "many" }, says: /^usage: unknown flag "--colour" for the command read\n$/ });
	});
	test("then the settings' variables and required settings, in the declaration's order", async () => {
		await usageError(["read", "--name", "a"], { env: { FIX_IDENTITY: "alice", FIX_RETRIES: "many" }, says: /^usage: the flag --host, or its variable FIX_HOST, is required\n$/ });
		await usageError(["read", "--name", "a"], { env: { FIX_HOST: "host-a", FIX_SERVICE: "Not!" }, says: /^usage: the value "Not!" of the variable FIX_SERVICE, standing in for --service, does not match/ });
		await usageError(["read", "--name", "a"], { env: { FIX_HOST: "host-a", FIX_RETRIES: "many" }, says: /^usage: the flag --identity, or its variable FIX_IDENTITY, is required\n$/ });
	});
	test("then the command's required flags, then its flags that exclude or require others, then its groups", async () => {
		await usageError(["publish"], { env: { FIX_HOST: "host-a" }, says: /--identity, or its variable FIX_IDENTITY, is required/ });
		await usageError(["publish"], { says: /^usage: the flag --name is required by the command publish\n$/ });
		await usageError(["update", "--tag", "k:v", "--no-tags", "--force"], { says: /^usage: the flags --tag and --no-tags exclude each other\n$/ });
		await usageError(["update", "--force"], { says: /^usage: the flag --force requires --expect-revision, which was not given\n$/ });
		await usageError(["update", "--rename", "b"], { says: /^usage: the command update needs exactly one of --name, --id, and was given none\n$/ });
		// A command with a required flag and relations both broken reports its required flag first.
		const text = { kind: "string", pattern: ".*" };
		const program = declareProgram(declaration({ commands: [{ name: "go", operation: "go", changes: false, run, flags: [
			{ flag: "--x", required: true, type: text }, { flag: "--y", excludes: ["--z"], type: text }, { flag: "--z", type: text }, { flag: "--w", type: text }], groups: [{ exactlyOne: ["--w", "--x"] }] }] }));
		const read = async (args) => { let err = ""; const status = await program.run({ args, env: {}, stdout: () => assert.fail("nothing on standard output"), stderr: (t) => { err += t; } }); return [status, err]; };
		assert.deepEqual(await read(["go", "--y", "1", "--z", "2"]), [1, "usage: the flag --x is required by the command go\n"]);
		assert.deepEqual(await read(["go", "--x", "0", "--w", "3", "--y", "1", "--z", "2"]), [1, "usage: the flags --y and --z exclude each other\n"]);
		assert.deepEqual(await read(["go", "--x", "0", "--w", "3"]), [1, "usage: the command go needs exactly one of --w, --x, and was given 2\n"]);
	});
});

describe("OC2 - groups with none, one and two of their flags", { concurrency: 4 }, () => {
	test("exactly one of --name and --id: none and two are usage errors, one is read", async () => {
		await usageError(["read"], { says: /needs exactly one of --name, --id, and was given none/ });
		await usageError(["read", "--name", "a", "--id", "0123abcd"], { says: /needs exactly one of --name, --id, and was given 2/ });
		assert.equal((await flagsRead(["read", "--id", "0123abcd"])).id, "0123abcd", "a value the whole of which matches its pattern is read");
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
