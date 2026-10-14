// ending-exit-status - OC4 (E19): each ending exits with its own status and prints its record on standard
// output, whole, as one JSON object or one fact per line; a usage error and an interruption before `run`
// exit with status 1, printing only on standard error; interruptions after `run` fire its abort signal once
// and never end the wait for the ending the call layer gives. Each case checks both streams and the status,
// with the fixture application run as a child process and real signals sent to it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declareProgram, EXIT_STATUS, INTERRUPTED_LINE } from "@apnex/operation-command";
import { sleep, within } from "../support/clock-timer.js";
import { CYCLIC_ERRORS, fixtureDeclaration, MALFORMED } from "../support/fixture-program.js";
import { BASE_ENV, plainFacts, runFixture, startFixture } from "../support/run-command.js";
import { ADDRESS, DATA_FORMS, dataEnding, GETTER_FORMS, gettersEnding, KIND_FIELDS, OTHER_KIND_FIELD } from "../support/structural-ending.js";

const INVOCATION = /^[0-9]{13}-[0-9a-f]{16}$/;
const REFUSAL = { part: "store", code: "input-misfit", what: "The input does not fit.", why: "A name is required.", fix: "Give a name.", details: { field: "name" }, misfits: [{ pointer: "/name", keyword: "required", expected: "a name", fit: "add it" }] };
const events = (result) => result.records.map((r) => r.event);
const BASE = ["publish", "--name", "a", "--summary", "it's \"quoted\""];

const notEnding = (described) => `run returned ${described}, not an ending the caller interface gives, read as plain data`;
const getterCode = '{"ending": "not-delivered", "agpCode": <getter>, "proxyCode": null, "earlierAttemptsUncertain": false}';
// What a Proxy of attempt 5's F1 shows once its one rejected promise was handed back or thrown: its target's own fields.
const proxiedAnswer = '{"ending": "answered", "invocation": "1791540000000-1234567890abcdef", "attempt": "1791540000000-1234567890abcdef.0123abcd", "operation": "create", "answer": {"ok": true}}';

/** Each malformed run result and its diagnostic, written from own data descriptors: no getter, then or conversion runs. */
const RUN_MALFORMED = Object.freeze({
	"bigint-answer": notEnding('{"ending": "answered", "answer": 1n}'),
	"cyclic-answer": notEnding('{"ending": "answered", "answer": {"a": 1, "self": <cycle>}}'),
	"throwing-ending": notEnding('{"ending": <getter>}'),
	"throwing-answer": notEnding('{"ending": "answered", "answer": <getter>}'),
	"throwing-code": notEnding(getterCode),
	"throwing-then": notEnding('{"then": <getter>}'),
	"thenable-throws": notEnding('{"then": <a function>}'),
	"thenable-throwing-ending": notEnding('{"then": <a function>}'),
	"thenable-rejected-inner": notEnding('{"then": <a function>}'),
	"rejected-answer": notEnding('{"ending": "answered", "answer": <a promise>}'),
	"rejected-code": notEnding('{"ending": "not-delivered", "agpCode": <a promise>, "proxyCode": null, "earlierAttemptsUncertain": false}'),
	"first-read-rejected-code": notEnding(getterCode),
	"throwing-rejected-code": notEnding(getterCode),
	"proxy-first-read-rejected-answer": notEnding(proxiedAnswer),
	"proxy-trap-throws-rejected-answer": notEnding(proxiedAnswer),
	// Its trap throws on every read, the diagnostic's own included, so the diagnostic cannot read it.
	"proxy-trap-always-throws-rejected-answer": notEnding("<unreadable>"),
	"proxy-prototype-trap-throws-rejected-answer": notEnding("<unreadable>"),
});

