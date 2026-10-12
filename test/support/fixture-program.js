// fixture-program - the fixture application of E19: a program declared to operation-command with settings
// of every type and source, commands that change something and commands that change nothing, groups,
// flags that exclude and require others, and a local command; and a fixture client whose `prepare` and
// whose commands' `run` do what a scenario says, recording what they were given to a file, one JSON object
// per line, so a test reads it without any pipe between the processes.
import fs from "node:fs";
import { untilOnClock } from "./clock-timer.js";

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
	{ flag: "--json", type: { kind: "switch" } },
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
		{ flag: "--id", type: { kind: "string", pattern: "^[0-9a-f]{8}$" } },
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
		{ flag: "--tag", repeats: true, type: { kind: "string", pattern: "^[a-z0-9-]+:[a-z0-9-]+$" } },
		{ flag: "--limit", type: { kind: "integer", min: 1, max: 1000 } },
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

/** What a scenario's `settle` names: a value, or a rejection. */
const settleWith = (spec) => spec !== null && typeof spec === "object" && "reject" in spec ? Promise.reject(new Error(spec.reject)) : Promise.resolve(spec);

/** The fixture client's prepare, as the scenario's `prepare` says. */
function fixturePrepare(spec, record) {
	return async ({ deadline, clock, signal, command, flags }, injected) => {
		const calledAt = clock.now();
		record("prepare", { deadline, calledAt, clockInjected: clock === injected, signalIsAbortSignal: signal instanceof AbortSignal, command, flags });
		signal.addEventListener("abort", () => record("prepare-aborted", { at: clock.now() }), { once: true });
		if (spec.decided) record("prepare-decided", { at: calledAt, beforeDeadline: calledAt <= deadline });
		if (spec.untilAbort) await aborted(signal);
		if (spec.afterCallMs !== undefined) await untilOnClock(clock, calledAt + spec.afterCallMs);
		if (spec.afterDeadlineMs !== undefined) await untilOnClock(clock, deadline + spec.afterDeadlineMs);
		const settle = "settle" in spec ? spec.settle : "ready";
		record("prepare-settled", { at: clock.now(), settle });
		return settleWith(settle);
	};
}

/** The ending the scenario names for a run, completed with the call's address. */
function endingFor(spec, context, invocation) {
	const ending = { ...spec, invocation, attempt: `${invocation}.0000000a`, operation: context.operation };
	if (ending.ending === "not-delivered" && ending.earlierAttemptsUncertain === "repeat") ending.earlierAttemptsUncertain = context.repeat;
	return ending;
}

/** The fixture's run for every command that invokes, as the scenario's `run` says. */
function fixtureRun(spec, record, identities) {
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
		record("run-returned", { ending: result.ending });
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
	const word = (answer, flags) => {
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

