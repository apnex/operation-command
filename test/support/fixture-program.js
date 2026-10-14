// fixture-program - the fixture application of E19: a program declared to operation-command with settings
// of every type and source, commands that change something and commands that change nothing, groups,
// flags that exclude and require others, and a local command; and a fixture client whose `prepare` and
// whose commands' `run` do what a scenario says, recording what they were given to a file, one JSON object
// per line, so a test reads it without any pipe between the processes.
import fs from "node:fs";
import { untilOnClock } from "./clock-timer.js";
import { ADDRESS } from "./structural-ending.js";

const NAME = "^[a-z0-9][a-z0-9-]{0,62}$";

/** The settings, in the order the declaration lists them. */
export const SETTINGS = [
	{ flag: "--host", variable: "FIX_HOST", required: true, type: { kind: "string", pattern: "^[a-z0-9][a-z0-9.-]{0,62}$" } },
	{ flag: "--service", variable: "FIX_SERVICE", default: "store", type: { kind: "string", pattern: NAME } },
	{ flag: "--url", variable: "FIX_URL", default: "ws://127.0.0.1:47100/agp", type: { kind: "url", schemes: ["ws", "wss"] } },
	{ flag: "--identity", variable: "FIX_IDENTITY", required: true, type: { kind: "string", pattern: NAME } },
	{ flag: "--token", variable: "FIX_TOKEN", default: "public", secret: true, type: { kind: "string", pattern: "^[A-Za-z0-9]+$" } },
	{ flag: "--timeout", variable: "FIX_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" } },
	{ flag: "--connect-timeout", variable: "FIX_CONNECT_TIMEOUT", default: "5s", type: { kind: "duration", min: "1ms", max: "24h" } },
	{ flag: "--retries", variable: "FIX_RETRIES", default: "3", type: { kind: "integer", min: 0, max: 9 } },
	{ flag: "--label", repeats: true, type: { kind: "string", pattern: "^[\\s\\S]*$" } },
	{ flag: "--note", type: { kind: "string", pattern: "^[\\s\\S]*$" } },
	{ flag: "--verbose", type: { kind: "switch" } },
];

const anyText = { kind: "string", pattern: "^[\\s\\S]*$" };

/** The commands' own flags and groups, without their run functions. */
export const COMMANDS = {
	publish: { operation: "create", changes: true, flags: [
		{ flag: "--name", required: true, type: { kind: "string", pattern: NAME } },
		{ flag: "--summary", required: true, type: anyText },
		{ flag: "--tag", repeats: true, type: { kind: "string", pattern: "^[a-z0-9-]+:[a-z0-9-]+$" } },
		{ flag: "--priority", type: { kind: "integer", min: 1, max: 5 } },
		{ flag: "--draft", type: { kind: "switch" } },
	] },
	read: { operation: "read", changes: false, flags: [
		{ flag: "--name", type: { kind: "string", pattern: NAME } },
		// Stated without ^ and $: a pattern matches the whole value (OC1).
		{ flag: "--id", type: { kind: "string", pattern: "[0-9a-f]{8}" } },
	], groups: [{ exactlyOne: ["--name", "--id"] }] },
	update: { operation: "update", changes: true, flags: [
		{ flag: "--name", type: { kind: "string", pattern: NAME } },
		{ flag: "--id", type: { kind: "string", pattern: "^[0-9a-f]{8}$" } },
		{ flag: "--rename", type: { kind: "string", pattern: NAME } },
		{ flag: "--summary", type: anyText },
		{ flag: "--tag", repeats: true, excludes: ["--no-tags"], type: { kind: "string", pattern: "^[a-z0-9-]+:[a-z0-9-]+$" } },
		{ flag: "--no-tags", excludes: ["--tag"], type: { kind: "switch" } },
		{ flag: "--expect-revision", type: { kind: "integer", min: 1, max: 9007199254740991 } },
		{ flag: "--force", requires: ["--expect-revision"], type: { kind: "switch" } },
	], groups: [{ exactlyOne: ["--name", "--id"] }, { atLeastOne: ["--rename", "--summary", "--tag", "--no-tags"] }] },
	find: { operation: "find", changes: false, flags: [
		{ flag: "--tag", repeats: true, type: { kind: "string", pattern: "[a-z0-9-]+:[a-z0-9-]+" } },
		{ flag: "--limit", type: { kind: "integer", min: 1, max: 1000 } },
		{ flag: "--order", type: { kind: "string", pattern: "newest|oldest" } },
	] },
};