/** The Proxy results of attempt 5's F1: a whole answered ending, a rejected promise as answer's descriptor value on its first read only, or thrown by the descriptor trap, once or on every read, or by the prototype trap. */
const PROXIED = Object.freeze(["proxy-first-read-rejected-answer", "proxy-trap-throws-rejected-answer", "proxy-trap-always-throws-rejected-answer", "proxy-prototype-trap-throws-rejected-answer"]);
/** The wordings of attempt 5's F1: word throws a Proxy that does the same to its message, each with what its diagnostic says it threw. */
const PROXIED_WORDS = Object.freeze({
	"throws-proxy-first-read-rejected": `{"message": "word's proxy"}`,
	"throws-proxy-trap-throws-rejected": `{"message": "word's proxy"}`,
	"throws-proxy-trap-always-throws-rejected": "<unreadable>",
});

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
		assert.deepEqual([unworded.status, unworded.stderr], [0, ""], "status 0, and no diagnostic where the application gives no word");
		assert.equal(unworded.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(unworded.stdout).invocation}\nanswer: ${JSON.stringify(answer)}\n`, "an answer the application does not word is printed as JSON");
	});

	test("an answer the application does not word is written answer: and its JSON, a string's included, with no diagnostic", async () => {
		for (const answer of ["hello", "two\nlines", 7, null, ["a", 1]]) {
			const r = await runFixture(BASE, { env: BASE_ENV, scenario: { plainAnswer: true, run: { ending: { ending: "answered", answer } } } });
			assert.deepEqual([r.status, r.stderr], [0, ""]);
			assert.equal(r.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(r.stdout).invocation}\nanswer: ${JSON.stringify(answer)}\n`, JSON.stringify(answer));
		}
	});

	test("a word that throws, or returns what is no text, a promise included: the plain form writes answer: and the answer's JSON, with one diagnostic line, status 0; what it threw is never the wording", async () => {
		const answer = { safe: true, said: "it's" };
		for (const [word, why] of [
			["throws-string", "word threw word failed"], ["throws-error", "word threw word broke"], ["returns-number", "word returned 42, not text"],
			["returns-object", 'word returned {"text": "not text"}, not text'], ["returns-rejecting-promise", "word returned <a promise>, not text"], ["returns-resolving-promise", "word returned <a promise>, not text"],
			["throws-rejecting-promise", "word threw <a promise>"], ["returns-holding-promise", 'word returned {"held": <a promise>}, not text'],
		]) {
			const { json, plain } = await ended({ ending: "answered", answer }, { word });
			assert.deepEqual([plain.status, plain.signal, plain.stderr], [0, null, `diagnostic: the answer could not be worded, so it is printed as JSON: ${why}\n`], word);
			assert.equal(plain.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nanswer: ${JSON.stringify(answer)}\n`, word);
			assert.deepEqual([json.status, json.stderr, JSON.parse(json.stdout).answer], [0, "", answer], "the JSON form does not word the answer");
		}
	});

	test("a promise word returns, or an object holding one, is consumed: its rejection never escapes, in this process or the command's", async () => {
		const escaped = [];
		const onRejection = (reason) => escaped.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			for (const [word, why] of [["returns-rejecting-promise", "word returned <a promise>, not text"], ["returns-holding-promise", 'word returned {"held": <a promise>}, not text']]) {
				const decl = fixtureDeclaration({ word, run: { ending: { ending: "answered", answer: { a: 1 } } } });
				const out = [];
				const err = [];
				const status = await declareProgram(decl).run({ args: BASE, env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
				await sleep(50);
				assert.deepEqual([status, err], [0, [`diagnostic: the answer could not be worded, so it is printed as JSON: ${why}\n`]]);
				assert.ok(out.join("").endsWith('answer: {"a":1}\n'));
			}
			assert.deepEqual(escaped, [], "no unhandled rejection");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});

	test("a word returning 200000 lines is printed whole, status 0, nothing on standard error, without overflowing the call stack, through the process adapter; the JSON form unchanged", async () => {
		const answer = { ok: true };
		const { json, plain } = await ended({ ending: "answered", answer }, { word: "many-lines" });
		assert.deepEqual([plain.status, plain.signal, plain.stderr], [0, null, ""]);
		assert.equal(plain.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\n${"a\n".repeat(200000)}`);
		assert.deepEqual([json.status, json.signal, json.stderr], [0, null, ""]);
		assert.equal(json.stdout, `${JSON.stringify({ ending: "answered", operation: "create", invocation: JSON.parse(json.stdout).invocation, answer })}\n`);
	});

	test("refused: status 2, the refusal record unchanged", async () => {
		const { json, plain } = await ended({ ending: "refused", refusal: REFUSAL });
		for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [2, ""]);
		const record = JSON.parse(json.stdout);
		assert.equal(json.stdout, `${JSON.stringify({ ending: "refused", operation: "create", invocation: record.invocation, refusal: REFUSAL })}\n`);
		assert.equal(plain.stdout, `ending: refused\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nrefusal: ${JSON.stringify(REFUSAL)}\n`);
	});

	test("answers and refusal details holding a member named __proto__, its value an object or a scalar, nested too: each record printed whole, as the call layer's ending holds it, in both forms", async () => {
		// Parsed from JSON text, as the call layer decodes them: __proto__ is an own member, kept at every depth.
		const payloads = [
			JSON.parse('{"__proto__":{"ok":"from-proto","kept":true},"nested":{"__proto__":"text","list":[{"__proto__":{"deeper":1}}]},"safe":1}'),
			JSON.parse('{"__proto__":"text","nested":{"__proto__":{"kept":[1,2]}},"list":[{"__proto__":7}],"ok":null}'),
		];
		const returnedOf = (r) => {
			const found = r.records.filter((x) => x.event === "run-returned");
			assert.equal(found.length, 1);
			return found[0].returned;
		};
		for (const payload of payloads) {
			assert.ok(Object.hasOwn(payload, "__proto__") && Object.hasOwn(payload.nested, "__proto__"), "the payload holds own __proto__ members");
			for (const [ending, status] of [[{ ending: "answered", answer: payload }, 0], [{ ending: "refused", refusal: { ...REFUSAL, details: payload } }, 2]]) {
				const field = ending.ending === "answered" ? "answer" : "refusal";
				const { json, plain } = await ended(ending);
				const unworded = await runFixture(BASE, { env: BASE_ENV, scenario: { plainAnswer: true, prepare: { settle: "ready" }, run: { ending } } });
				for (const r of [json, plain, unworded]) assert.deepEqual([r.status, r.signal, r.stderr], [status, null, ""], field);
				// The call layer's ending, as run returned it, holds the member; the record printed holds it unchanged.
				const given = returnedOf(json);
				assert.deepEqual(given[field], ending[field]);
				const record = JSON.parse(json.stdout);
				assert.deepEqual(record, { ending: given.ending, operation: "create", invocation: given.invocation, [field]: given[field] });
				assert.equal(json.stdout, `${JSON.stringify({ ending: given.ending, operation: "create", invocation: given.invocation, [field]: given[field] })}\n`);
				const value = returnedOf(plain)[field];
				const inv = plainFacts(plain.stdout).invocation;
				assert.equal(plain.stdout, field === "answer"
					// word is given its own copy, the member still a member: answer.ok is the payload's own, never its __proto__'s.
					? `ending: answered\noperation: create\ninvocation: ${inv}\nanswer-ok: ${value.ok ?? "-"}\nanswer-json: ${JSON.stringify(value)}\nverbose: false\n`
					: `ending: refused\noperation: create\ninvocation: ${inv}\nrefusal: ${JSON.stringify(value)}\n`);
				assert.equal(unworded.stdout, `ending: ${given.ending}\noperation: create\ninvocation: ${plainFacts(unworded.stdout).invocation}\n${field}: ${JSON.stringify(returnedOf(unworded)[field])}\n`);
			}
		}
	});

	test("not delivered: status 3, agpCode, proxyCode and earlierAttemptsUncertain as the call layer, or a caller across a hop, gave them", async () => {
		// The call layer's names its attempt and AGP's code; a hop's names no attempt, and its own code.
		for (const ending of [{ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: false }, { ending: "not-delivered", attempt: null, agpCode: null, proxyCode: "proxy-unreachable", earlierAttemptsUncertain: true }]) {
			const { json, plain } = await ended(ending);
			for (const r of [json, plain]) assert.deepEqual([r.status, r.stderr], [3, ""]);
			const { ending: e, agpCode, proxyCode, earlierAttemptsUncertain } = ending;
			assert.equal(json.stdout, `${JSON.stringify({ ending: e, operation: "create", invocation: JSON.parse(json.stdout).invocation, agpCode, proxyCode, earlierAttemptsUncertain })}\n`);
			assert.equal(plain.stdout, `ending: not-delivered\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nagpCode: ${agpCode}\nproxyCode: ${proxyCode}\nearlierAttemptsUncertain: ${earlierAttemptsUncertain}\n`);
		}
	});

	test("unknown: status 4, reason, agpCode, deliveryReport and repeat, the plain form's repeat one command line; a hop's and the whole find's attempt-null endings included", async () => {
		for (const ending of [{ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" }, { ending: "unknown", reason: "answer-not-sendable", agpCode: "MESSAGE_TOO_LARGE", deliveryReport: null },
			{ ending: "unknown", attempt: null, reason: "bound-passed", agpCode: null, deliveryReport: null }, { ending: "unknown", attempt: null, reason: "proxy-lost", agpCode: null, deliveryReport: null }]) {
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
			assert.match(result.stderr, /^diagnostic: (run failed: the client broke|run returned [^\n]*, not an ending the caller interface gives, read as plain data)\n$/);
		}
	});

	test("a run whose result is no plain-data ending - a non-native thenable, a getter on it, a promise in a field, no JSON - ends unknown with run-failed, its repeat and one diagnostic line, no getter or then called, through the process adapter", async () => {
		for (const [malformed, why] of Object.entries(RUN_MALFORMED)) {
			const json = await runFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { run: { malformed } } });
			const plain = await runFixture(BASE, { env: BASE_ENV, scenario: { run: { malformed } } });
			for (const r of [json, plain]) {
				assert.deepEqual([r.status, r.signal, r.stderr], [4, null, `diagnostic: ${why}\n`], `${malformed}: status 4, one diagnostic line, nothing escaping`);
				assert.equal(r.records.filter((x) => x.event === "run").length, 1);
			}
			const record = JSON.parse(json.stdout);
			assert.deepEqual(record, { ending: "unknown", operation: "create", invocation: record.invocation, reason: "run-failed", agpCode: null, deliveryReport: null,
				repeat: ["publish", "--host", "host-a", "--service", "store", "--url", "ws://127.0.0.1:47100/agp", "--identity", "alice", "--timeout", "10s", "--connect-timeout", "5s", "--retries", "3", "--json", "--name", "a", "--summary", "it's \"quoted\"", "--invocation", record.invocation] });
			const facts = plainFacts(plain.stdout);
			assert.deepEqual([facts.ending, facts.reason, facts.agpCode, facts.deliveryReport], ["unknown", "run-failed", "null", "null"]);
			assert.match(facts.repeat, /^'fixture' 'publish' .* '--invocation' '[0-9]{13}-[0-9a-f]{16}'$/);
		}
	});

	test("reading a malformed run result lets no rejection escape and observes every promise it holds", async () => {
		const escaped = [];
		const onRejection = (reason) => escaped.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			for (const malformed of Object.keys(MALFORMED)) {
				const decl = fixtureDeclaration({});
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => MALFORMED[malformed]() });
				const out = [];
				const err = [];
				const status = await within(declareProgram(decl).run({ args: [...BASE, "--json"], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), malformed);
				assert.equal(status, 4, malformed);
				assert.equal(JSON.parse(out.join("")).reason, "run-failed");
				assert.equal(err.length, 1);
			}
			await sleep(50);
			assert.deepEqual(escaped, [], "no unhandled rejection");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});

	test("a run result whose getter would give a rejected promise on its first read only, or throw one, never called, and a word that throws one, consumed: so with standard output's write held the command still exits 4, or 0 for word, with one diagnostic line and its repeat", async () => {
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
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => counted });
				const err = [];
				const status = await declareProgram(decl).run({ args: [...BASE, "--json"], env: BASE_ENV, stdout: () => undefined, stderr: (t) => err.push(t) });
				assert.deepEqual([status, reads, err.length], [4, 0, 1], malformed);
			}
			const decl = fixtureDeclaration({ word: "throws-rejecting-promise", run: { ending: { ending: "answered", answer: { a: 1 } } } });
			const err = [];
			assert.equal(await declareProgram(decl).run({ args: BASE, env: BASE_ENV, stdout: () => undefined, stderr: (t) => err.push(t) }), 0);
			assert.deepEqual(err, ["diagnostic: the answer could not be worded, so it is printed as JSON: word threw <a promise>\n"]);
			await sleep(50);
			assert.deepEqual(escaped, [], "no unhandled rejection in this process");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
		/** Runs with standard output's write held until the command received SIGINT, sent well after the ending was written, so a rejection left unhandled would end the process with status 1 first. */
		const held = async (args, scenario) => {
			const command = startFixture(args, { env: BASE_ENV, scenario: { ...scenario, holdWrite: { until: ["SIGINT"] } } });
			await command.waitFor("write-held");
			await sleep(200);
			command.signal("SIGINT");
			const r = await command.ended;
			assert.ok(events(r).includes("signal-received") && events(r).includes("write-released"), "the process lived until the held write was released");
			return r;
		};
		const settings = ["--host", "host-a", "--service", "store", "--url", "ws://127.0.0.1:47100/agp", "--identity", "alice", "--timeout", "10s", "--connect-timeout", "5s", "--retries", "3"];
		const command = ["--name", "a", "--summary", "it's \"quoted\""];
		for (const malformed of ["first-read-rejected-code", "throwing-rejected-code"]) {
			const why = RUN_MALFORMED[malformed];
			const json = await held([...BASE, "--json"], { run: { malformed } });
			const plain = await held(BASE, { run: { malformed } });
			for (const r of [json, plain]) assert.deepEqual([r.status, r.signal, r.stderr], [4, null, `diagnostic: ${why}\n`], malformed);
			const record = JSON.parse(json.stdout);
			assert.equal(json.stdout, `${JSON.stringify({ ending: "unknown", operation: "create", invocation: record.invocation, reason: "run-failed", agpCode: null, deliveryReport: null, repeat: ["publish", ...settings, "--json", ...command, "--invocation", record.invocation] })}\n`);
			const inv = plainFacts(plain.stdout).invocation;
			const line = ["fixture", "publish", ...settings, ...command, "--invocation", inv].map((w) => `'${w.replaceAll("'", "'\\''")}'`).join(" ");
			assert.equal(plain.stdout, `ending: unknown\noperation: create\ninvocation: ${inv}\nreason: run-failed\nagpCode: null\ndeliveryReport: null\nrepeat: ${line}\n`);
		}
		const answer = { safe: true };
		const scenario = { word: "throws-rejecting-promise", prepare: { settle: "ready" }, run: { ending: { ending: "answered", answer } } };
		const plain = await held(BASE, scenario);
		assert.deepEqual([plain.status, plain.signal, plain.stderr], [0, null, "diagnostic: the answer could not be worded, so it is printed as JSON: word threw <a promise>\n"]);
		assert.equal(plain.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(plain.stdout).invocation}\nanswer: ${JSON.stringify(answer)}\n`);
		const json = await held([...BASE, "--json"], scenario);
		assert.deepEqual([json.status, json.signal, json.stderr], [0, null, ""], "the JSON form does not word the answer");
		assert.equal(json.stdout, `${JSON.stringify({ ending: "answered", operation: "create", invocation: JSON.parse(json.stdout).invocation, answer })}\n`);
	});

	test("a run result that is a Proxy handing back a rejected promise as a descriptor's value on its first read only, or whose descriptor or prototype trap throws a rejected promise, and a word that throws such a Proxy: that very promise is observed, so in this process and with standard output's write held the command exits 4 with its repeat, or 0 for word, with one diagnostic line", async () => {
		const answer = { safe: true };
		const worded = (why) => `diagnostic: the answer could not be worded, so it is printed as JSON: ${why}\n`;
		// In this process, with --json and without: nothing escapes.
		await noRejectionEscapes(async () => {
			for (const malformed of PROXIED) {
				for (const r of await returnedInProcess(() => ({ value: MALFORMED[malformed]() }))) {
					assert.deepEqual([r.status, r.stderr], [4, `diagnostic: ${RUN_MALFORMED[malformed]}\n`], `${malformed} ${r.json ? "--json" : "plain"}`);
					assert.equal(r.stdout, printed(RUN_FAILED_ENDING, r.json, r.invocation), malformed);
				}
			}
			for (const [word, thrown] of Object.entries(PROXIED_WORDS)) {
				for (const json of [true, false]) {
					const decl = fixtureDeclaration({ word, run: { ending: { ending: "answered", answer } } });
					const out = [];
					const err = [];
					const status = await within(declareProgram(decl).run({ args: [...BASE, ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), word);
					const stdout = out.join("");
					// The JSON form never words the answer, so word, and its Proxy, are never reached.
					assert.deepEqual([status, err.join("")], [0, json ? "" : worded(`word threw ${thrown}`)], `${word} ${json ? "--json" : "plain"}`);
					assert.equal(stdout, printed({ ending: "answered", answer }, json, json ? JSON.parse(stdout).invocation : plainFacts(stdout).invocation));
				}
			}
		});
		// Through the process adapter, with no rejection listener: standard output's write is held until the command
		// received SIGINT, sent well after the ending was written, so a rejection left unhandled would end it with status 1.
		const held = async (args, scenario) => {
			const command = startFixture(args, { env: BASE_ENV, scenario: { ...scenario, holdWrite: { until: ["SIGINT"] } } });
			await command.waitFor("write-held");
			await sleep(200);
			command.signal("SIGINT");
			const r = await command.ended;
			assert.ok(events(r).includes("signal-received") && events(r).includes("write-released"), "the process lived until the held write was released");
			return r;
		};
		for (const malformed of PROXIED) {
			for (const json of [true, false]) {
				const r = await held([...BASE, ...(json ? ["--json"] : [])], { plainAnswer: true, run: { malformed } });
				assert.deepEqual([r.status, r.signal, r.stderr], [4, null, `diagnostic: ${RUN_MALFORMED[malformed]}\n`], `${malformed} ${json ? "--json" : "plain"}`);
				assert.equal(r.records.filter((x) => x.event === "run").length, 1);
				assert.equal(r.stdout, printed(RUN_FAILED_ENDING, json, json ? JSON.parse(r.stdout).invocation : plainFacts(r.stdout).invocation));
			}
		}
		for (const [word, thrown] of Object.entries(PROXIED_WORDS)) {
			const scenario = { word, prepare: { settle: "ready" }, run: { ending: { ending: "answered", answer } } };
			const plain = await held(BASE, scenario);
			assert.deepEqual([plain.status, plain.signal, plain.stderr], [0, null, worded(`word threw ${thrown}`)], word);
			assert.equal(plain.stdout, printed({ ending: "answered", answer }, false, plainFacts(plain.stdout).invocation));
			const json = await held([...BASE, "--json"], scenario);
			assert.deepEqual([json.status, json.signal, json.stderr], [0, null, ""], "the JSON form does not word the answer");
			assert.equal(json.stdout, printed({ ending: "answered", answer }, true, JSON.parse(json.stdout).invocation));
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

	test("an interruption delivered while the arguments are read is remembered: nothing is prepared or invoked, status 1, its line on standard error, with --json and without", async () => {
		for (const args of [BASE, [...BASE, "--json"], ["read", "--name", "a", "--json"], ["local-echo", "--message", "m"]]) {
			const r = await runFixture(args, { env: BASE_ENV, scenario: { interruptWhileReading: true, prepare: { settle: "ready" }, run: { ending: { ending: "answered", answer: { ok: true } } } } });
			assert.deepEqual([r.status, r.signal, r.stdout, r.stderr], [1, null, "", `${INTERRUPTED_LINE}\n`], args.join(" "));
			assert.deepEqual(r.records.filter((x) => x.event !== "clock-began"), [{ event: "interrupted-while-reading", listeners: 1 }], "interrupted while reading, after subscribing; nothing prepared, run or invoked");
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
		for (const [args, scenario, signals] of [
			[[...BASE, "--json"], { run: { ending, selfSignal: "SIGINT" }, holdWrite: { until: ["SIGINT"] } }, ["SIGINT"]],
			[BASE, { run: { ending, selfSignal: "SIGTERM" }, wordSelfSignal: "SIGINT", holdWrite: { until: ["SIGTERM", "SIGINT"] } }, ["SIGTERM", "SIGINT"]],
			[[...BASE, "--json"], { run: { ending }, holdWrite: { until: ["SIGTERM"], duringWrite: "SIGTERM" } }, ["SIGTERM"]],
			[BASE, { run: { ending }, holdWrite: { until: ["SIGINT"], duringWrite: "SIGINT" } }, ["SIGINT"]],
		]) {
			const r = await runFixture(args, { env: BASE_ENV, scenario: { prepare: { settle: "ready" }, ...scenario } });
			assert.deepEqual([r.status, r.signal, r.stderr], [0, null, ""]);
			// Each signal reached the process, the process adapter's handler among its listeners, before standard output was released and the process exited.
			const received = r.records.filter((x) => x.event === "signal-received");
			assert.deepEqual(received.map((x) => x.signal).sort(), [...signals].sort());
			assert.ok(received.every((x) => x.listeners === 2), "the process adapter's handler and the test's own");
			const released = r.records.findIndex((x) => x.event === "write-released");
			assert.ok(released > r.records.findLastIndex((x) => x.event === "signal-received"), "the write was released only once every signal was received");
			if (scenario.holdWrite.duringWrite) assert.ok(r.records.findIndex((x) => x.event === "write-held") < r.records.findIndex((x) => x.event === "signal-received"), "received while the ending was being written");
			if (args.includes("--json")) assert.deepEqual(JSON.parse(r.stdout), { ending: "answered", operation: "create", invocation: JSON.parse(r.stdout).invocation, answer: { ok: "printed" } });
			else if (scenario.wordSelfSignal) {
				assert.equal(r.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(r.stdout).invocation}\nanswer-ok: printed\nanswer-json: {"ok":"printed"}\nverbose: false\n`, "every line printed");
				assert.ok(events(r).includes("wording"));
			} else assert.equal(r.stdout, `ending: answered\noperation: create\ninvocation: ${plainFacts(r.stdout).invocation}\nanswer-ok: printed\nanswer-json: {"ok":"printed"}\nverbose: false\n`);
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

