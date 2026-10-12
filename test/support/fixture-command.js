#!/usr/bin/env node
// fixture-command - the fixture application as a command: a Node process running the fixture program under
// operation-command's process adapter. Its scenario is the JSON in OC_FIXTURE_SCENARIO, which names its
// record file; its clock port is offset from performance.now() when the scenario says so, and records its
// first reading, the one taken when the command began reading its arguments. A scenario may hold standard
// output until the process received the signals it names (held-write.js); and one may interrupt the command
// while its arguments are read, which no signal can do to code that runs without yielding, so it runs the
// program on an interruption source that the reading of its first argument fires, writing what the command
// prints to the process's own two streams and exiting with its status.
import fs from "node:fs";
import { declareProgram } from "@apnex/operation-command";
import { runProcess } from "@apnex/operation-command/process";
import { fixtureDeclaration, recorder } from "./fixture-program.js";
import { holdStdoutUntilSignals } from "./held-write.js";

const scenario = JSON.parse(process.env.OC_FIXTURE_SCENARIO ?? "{}");
const record = recorder(scenario.record);
let first = true;
const offset = scenario.clockOffset ?? 0;
const clock = Object.freeze({
	now() {
		const now = performance.now() + offset;
		if (first) record("clock-began", { at: now });
		first = false;
		return now;
	},
});
if (scenario.holdWrite !== undefined) holdStdoutUntilSignals(scenario.holdWrite, record);
const program = declareProgram(fixtureDeclaration(scenario, { clock }));
if (scenario.interruptWhileReading) {
	const listeners = new Set();
	const args = process.argv.slice(2);
	const name = args[0];
	let fired = false;
	Object.defineProperty(args, 0, {
		enumerable: true,
		get() {
			if (!fired) {
				fired = true;
				record("interrupted-while-reading", { listeners: listeners.size });
				for (const listener of [...listeners]) listener();
			}
			return name;
		},
	});
	const interruptions = { subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
	const status = await program.run({ args, env: process.env, stdout: (t) => fs.writeSync(1, t), stderr: (t) => fs.writeSync(2, t), interruptions, clock });
	process.exit(status);
} else runProcess(program, { clock });
