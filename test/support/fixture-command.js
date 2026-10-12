#!/usr/bin/env node
// fixture-command - the fixture application as a command: a Node process running the fixture program under
// operation-command's process adapter. Its scenario is the JSON in OC_FIXTURE_SCENARIO, which names its
// record file; its clock port is offset from performance.now() when the scenario says so, and records its
// first reading, the one taken when the command began reading its arguments.
import { declareProgram } from "@apnex/operation-command";
import { runProcess } from "@apnex/operation-command/process";
import { fixtureDeclaration, recorder } from "./fixture-program.js";

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
runProcess(declareProgram(fixtureDeclaration(scenario, { clock })), { clock });