/** Appends one record to the scenario's record file, synchronously, so a killed process leaves it whole. */
export function recorder(file) {
	return (event, fields = {}) => {
		if (file) fs.appendFileSync(file, `${JSON.stringify({ event, ...fields })}\n`);
	};
}

/** A promise that settles when a signal aborts. */
const aborted = (signal) => new Promise((resolve) => {
	if (signal.aborted) resolve();
	else signal.addEventListener("abort", () => resolve(), { once: true });
});

/**
 * A Proxy over `target` that, on the first read of `name`'s descriptor only, hands back a rejected promise as
 * its value (`how` "first-read") or throws a rejected promise from its `getOwnPropertyDescriptor` trap (`how`
 * "trap-throws"); every other read is the target's own (attempt 5's F1). With `how` "trap-always-throws" the
 * trap throws a fresh rejected promise on every read of `name`, so even the diagnostic's own reading of it
 * catches one. Each promise is made in the trap, so only a reading that observes the very value it obtained,
 * or the very value it caught, consumes it.
 */
export function onceProxy(target, name, how, message) {
	let reads = 0;
	return new Proxy(target, {
		getOwnPropertyDescriptor(inner, key) {
			const descriptor = Reflect.getOwnPropertyDescriptor(inner, key);
			if (key !== name) return descriptor;
			if (how === "trap-always-throws") throw Promise.reject(new Error(`${message} (read ${++reads})`));
			if (++reads !== 1) return descriptor;
			const promise = Promise.reject(new Error(message));
			if (how === "trap-throws") throw promise;
			return { ...descriptor, value: promise };
		},
	});
}

/**
 * A Proxy over `target` whose `getPrototypeOf` trap throws a fresh rejected promise every time it runs: when
 * asked whether it is a promise, when its prototype is checked, and when a diagnostic asks what kind it is.
 */
export function prototypeTrapProxy(target, message) {
	let runs = 0;
	return new Proxy(target, { getPrototypeOf() { throw Promise.reject(new Error(`${message} (run ${++runs})`)); } });
}

/**
 * A Proxy over `target` whose descriptor for `name` hands back a fresh object holding a rejected promise on
 * its first read only, and whose descriptor for `hidden` says it is not enumerable, so a reading refuses the
 * value at `hidden` before it reaches the object it obtained (attempt 6's F1, nested-first): only a reading
 * that observes the very object it obtained, not the Proxy read again, consumes that promise.
 */
export function nestedFirstProxy(target, name, hidden, message) {
	let reads = 0;
	return new Proxy(target, {
		getOwnPropertyDescriptor(inner, key) {
			const descriptor = Reflect.getOwnPropertyDescriptor(inner, key);
			if (key === name && ++reads === 1) return { ...descriptor, value: { held: Promise.reject(new Error(message)) } };
			if (key === hidden) return { ...descriptor, enumerable: false };
			return descriptor;
		},
	});
}

/**
 * A Proxy over an empty object whose `getPrototypeOf` trap, the first time it runs only, throws a fresh object
 * holding a rejected promise, and gives Object.prototype after (attempt 6's F1, caught-object): a reading that
 * swallowed that throw and asked again would read the Proxy as plain data.
 */