const SETTINGS = ["--host", "host-a", "--service", "store", "--url", "ws://127.0.0.1:47100/agp", "--identity", "alice", "--timeout", "10s", "--connect-timeout", "5s", "--retries", "3"];
const COMMAND_FLAGS = ["--name", "a", "--summary", "it's \"quoted\""];
const shellLine = (words) => words.map((w) => `'${w.replaceAll("'", "'\\''")}'`).join(" ");

/** The whole output of an ending, in either form, as the command prints it under `invocation`, the answer unworded. */
function printed(ending, json, invocation) {
	const record = { ending: ending.ending, operation: "create", invocation };
	for (const field of KIND_FIELDS[ending.ending]) record[field] = ending[field];
	if (ending.ending === "unknown") record.repeat = ["publish", ...SETTINGS, ...(json ? ["--json"] : []), ...COMMAND_FLAGS, "--invocation", invocation];
	if (json) return `${JSON.stringify(record)}\n`;
	return `${Object.entries(record).map(([name, value]) => name === "repeat" ? `repeat: ${shellLine(["fixture", ...value])}` : `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")}\n`;
}

/** Runs publish in this process, with --json and without, run returning what `make` makes afresh for each, the answer unworded. */
async function returnedInProcess(make) {
	const results = [];
	for (const json of [true, false]) {
		const made = make();
		const decl = fixtureDeclaration({ plainAnswer: true });
		decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => made.value });
		const out = [];
		const err = [];
		const status = await within(declareProgram(decl).run({ args: [...BASE, ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), "the command's status");
		const stdout = out.join("");
		results.push({ json, status, stdout, stderr: err.join(""), made, invocation: json ? JSON.parse(stdout).invocation : plainFacts(stdout).invocation });
	}
	return results;
}

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

