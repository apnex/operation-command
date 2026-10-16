// command-reference - OC6 (zorg's D57, Delta 3, D3-E1): a reference of every command, its flags, groups,
// environment variables, defaults and valid values is generated from the declaration, never written beside it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DeclarationError, declareProgram, formatReference } from "@apnex/operation-command";
import { fixtureDeclaration } from "../support/fixture-program.js";

describe("OC6 - command-reference (D3-E1)", () => {
	test("declareProgram(declaration).reference() and formatReference(declaration) generate the same deterministic text ending in a newline, containing every declared part", () => {
		const decl = fixtureDeclaration({});
		const program = declareProgram(decl);
		const ref = program.reference();
		assert.equal(ref, formatReference(decl));
		assert.ok(ref.endsWith("\n"));
		assert.match(ref, /^program: fixture\n/);
		assert.match(ref, /call-bound: --timeout\n/);
		assert.match(ref, /prepare-time: --connect-timeout\n/);
		// Every setting: flag, variable, required or default, repeats, secret, type with valid values.
		assert.match(ref, /--host; type: string \(pattern: \^\[a-z0-9\]\[a-z0-9\.-\]\{0,62\}\$\); variable: FIX_HOST; required/);
		assert.match(ref, /--service; type: string \(pattern: \^\[a-z0-9\]\[a-z0-9-\]\{0,62\}\$\); variable: FIX_SERVICE; default: "store"/);
		assert.match(ref, /--url; type: url \(schemes: ws, wss\); variable: FIX_URL; default: "ws:\/\/127\.0\.0\.1:47100\/agp"/);
		assert.match(ref, /--identity; type: string \([^)]+\); variable: FIX_IDENTITY; required/);
		assert.match(ref, /--token; type: string \([^)]+\); variable: FIX_TOKEN; default: "public"; secret/);
		assert.match(ref, /--timeout; type: duration \(1ms to 24h\); variable: FIX_TIMEOUT; default: "10s"/);
		assert.match(ref, /--retries; type: integer \(0 to 9\); variable: FIX_RETRIES; default: "3"/);
		assert.match(ref, /--label; type: string \([^)]+\); repeats/);
		assert.match(ref, /--verbose; type: switch/);
		// Commands: invoking and local, own flags, relations, groups, and operation-command's own --invocation and --json.
		assert.match(ref, /publish \(operation: create; changes: true\)/);
		assert.match(ref, /read \(operation: read; changes: false\)/);
		assert.match(ref, /update \(operation: update; changes: true\)/);
		assert.match(ref, /local-echo \(local\)/);
		assert.match(ref, /group \(exactly-one\): --name, --id/);
		assert.match(ref, /group \(at-least-one\): --rename, --summary, --tag, --no-tags/);
		assert.match(ref, /excludes: --no-tags/);
		assert.match(ref, /requires: --reason/);
		assert.match(ref, /--invocation; operation-command: invocation identity/);
		assert.match(ref, /--json; type: switch; operation-command: JSON ending output/);
	});

	test("changing any declared part - name, description, setting, variable, default, required, repeats, secret, type, bound, pattern, command, operation, changes, local, flag relation or group - changes the generated reference", () => {
		const base = () => ({
			name: "zorg",
			description: "Knowledge pointer command.",
			settings: [
				{ flag: "--hub", variable: "ZORG_HUB", required: true, type: { kind: "url", schemes: ["ws"], pattern: "ws://[^/]+:[0-9]+/.*" }, description: "hub address" },
				{ flag: "--timeout", variable: "ZORG_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" }, description: "call bound" },
				{ flag: "--wait", variable: "ZORG_WAIT", default: "5s", type: { kind: "duration", min: "0ms", max: "1h" }, description: "prepare time" },
				{ flag: "--limit", default: "10", repeats: false, secret: false, type: { kind: "integer", min: 1, max: 100 }, description: "max items" },
			],
			commands: [
				{
					name: "update",
					operation: "update",
					changes: true,
					description: "Update an entry.",
					flags: [
						{ flag: "--name", type: { kind: "string", pattern: "[a-z]+" }, description: "entry name" },
						{ flag: "--id", type: { kind: "string", pattern: "e[0-9]+" }, description: "entry id" },
						{ flag: "--tag", repeats: true, excludes: ["--no-tags"], type: { kind: "string", pattern: "[a-z]+:[a-z]+" }, description: "tag" },
						{ flag: "--no-tags", excludes: ["--tag"], requires: ["--reason"], type: { kind: "switch" }, description: "clear tags" },
						{ flag: "--reason", type: { kind: "string", pattern: ".+" }, description: "why" },
					],
					groups: [
						{ exactlyOne: ["--name", "--id"] },
						{ atLeastOne: ["--tag", "--no-tags"] },
					],
					run: () => ({ ending: "answered", invocation: "1791540000000-0123456789abcdef", attempt: "1791540000000-0123456789abcdef.00000001", operation: "update", answer: null }),
				},
				{
					name: "proxy",
					local: true,
					description: "Run local proxy.",
					run: () => 0,
				},
			],
			client: {},
			callBound: "--timeout",
			prepareTime: "--wait",
		});
		const baseline = formatReference(base());
		const mutations = [
			(d) => { d.name = "other"; },
			(d) => { d.description = "Other description."; },
			(d) => { d.settings[0].flag = "--server"; },
			(d) => { d.settings[0].variable = "OTHER_HUB"; },
			(d) => { delete d.settings[0].required; d.settings[0].default = "ws://h:1/"; },
			(d) => { d.settings[0].type = { kind: "url", schemes: ["ws", "wss"], pattern: "ws://[^/]+:[0-9]+/.*" }; },
			(d) => { d.settings[0].type = { kind: "url", schemes: ["ws"], pattern: "ws://[^/]+:[1-9][0-9]*/.*" }; },
			(d) => { d.settings[0].description = "different setting description"; },
			(d) => { d.settings[3].repeats = true; },
			(d) => { d.settings[3].secret = true; },
			(d) => { d.settings[3].type = { kind: "integer", min: 2, max: 100 }; },
			(d) => { d.settings[3].type = { kind: "integer", min: 1, max: 200 }; },
			(d) => { d.settings[1].type = { kind: "duration", min: "2ms", max: "24h" }; },
			(d) => { d.commands[0].name = "edit"; },
			(d) => { d.commands[0].operation = "edit"; },
			(d) => { d.commands[0].changes = false; },
			(d) => { d.commands[0].description = "Different command description."; },
			(d) => { d.commands[0].flags[0].type = { kind: "string", pattern: "[a-z0-9]+" }; },
			(d) => { d.commands[0].flags[0].description = "Different flag description."; },
			(d) => { d.commands[0].flags[2].repeats = false; },
			(d) => { d.commands[0].flags[3].requires = []; },
			(d) => { d.commands[0].groups = [{ exactlyOne: ["--name", "--id"] }]; },
			(d) => { d.commands[1].description = "Different local description."; },
		];
		for (const [i, mutate] of mutations.entries()) {
			const copy = base();
			mutate(copy);
			assert.notEqual(formatReference(copy), baseline, `mutation ${i} changes the generated reference`);
		}
		// Mutating the declaration object after declareProgram does not change program.reference().
		const mutable = base();
		const program = declareProgram(mutable);
		mutable.name = "mutated";
		mutable.settings.length = 0;
		assert.equal(program.reference(), baseline);
	});

	test("formatReference validates the declaration and throws DeclarationError on any invalid declaration", () => {
		assert.throws(() => formatReference(null), (e) => e instanceof DeclarationError && e.rule === "program-form");
		assert.throws(() => formatReference({ name: "x", settings: [], commands: [], client: {} }), (e) => e instanceof DeclarationError && e.rule === "program-form");
	});
});