export function prototypeOnceProxy(message, target = {}) {
	let runs = 0;
	return new Proxy(target, {
		getPrototypeOf() {
			if (++runs === 1) throw { held: Promise.reject(new Error(message)) };
			return Object.prototype;
		},
	});
}

/** A not-delivered ending a prepare may give, valid but for what a Proxy over it does. */
const PROXIED_CODE = () => ({ ending: "not-delivered", agpCode: "TIMEOUT", proxyCode: null, earlierAttemptsUncertain: false });
/** A whole answered ending a run may give, valid but for what a Proxy over it does. */
const PROXIED_ANSWER = () => ({ ending: "answered", ...ADDRESS, answer: { ok: true } });

/** What a scenario's `settle` names: a value, or a rejection. */
const settleWith = (spec) => spec !== null && typeof spec === "object" && "reject" in spec ? Promise.reject(new Error(spec.reject)) : Promise.resolve(spec);

/**
 * Malformed results a client's prepare or run may give, which no JSON scenario can write, each named: a
 * thenable, a throwing getter on the result or on the thenable, a rejected inner promise, values that are no
 * JSON. Each is made afresh when named, so a promise it holds rejects only for the case that asked for it.
 */
export const MALFORMED = Object.freeze({
	/** An answered ending whose answer is a BigInt. */
	"bigint-answer": () => ({ ending: "answered", answer: 1n }),
	/** An answered ending whose answer holds itself. */
	"cyclic-answer": () => { const answer = { a: 1 }; answer.self = answer; return { ending: "answered", answer }; },
	/** A result whose ending is a getter that throws. */
	"throwing-ending": () => ({ get ending() { throw new Error("the ending getter threw"); } }),
	/** An answered ending whose answer is a getter that throws. */
	"throwing-answer": () => ({ ending: "answered", get answer() { throw new Error("the answer getter threw"); } }),
	/** A not-delivered ending whose agpCode is a getter that throws. */
	"throwing-code": () => ({ ending: "not-delivered", get agpCode() { throw new Error("the code getter threw"); }, proxyCode: null, earlierAttemptsUncertain: false }),
	/** A thenable whose then is a getter that throws. */
	"throwing-then": () => ({ get then() { throw new Error("the then getter threw"); } }),
	/** A thenable whose then throws when called. */
	"thenable-throws": () => ({ then() { throw new Error("then threw"); } }),
	/** A thenable that settles to a result whose ending getter throws. */
	"thenable-throwing-ending": () => ({ then(resolve) { resolve({ get ending() { throw new Error("the settled ending getter threw"); } }); } }),
	/** A thenable that settles to a rejected inner promise. */
	"thenable-rejected-inner": () => ({ then(resolve) { resolve(Promise.reject(new Error("the inner promise rejected"))); } }),
	/** An answered ending whose answer is a promise that rejects. */
	"rejected-answer": () => ({ ending: "answered", answer: Promise.reject(new Error("the answer's promise rejected")) }),
	/** A not-delivered ending whose agpCode is a promise that rejects. */
	"rejected-code": () => ({ ending: "not-delivered", agpCode: Promise.reject(new Error("the code's promise rejected")), proxyCode: null, earlierAttemptsUncertain: false }),
	/** A not-delivered ending whose agpCode is a getter giving a rejected promise on its first read only, and null after. */
	"first-read-rejected-code": () => {
		let reads = 0;
		return { ending: "not-delivered", get agpCode() { return ++reads === 1 ? Promise.reject(new Error("the code's first read rejected")) : null; }, proxyCode: null, earlierAttemptsUncertain: false };
	},
	/** A not-delivered ending whose agpCode is a getter that throws a rejected promise. */
	"throwing-rejected-code": () => ({ ending: "not-delivered", get agpCode() { throw Promise.reject(new Error("the code getter's thrown promise rejected")); }, proxyCode: null, earlierAttemptsUncertain: false }),
	/** A not-delivered ending, its agpCode a plain field but for a Proxy handing back a rejected promise as its value on the first read. */
	"proxy-first-read-rejected-code": () => onceProxy(PROXIED_CODE(), "agpCode", "first-read", "the code's first descriptor read rejected"),
	/** A not-delivered ending whose Proxy's descriptor trap throws a rejected promise on the first read of agpCode. */
	"proxy-trap-throws-rejected-code": () => onceProxy(PROXIED_CODE(), "agpCode", "trap-throws", "the code's descriptor trap threw a rejected promise"),
	/** A not-delivered ending whose Proxy's descriptor trap throws a fresh rejected promise on every read of agpCode. */
	"proxy-trap-always-throws-rejected-code": () => onceProxy(PROXIED_CODE(), "agpCode", "trap-always-throws", "the code's descriptor trap always throws a rejected promise"),
	/** A not-delivered ending whose Proxy's getPrototypeOf trap throws a fresh rejected promise every time. */
	"proxy-prototype-trap-throws-rejected-code": () => prototypeTrapProxy(PROXIED_CODE(), "the not-delivered ending's prototype trap threw a rejected promise"),
	/** A whole answered ending, its answer a plain field but for a Proxy handing back a rejected promise as its value on the first read. */
	"proxy-first-read-rejected-answer": () => onceProxy(PROXIED_ANSWER(), "answer", "first-read", "the answer's first descriptor read rejected"),
	/** A whole answered ending whose Proxy's descriptor trap throws a rejected promise on the first read of answer. */
	"proxy-trap-throws-rejected-answer": () => onceProxy(PROXIED_ANSWER(), "answer", "trap-throws", "the answer's descriptor trap threw a rejected promise"),
	/** A whole answered ending whose Proxy's descriptor trap throws a fresh rejected promise on every read of answer. */
	"proxy-trap-always-throws-rejected-answer": () => onceProxy(PROXIED_ANSWER(), "answer", "trap-always-throws", "the answer's descriptor trap always throws a rejected promise"),
	/** A whole answered ending whose Proxy's getPrototypeOf trap throws a fresh rejected promise every time. */
	"proxy-prototype-trap-throws-rejected-answer": () => prototypeTrapProxy(PROXIED_ANSWER(), "the answered ending's prototype trap threw a rejected promise"),
	/** A not-delivered ending whose Proxy hands back an object holding a rejected promise as agpCode's first value, and hides a later field. */
	"proxy-nested-first-code": () => nestedFirstProxy({ ...PROXIED_CODE(), hidden: 1 }, "agpCode", "hidden", "the code's first descriptor value held a rejected promise"),
	/** A not-delivered ending whose agpCode is a Proxy whose first getPrototypeOf throws an object holding a rejected promise. */
	"proxy-caught-object-code": () => ({ ...PROXIED_CODE(), agpCode: prototypeOnceProxy("the code's prototype trap threw an object holding a rejected promise") }),
	/** A not-delivered ending that is itself a Proxy whose first getPrototypeOf throws an object holding a rejected promise. */
	"proxy-prototype-once-throws-code": () => prototypeOnceProxy("the not-delivered ending's prototype trap threw an object holding a rejected promise", PROXIED_CODE()),
	/** A whole answered ending whose Proxy hands back an object holding a rejected promise as answer's first value, and hides a later field. */
	"proxy-nested-first-answer": () => nestedFirstProxy({ ...PROXIED_ANSWER(), hidden: 1 }, "answer", "hidden", "the answer's first descriptor value held a rejected promise"),
	/** A whole answered ending whose answer is a Proxy whose first getPrototypeOf throws an object holding a rejected promise. */
	"proxy-caught-object-answer": () => ({ ...PROXIED_ANSWER(), answer: prototypeOnceProxy("the answer's prototype trap threw an object holding a rejected promise") }),
	/** A whole answered ending that is itself a Proxy whose first getPrototypeOf throws an object holding a rejected promise. */
	"proxy-prototype-once-throws-answer": () => prototypeOnceProxy("the answered ending's prototype trap threw an object holding a rejected promise", PROXIED_ANSWER()),
	/** A plain not-delivered ending whose sole defect is an extra own data field (attempt 5's F2). */
	"extra-field": () => ({ ending: "not-delivered", agpCode: "NO_ROUTE", proxyCode: null, extra: true }),
});