/** A diagnostic line as OC4 cuts it: at 1000 characters, with ... added. */
const cut = (line) => line.length > 1000 ? `${line.slice(0, 1000)}...` : line;

const PAYLOAD = '{"__proto__":{"ok":"from-proto","kept":true},"nested":{"__proto__":"text","list":[{"__proto__":{"deeper":1}}]},"safe":1}';
const PAYLOAD_THEN = '{"__proto__":{"ok":"from-proto"},"then":"data","nested":{"__proto__":"text","then":{"kept":1},"list":[{"__proto__":{"deeper":1}}]},"safe":1}';
/** One ending of each kind, its answer or refusal holding own __proto__ members, nested too, as JSON text gives them. */
const KINDS = () => [
	[{ ending: "answered", answer: JSON.parse(PAYLOAD) }, 0],
	[{ ending: "refused", refusal: { ...REFUSAL, details: JSON.parse(PAYLOAD) } }, 2],
	[{ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, earlierAttemptsUncertain: true }, 3],
	[{ ending: "unknown", reason: "bound-passed", agpCode: null, deliveryReport: "delivered" }, 4],
];

/** A plain object holding `fields`, with `name` an own enumerable getter recording each call in `calls`, throwing or giving a rejected promise. */
function plainGetterEnding(fields, name, gives, calls) {
	return Object.defineProperty({ ...fields }, name, { enumerable: true, get() {
		calls.push(name);
		const error = new Error(`the ${name} getter ${gives === "throws" ? "threw" : "gave a rejected promise"}`);
		if (gives === "throws") throw error;
		return Promise.reject(error);
	} });
}

