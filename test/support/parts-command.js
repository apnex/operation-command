#!/usr/bin/env node
// parts-command - the parts program run as a Node process through the process adapter (OC4), its `run` doing
// what the scenario in PT_SCENARIO names and recording what it saw to the scenario's record file:
//   held-callbacks - standard output's write calls back only once released, though `write` returns true;
//                    20 parts of 1 MiB lines, then the held callbacks released and the ending answered.
//   broken-output  - waits for the reader of standard output to go, then passes on 50 parts and answers.
//   memory         - passes on 200000 small parts, measuring the heap after garbage collection at 20000 and at
//                    200000, through the adapter's real writes to a file.
import fs from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { runProcess } from "@apnex/operation-command/process";
import { answerForLine, ending, partsProgram } from "./parts-program.js";

const scenario = JSON.parse(process.env.PT_SCENARIO ?? "{}");
const record = (event, fields = {}) => { if (scenario.record) fs.appendFileSync(scenario.record, `${JSON.stringify({ event, ...fields })}\n`); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToReactions = () => new Promise((resolve) => setImmediate(resolve));

let release = () => undefined;
if (scenario.kind === "held-callbacks") {
	const write = process.stdout.write.bind(process.stdout);
	const held = [];
	let releasing = false;
	release = () => { releasing = true; for (const callback of held.splice(0)) callback(); };
	process.stdout.write = (chunk, encoding, callback) => {
		const done = typeof encoding === "function" ? encoding : callback;
		return write(chunk, (error) => {
			if (releasing) done?.(error);
			else held.push(() => done?.(error));
		});
	};
}

const runs = {
	"held-callbacks": async ({ onPart, signal }) => {
		let aborts = 0;
		signal.addEventListener("abort", () => aborts++);
		for (let n = 1; n <= 20; n++) onPart(answerForLine(1048576, n, "x"));
		onPart({ through: 1, change: null });
		record("parts-passed", { aborted: signal.aborted, aborts });
		release();
		return ending({ ending: "answered", answer: { position: 1 } });
	},
	"broken-output": async ({ onPart }) => {
		await pause(300);
		for (let n = 1; n <= 50; n++) {
			onPart({ n, pad: "x".repeat(65536) });
			await yieldToReactions();
		}
		await pause(100);
		record("parts-passed", {});
		return ending({ ending: "answered", answer: { position: 50 } });
	},
	memory: async ({ onPart }) => {
		v8.setFlagsFromString("--expose-gc");
		const gc = vm.runInNewContext("gc");
		const settle = async () => { for (let i = 0; i < 5; i++) await yieldToReactions(); gc(); gc(); };
		let n = 0;
		const pass = async (count) => {
			for (let i = 0; i < count; i++) {
				onPart({ n: ++n });
				if (n % 5000 === 0) await yieldToReactions();
			}
		};
		await pass(20000);
		await settle();
		const first = process.memoryUsage().heapUsed;
		await pass(180000);
		await settle();
		const last = process.memoryUsage().heapUsed;
		record("heap", { first, last, parts: n });
		return ending({ ending: "answered", answer: { position: n } });
	},
};

runProcess(partsProgram({ run: runs[scenario.kind] }));