/**
 * Errors whose description meets itself, ones longer than a diagnostic line holds, and one whose description
 * would never meet the same value twice if its getters ran, each named and made afresh: one whose name is
 * itself, one whose message is itself, one holding, as its message, an error whose name is the first; one with
 * a long message; three whose own name is longer than a line holds, beside a rejected promise as their own
 * message, a rejected promise held in another own property, and a message getter giving a rejected promise
 * (attempt 4's F1); one whose own message is longer than a line holds, beside a rejected promise in another
 * own property (attempt 5's F2); a Proxy of one whose own message is longer than a line holds, its own detail a
 * fresh object holding a fresh rejected promise on every read (attempt 6's F2); and one whose name is an inherited getter. Each case's description, as OC4 writes it from
 * own data descriptors only - never an inherited name, never a getter run - is beside it.
 */
const LONG_NAME = "n".repeat(1100);
const LONG_MESSAGE = "m".repeat(1100);
export const CYCLIC_ERRORS = Object.freeze({
	"name-itself": { make: () => { const error = new Error("its name is itself"); error.name = error; return error; }, said: "<cycle>: its name is itself" },
	"message-itself": { make: () => { const error = new Error("replaced"); error.message = error; return error; }, said: "<cycle>" },
	"holds-its-holder": { make: () => { const outer = new Error("outer"); const inner = new Error("inner"); outer.message = inner; inner.name = outer; return outer; }, said: "<cycle>: inner" },
	"long-message": { make: () => new Error("m".repeat(5000)), said: "m".repeat(5000) },
	"long-name-rejected-message": { make: () => Object.defineProperties(new Error(), { name: { value: LONG_NAME }, message: { value: Promise.reject(new Error("the message's promise rejected")) } }), said: `${LONG_NAME}: <a promise>` },
	"long-name-rejected-detail": { make: () => Object.defineProperties(new Error("m"), { name: { value: LONG_NAME }, detail: { value: { held: [Promise.reject(new Error("the detail's promise rejected"))] } } }), said: `${LONG_NAME}: m` },
	"long-message-rejected-detail": { make: () => Object.defineProperties(new Error(LONG_MESSAGE), { detail: { value: Promise.reject(new Error("the detail's promise beside a long message rejected")) } }), said: LONG_MESSAGE },
	// A Proxy over an error with a long own message whose own `detail` descriptor hands back a fresh object holding a
	// fresh rejected promise on every read, so the diagnostic's own last read makes one more (attempt 6's F2, diagnostic-new).
	"long-message-fresh-detail": { make: () => new Proxy(new Error(LONG_MESSAGE), {
		getOwnPropertyDescriptor(target, key) {
			if (key === "detail") return { configurable: true, enumerable: true, writable: true, value: { held: Promise.reject(new Error("a fresh detail's promise rejected")) } };
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
		ownKeys(target) { return [...Reflect.ownKeys(target), "detail"]; },
	}), said: LONG_MESSAGE },
	"long-name-rejecting-getter": { make: () => Object.defineProperties(new Error(), { name: { value: LONG_NAME }, message: { get() { return Promise.reject(new Error("the message getter's promise rejected")); } } }), said: `${LONG_NAME}: <getter>` },
	// Each reading of its name would give a new error of its kind; the name is inherited, so it is never read.
	"endless-names": { make: () => { class Endless extends Error { get name() { return new Endless("again"); } } return new Endless("first"); }, said: "first" },
});

/** Throws, or gives a rejected promise of, the named error, as a spec's `fails` says. */
const failWith = ({ error, rejects }) => {
	if (rejects) return Promise.reject(CYCLIC_ERRORS[error].make());
	throw CYCLIC_ERRORS[error].make();
};

/** The wordings a scenario's `word` may name, each failing in its own way, besides the fixture's own. */
const WORDINGS = Object.freeze({
	"throws-string": () => { throw "word failed"; },
	"throws-error": () => { throw new Error("word broke"); },
	"returns-number": () => 42,
	"returns-object": () => ({ text: "not text" }),
	"returns-rejecting-promise": () => Promise.reject(new Error("word rejected")),
	"returns-resolving-promise": () => Promise.resolve("too late"),
	"throws-rejecting-promise": () => { throw Promise.reject(new Error("word's thrown promise rejected")); },
	"returns-holding-promise": () => ({ held: Promise.reject(new Error("word's held promise rejected")) }),
	"many-lines": () => "a\n".repeat(200000),
	"throws-proxy-first-read-rejected": () => { throw onceProxy({ message: "word's proxy" }, "message", "first-read", "word's proxy's first descriptor read rejected"); },
	"throws-proxy-trap-throws-rejected": () => { throw onceProxy({ message: "word's proxy" }, "message", "trap-throws", "word's proxy's descriptor trap threw a rejected promise"); },
	"throws-proxy-trap-always-throws-rejected": () => { throw onceProxy({ message: "word's proxy" }, "message", "trap-always-throws", "word's proxy's descriptor trap always throws a rejected promise"); },
	...Object.fromEntries(Object.keys(CYCLIC_ERRORS).map((name) => [`throws-${name}`, () => failWith({ error: name, rejects: false })])),
});

/** The fixture client's prepare, as the scenario's `prepare` says. */
function fixturePrepare(spec, record) {
	const prepare = async ({ deadline, clock, signal, command, flags }, injected) => {
		const calledAt = clock.now();
		record("prepare", { deadline, calledAt, clockInjected: clock === injected, signalIsAbortSignal: signal instanceof AbortSignal, command, flags });
		signal.addEventListener("abort", () => record("prepare-aborted", { at: clock.now() }), { once: true });
		if (spec.decided) record("prepare-decided", { at: calledAt, beforeDeadline: calledAt <= deadline });
		if (spec.untilAbort) await aborted(signal);
		if (spec.afterCallMs !== undefined) await untilOnClock(clock, calledAt + spec.afterCallMs);
		if (spec.afterDeadlineMs !== undefined) await untilOnClock(clock, deadline + spec.afterDeadlineMs);
		if (spec.malformed !== undefined) {
			// Settling late, after an interruption: the malformed result is the async function's, adopted as it settles.
			record("prepare-settled", { at: clock.now(), malformed: spec.malformed });
			return MALFORMED[spec.malformed]();
		}
		if (spec.fails !== undefined) {
			record("prepare-settled", { at: clock.now(), fails: spec.fails });
			return failWith(spec.fails);
		}
		const settle = "settle" in spec ? spec.settle : "ready";
		record("prepare-settled", { at: clock.now(), settle });
		return settleWith(settle);
	};
	if ((spec.malformed === undefined && spec.fails === undefined) || spec.untilAbort) return prepare;
	// A malformed result given, or an error thrown, at once, as the client did it: no async function adopts a thenable first.
	return (request) => {
		record("prepare", { deadline: request.deadline, calledAt: request.clock.now(), command: request.command });
		record("prepare-settled", { at: request.clock.now(), ...(spec.fails === undefined ? { malformed: spec.malformed } : { fails: spec.fails }) });
		return spec.fails === undefined ? MALFORMED[spec.malformed]() : failWith(spec.fails);
	};
}

/** The ending the scenario names for a run, completed with the call's address. */
function endingFor(spec, context, invocation) {
	// A hop's ending, and the whole find's passed bound, name no attempt: a scenario says so with attempt null.
	const ending = { ...spec, invocation, attempt: "attempt" in spec ? spec.attempt : `${invocation}.0000000a`, operation: context.operation };
	if (ending.ending === "not-delivered" && ending.earlierAttemptsUncertain === "repeat") ending.earlierAttemptsUncertain = context.repeat;
	return ending;
}

/** The fixture's run for every command that invokes, as the scenario's `run` says. */
function fixtureRun(spec, record, identities) {
	// A malformed result is returned at once, as the client returned it: no async function adopts a thenable first.
	if (spec.malformed !== undefined || spec.fails !== undefined) return (context) => {
		record("run", { command: context.command, operation: context.operation, flags: context.flags, bound: context.bound, invocation: context.invocation, repeat: context.repeat });
		return spec.fails === undefined ? MALFORMED[spec.malformed]() : failWith(spec.fails);
	};
	return async (context) => {
		record("run", { command: context.command, operation: context.operation, flags: context.flags, bound: context.bound, invocation: context.invocation, repeat: context.repeat, signalIsAbortSignal: context.signal instanceof AbortSignal, frozen: Object.isFrozen(context) });
		context.signal.addEventListener("abort", () => record("run-aborted", { at: performance.now() }), { once: true });
		// A command that makes several calls gives its later calls new identities, none marked a repeat when it changes nothing.
		for (let call = 0; call < (spec.calls ?? 1); call++) {
			const invocation = call === 0 ? context.invocation : identities.next();
			record("call", { invocation, repeat: call === 0 ? context.repeat : false });
		}
		if (spec.throws !== undefined) throw new Error(spec.throws);
		if (spec.returns !== undefined) return spec.returns;
		let ending = spec.ending ?? { ending: "answered", answer: { ok: true } };
		record("run-waiting", {});
		if (spec.untilAbort) {
			await aborted(context.signal);
			ending = spec.abortEnding ?? ending;
		}
		if (spec.afterMs !== undefined) await untilOnClock({ now: () => performance.now() }, performance.now() + spec.afterMs);
		const result = endingFor(ending, context, context.invocation);
		// The whole ending returned, as the call layer would give it, so a test compares the record printed with it.
		record("run-returned", { ending: result.ending, returned: result });
		// An interruption once the ending is given: sent to this very process before run returns it.
		if (spec.selfSignal) process.kill(process.pid, spec.selfSignal);
		return result;
	};
}

/** The fixture program's declaration for a scenario. */
export function fixtureDeclaration(scenario, { clock } = {}) {
	const record = recorder(scenario.record);
	let n = 0;
	const identities = { next: () => `${String(Date.now()).padStart(13, "0")}-${(++n).toString(16).padStart(16, "0")}` };
	const run = fixtureRun(scenario.run ?? {}, record, identities);
	const prepare = scenario.prepare === undefined ? undefined : fixturePrepare(scenario.prepare, record);
	const client = prepare === undefined ? {} : { prepare: (request) => prepare(request, clock) };
	const word = scenario.word !== undefined ? WORDINGS[scenario.word] : (answer, flags) => {
		if (scenario.wordSelfSignal) {
			record("wording", {});
			process.kill(process.pid, scenario.wordSelfSignal);
		}
		return `answer-ok: ${answer?.ok ?? "-"}\nanswer-json: ${JSON.stringify(answer)}\nverbose: ${flags.verbose}`;
	};
	const commands = Object.entries(COMMANDS).map(([name, c]) => ({ name, ...c, run, ...(scenario.plainAnswer ? {} : { word }) }));
	commands.push({ name: "local-echo", local: true, flags: [{ flag: "--message", type: anyText }], run: ({ flags, stdout }) => {
		record("local", { flags });
		stdout(`local: ${flags.message ?? ""}\n`);
		return scenario.localStatus ?? 0;
	} });
	return { name: scenario.name ?? "fixture", settings: SETTINGS, commands, client, callBound: "--timeout", prepareTime: "--connect-timeout" };
}