const RUN_FAILED_ENDING = { ending: "unknown", reason: "run-failed", agpCode: null, deliveryReport: null };
const NOT_ENDING = /^diagnostic: run returned [^\n]*, not an ending the caller interface gives, read as plain data\n$/;

describe("OC4 - an ending read as plain data; a diagnostic that always ends", { concurrency: 4 }, () => {
	test("each of the four endings as plain data, a null prototype and nested __proto__ and then members included: printed whole with its status in both forms, every member of an answer or refusal kept", async () => {
		for (const [ending, status] of KINDS()) {
			const fields = { ...ending, ...ADDRESS };
			for (const value of [fields, Object.assign(Object.create(null), fields)]) {
				for (const r of await returnedInProcess(() => ({ value }))) {
					assert.deepEqual([r.status, r.stderr], [status, ""], `${ending.ending} ${Object.getPrototypeOf(value) === null ? "null prototype" : "plain"}`);
					assert.equal(r.stdout, printed(ending, r.json, r.invocation), `${ending.ending} ${r.json ? "--json" : "plain"}`);
				}
			}
		}
		// The payload printed holds its own __proto__ and then members, never a prototype set from them, and then is never called.
		const [r] = await returnedInProcess(() => ({ value: { ending: "answered", answer: JSON.parse(PAYLOAD_THEN), ...ADDRESS } }));
		assert.equal(r.status, 0);
		const answer = JSON.parse(r.stdout).answer;
		assert.ok(Object.hasOwn(answer, "__proto__") && Object.hasOwn(answer.nested, "__proto__") && Object.hasOwn(answer.nested.list[0], "__proto__") && Object.hasOwn(answer, "then"));
	});

	test("each of the four endings with a custom prototype, an inherited field, a non-enumerable field, a getter or an extra field: unknown with run-failed, its repeat and one diagnostic line, in both forms, zero getter calls", async () => {
		for (const [ending] of KINDS()) {
			const fields = { ...ending, ...ADDRESS };
			for (const form of GETTER_FORMS) {
				for (const r of await returnedInProcess(() => gettersEnding(fields, form, ["extra"]))) {
					assert.equal(r.status, 4, `${ending.ending} ${form}`);
					assert.match(r.stderr, NOT_ENDING, `${ending.ending} ${form}`);
					assert.equal(r.stdout, printed(RUN_FAILED_ENDING, r.json, r.invocation), `${ending.ending} ${form} ${r.json ? "--json" : "plain"}`);
					assert.deepEqual([r.made.reads, r.made.touched], [{}, []], `${ending.ending} ${form}: no getter called`);
				}
			}
			for (const value of [...DATA_FORMS.map((form) => dataEnding(fields, form)), { ...fields, extra: true }, { ...fields, [OTHER_KIND_FIELD[ending.ending]]: null }]) {
				for (const r of await returnedInProcess(() => ({ value }))) {
					assert.equal(r.status, 4, ending.ending);
					assert.match(r.stderr, NOT_ENDING, ending.ending);
					assert.equal(r.stdout, printed(RUN_FAILED_ENDING, r.json, r.invocation));
				}
			}
		}
	});

	test("a getter that would throw or give a promise on any of an ending's fields, and a native promise in invocation, attempt, operation or a payload field: unknown with run-failed, its repeat and one diagnostic line, in both forms, zero getter calls, no rejection escaping", async () => {
		const calls = [];
		const cases = [];
		for (const [ending] of KINDS()) {
			const fields = { ...ending, ...ADDRESS };
			for (const name of Object.keys(fields)) {
				for (const gives of ["throws", "promise"]) cases.push([`${ending.ending}: ${name} getter ${gives}`, () => plainGetterEnding(fields, name, gives, calls)]);
			}
			const payloadField = KIND_FIELDS[ending.ending][0];
			for (const name of ["invocation", "attempt", "operation", payloadField]) {
				cases.push([`${ending.ending}: ${name} a rejected promise`, () => ({ ...fields, [name]: Promise.reject(new Error(`the ${name} promise rejected`)) })]);
			}
			// A promise held deep inside an answer or a refusal's details.
			if (ending.ending === "answered") cases.push(["answered: a promise inside the answer", () => ({ ...fields, answer: { deep: [{ held: Promise.reject(new Error("the answer's inner promise rejected")) }] } })]);
			if (ending.ending === "refused") cases.push(["refused: a promise inside the refusal's details", () => ({ ...fields, refusal: { ...fields.refusal, details: { held: Promise.reject(new Error("the details' promise rejected")) } } })]);
		}
		await noRejectionEscapes(async () => {
			for (const [what, make] of cases) {
				for (const r of await returnedInProcess(() => ({ value: make() }))) {
					assert.equal(r.status, 4, what);
					assert.match(r.stderr, NOT_ENDING, what);
					assert.equal(r.stdout, printed(RUN_FAILED_ENDING, r.json, r.invocation), what);
				}
			}
		});
		assert.deepEqual(calls, [], "no getter called");
	});

	test("a diagnostic is written from own data descriptors only: an error's getters never called, an object never converted, an inherited name never read, and a message holding line breaks still one line", async () => {
		const reads = { name: 0, message: 0 };
		const conversions = [];
		await noRejectionEscapes(async () => {
			for (const json of [true, false]) {
				const inner = Object.defineProperties(new Error(), {
					name: { get() { reads.name++; return "Inner"; } },
					message: { get() { reads.message++; return "two\nlines"; } },
				});
				const outer = new Error();
				outer.name = inner;
				outer.message = inner;
				const converting = new Error();
				converting.message = { toString() { conversions.push("toString"); return "x"; }, [Symbol.toPrimitive]() { conversions.push("toPrimitive"); return "x"; } };
				const lines = Object.defineProperties(new Error(), { name: { value: "Inner" }, message: { value: "two\nlines" } });
				const twice = new Error();
				twice.name = lines;
				twice.message = lines;
				const inherited = new TypeError("only its message");
				const thrown = [outer, converting, twice, inherited];
				const decl = fixtureDeclaration({ plainAnswer: true });
				let calls = 0;
				decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { throw thrown[calls++]; } });
				for (const expected of ["diagnostic: run failed: <getter>: <getter>: <getter>: <getter>\n", 'diagnostic: run failed: {"toString": <a function>}\n', "diagnostic: run failed: Inner: two lines: Inner: two lines\n", "diagnostic: run failed: only its message\n"]) {
					const out = [];
					const err = [];
					const status = await declareProgram(decl).run({ args: [...BASE, ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
					const stdout = out.join("");
					assert.deepEqual([status, err.join("")], [4, expected]);
					assert.equal(stdout, printed(RUN_FAILED_ENDING, json, json ? JSON.parse(stdout).invocation : plainFacts(stdout).invocation));
				}
			}
		});
		assert.deepEqual(reads, { name: 0, message: 0 }, "no getter called");
		assert.deepEqual(conversions, [], "no conversion called");
	});

	test("run and word throwing an error whose own name or own message exceeds 1000 characters beside a rejected promise in another own property: one diagnostic line cut at 1000 characters and zero unhandled rejections, in this process", async () => {
		await noRejectionEscapes(async () => {
			for (const error of ["long-name-rejected-message", "long-name-rejected-detail", "long-name-rejecting-getter", "long-message-rejected-detail"]) {
				const { said } = CYCLIC_ERRORS[error];
				for (const rejects of [false, true]) {
					for (const json of [true, false]) {
						const decl = fixtureDeclaration({ plainAnswer: true });
						decl.commands = decl.commands.map((c) => c.local ? c : { ...c, run: () => { const e = CYCLIC_ERRORS[error].make(); if (rejects) return Promise.reject(e); throw e; } });
						const out = [];
						const err = [];
						const status = await within(declareProgram(decl).run({ args: [...BASE, ...(json ? ["--json"] : [])], env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), error);
						const stdout = out.join("");
						assert.deepEqual([status, err], [4, [`${cut(`diagnostic: run failed: ${said}`)}\n`]], `${error} ${rejects ? "rejects" : "throws"}`);
						assert.equal(stdout, printed(RUN_FAILED_ENDING, json, json ? JSON.parse(stdout).invocation : plainFacts(stdout).invocation));
					}
				}
				const decl = fixtureDeclaration({ word: `throws-${error}`, run: { ending: { ending: "answered", answer: { safe: true } } } });
				const out = [];
				const err = [];
				assert.equal(await within(declareProgram(decl).run({ args: BASE, env: BASE_ENV, stdout: (t) => out.push(t), stderr: (t) => err.push(t) }), error), 0);
				assert.deepEqual(err, [`${cut(`diagnostic: the answer could not be worded, so it is printed as JSON: word threw ${said}`)}\n`]);
				assert.ok(out.join("").endsWith('answer: {"safe":true}\n'));
			}
		});
	});

	test("run and word throwing an error whose own name is itself, whose own message is itself, which holds a value that holds it, whose own name or own message exceeds 1000 characters beside a rejected promise in another own property, and one too long for a line: the run unknown with run-failed and its repeat, the word's answer written as JSON, each with one diagnostic line, cut at 1000 characters, through the process adapter", async () => {
		const unknown = { ending: "unknown", reason: "run-failed", agpCode: null, deliveryReport: null };
		for (const [error, { said }] of Object.entries(CYCLIC_ERRORS)) {
			// An unhandled rejection would end the child with status 1 before its ending is written.
			for (const rejects of error === "long-message" ? [false] : [false, true]) {
				const json = await runFixture([...BASE, "--json"], { env: BASE_ENV, scenario: { run: { fails: { error, rejects } } } });
				const plain = await runFixture(BASE, { env: BASE_ENV, scenario: { plainAnswer: true, run: { fails: { error, rejects } } } });
				const line = cut(`diagnostic: run failed: ${said}`);
				if (error.startsWith("long-")) assert.equal(line.length, 1003, "cut at 1000 characters, ... added");
				for (const r of [json, plain]) {
					assert.deepEqual([r.status, r.signal, r.stderr], [4, null, `${line}\n`], `${error} ${rejects ? "rejects" : "throws"}`);
					assert.equal(r.stdout, printed(unknown, r === json, r === json ? JSON.parse(r.stdout).invocation : plainFacts(r.stdout).invocation));
				}
			}
			const answer = { safe: true };
			const scenario = { word: `throws-${error}`, run: { ending: { ending: "answered", answer } } };
			const plain = await runFixture(BASE, { env: BASE_ENV, scenario });
			assert.deepEqual([plain.status, plain.signal, plain.stderr], [0, null, `${cut(`diagnostic: the answer could not be worded, so it is printed as JSON: word threw ${said}`)}\n`], `word ${error}`);
			assert.equal(plain.stdout, printed({ ending: "answered", answer }, false, plainFacts(plain.stdout).invocation));
			const json = await runFixture([...BASE, "--json"], { env: BASE_ENV, scenario });
			assert.deepEqual([json.status, json.signal, json.stderr], [0, null, ""], "the JSON form does not word the answer");
			assert.equal(json.stdout, printed({ ending: "answered", answer }, true, JSON.parse(json.stdout).invocation));
		}
	});
});
