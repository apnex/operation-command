#!/usr/bin/env node
// integrated-command - the fixture application of OC7 as a command: its client is operation-call's real
// caller over AGP's production in-process carrier (@agp/transport-loopback), in this one process with two
// host nodes, host-a and host-b, each serving the services `store` and `other` through operation-call's host
// half. The client's prepare builds and starts the nodes and waits, within its deadline, until every route
// is ready; each command's run builds its input from its flags and invokes through the caller. Every request
// an operation receives is recorded - node, service, operation, input, invocation, attempt and the principal
// the host's evidence names - in the scenario's record file, with what the client was given.
import { createNode } from "@agp/node";
import { createLoopbackFabric } from "@agp/transport-loopback";
import { createCaller, createOperationHost } from "@apnex/operation-call";
import { declareProgram } from "@apnex/operation-command";
import { runProcess } from "@apnex/operation-command/process";
import { untilOnClock } from "./clock-timer.js";
import { recorder } from "./fixture-program.js";

const scenario = JSON.parse(process.env.OC_FIXTURE_SCENARIO ?? "{}");
const record = recorder(scenario.record);
const NAME = "^[a-z0-9][a-z0-9.-]{0,62}$";
const SERVICES = ["store", "other"];
const OPERATIONS = ["create", "read", "find"];
const SHAPE = { $schema: "urn:apnex:shape-check:dialect:1" };
const REPLY = "operation-call/replies";
/** The refusal an operation declines with when the scenario says so (zorg's D21). */
const REFUSAL = { part: "fixture", code: "declined", what: "The operation declined.", why: "The scenario says so.", fix: "Change the scenario.", details: { scenario: true } };
const turn = () => new Promise((resolve) => setImmediate(resolve));
/** What each operation does with a request, as the scenario says: answer, stay silent, or answer after a delay. */
const behaviour = (operation) => scenario.operations?.[operation] ?? { mode: "answer" };

/** The in-process topology: a fabric, two hosts serving both services, and the caller's node named for its identity. */
async function openTopology(identity) {
	const fabricId = `operation-command-${process.pid}`;
	const fabric = createLoopbackFabric({ fabricId, limits: {
		maxTransports: 8, maxListeners: 8, maxPendingAcquisitions: 8, maxActiveChannels: 8, maxPacketBytes: 16_777_216,
		maxBufferedPacketsPerChannel: 1_024, maxBufferedBytesPerChannel: 67_108_864, maxQueuedPacketsTotal: 65_536,
		maxQueuedBytesTotal: 268_435_456, maxPendingSendBytesTotal: 17_179_869_184,
	} });
	const port = (name, listen, targets) => fabric.createTransport({ transportName: name, capabilities: { listen, connect: targets.length > 0 } }).createPort({
		listeners: new Map(listen ? [["listen", { fabricId, address: name }]] : []),
		targets: new Map(targets.map((t) => [t, { fabricId, address: t }])),
	});
	const capacity = { maxSessions: 4, maxPendingHandshakes: 4 };
	const hosts = ["host-a", "host-b"].map((nodeId) => ({ nodeId, node: createNode({ nodeId, listen: { transportRef: "listen" }, capacity, timers: { holdTimeMs: 0 }, disposition: { debounceMs: 0 } }, { transport: port(nodeId, true, []) }) }));
	const callerNode = createNode({ nodeId: identity, capacity, timers: { holdTimeMs: 0 }, disposition: { debounceMs: 0 }, peers: hosts.map((h) => ({ adjacencyId: h.nodeId, expectedNodeId: h.nodeId, transportRef: h.nodeId, reconnect: { initialDelayMs: 10, maximumDelayMs: 10 } })) }, { transport: port(identity, false, hosts.map((h) => h.nodeId)) });
	for (const h of hosts) {
		await h.node.start();
		for (const service of SERVICES) {
			const opened = await createOperationHost(h.node, { service, evidence: (delivery) => ({ principal: delivery.source.originNodeId }) });
			for (const operation of OPERATIONS) {
				await opened.host.declare({ name: operation, input: SHAPE, answers: "whole" }, async (input, context) => {
					record("received", { node: h.nodeId, service, operation, input, invocation: context.invocation, attempt: context.attempt, principal: context.evidence.principal });
					const how = behaviour(operation);
					if (how.mode === "silent") return new Promise(() => undefined);
					if (how.mode === "refuse") return { outcome: "refused", refusal: REFUSAL };
					if (how.mode === "delayed") await untilOnClock({ now: () => performance.now() }, performance.now() + how.ms);
					return { outcome: "answered", answer: { node: h.nodeId, service, operation, input } };
				});
			}
		}
	}
	await callerNode.start();
	const caller = await createCaller({ node: callerNode });
	const acked = (node, endpoint, remote) => node.operations.routeExports().items.some((r) => r.endpoint === endpoint && r.remoteNodeId === remote && r.state === "acked");
	const routed = (hostId, endpoint) => callerNode.operations.routes().candidates.some((r) => r.endpoint === endpoint && r.originNodeId === hostId);
	const ready = () => hosts.every((h) => acked(callerNode, REPLY, h.nodeId) && SERVICES.every((s) => OPERATIONS.every((o) => routed(h.nodeId, `${s}/${o}`) && acked(h.node, `${s}/${o}`, identity))));
	return { caller, callerNode, ready };
}

let topology;
/** The client: prepare opens the topology and waits for it, until its deadline on the clock port it is given. */
const client = {
	async prepare({ deadline, clock, signal, flags }) {
		record("prepare", { deadline });
		topology = await openTopology(flags.identity);
		// Ready only when observed ready at or before the deadline on the clock port given; once that clock reads
		// past the deadline with the client not ready, the timeout has won (OC3), and no later readiness counts.
		for (;;) {
			const now = clock.now();
			if (topology.ready() && now <= deadline) return "ready";
			if (now > deadline || signal.aborted) return { ending: "not-delivered", agpCode: null, proxyCode: null };
			await turn();
		}
	},
};

/** Invokes one call through the real caller, holding the caller node's executor first when the scenario says. */
async function invoke(flags, call) {
	if (!scenario.holdSend) return topology.caller.invoke({ host: flags.host, service: flags.service, ...call });
	const blocker = Promise.withResolvers();
	const held = topology.callerNode.executor.run(() => blocker.promise);
	const ending = topology.caller.invoke({ host: flags.host, service: flags.service, ...call });
	for (let i = 0; i < 20; i++) await turn();
	record("send-held", {});
	const result = await ending;
	// Released and drained, so a request AGP had kept would arrive before the command reports.
	blocker.resolve();
	await held;
	await topology.callerNode.executor.quiesce();
	await untilOnClock({ now: () => performance.now() }, performance.now() + 300);
	record("released", {});
	return result;
}

const common = (flags) => ({ token: flags.token, verbose: flags.verbose });
/** Each command's run: build the input from the flags and invoke through the client. */
const runWith = (input, pages = 1) => async ({ flags, bound, invocation, repeat, signal, operation }) => {
	record("run", { invocation, repeat, bound });
	const started = performance.now();
	let ending = await invoke(flags, { operation, input: input(flags, 1), bound, invocation, repeat, signal });
	const answers = [];
	for (let page = 2; ending.ending === "answered" && page <= pages; page++) {
		answers.push(ending.answer);
		const left = Math.max(1, Math.floor(bound - (performance.now() - started)));
		ending = await invoke(flags, { operation, input: input(flags, page), bound: left, invocation: topology.caller.newInvocation(), repeat: false, signal });
	}
	if (ending.ending === "answered" && pages > 1) ending = { ...ending, answer: { pages: [...answers, ending.answer] } };
	if (scenario.selfSignal) process.kill(process.pid, scenario.selfSignal);
	return ending;
};

const anyText = { kind: "string", pattern: "^[\\s\\S]*$" };
const tag = { kind: "string", pattern: "^[a-z0-9-]+:[a-z0-9-]+$" };
const declaration = {
	name: scenario.name ?? "integrated",
	settings: [
		{ flag: "--host", variable: "FIX_HOST", required: true, type: { kind: "string", pattern: NAME } },
		{ flag: "--service", variable: "FIX_SERVICE", default: "store", type: { kind: "string", pattern: NAME } },
		{ flag: "--identity", variable: "FIX_IDENTITY", required: true, type: { kind: "string", pattern: NAME } },
		{ flag: "--token", variable: "FIX_TOKEN", default: "public", secret: true, type: { kind: "string", pattern: "^[A-Za-z0-9]+$" } },
		{ flag: "--timeout", variable: "FIX_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" } },
		{ flag: "--connect-timeout", variable: "FIX_CONNECT_TIMEOUT", default: "10s", type: { kind: "duration", min: "1ms", max: "24h" } },
		{ flag: "--verbose", type: { kind: "switch" } },
		{ flag: "--json", type: { kind: "switch" } },
	],
	commands: [
		{ name: "publish", operation: "create", changes: true, flags: [{ flag: "--name", required: true, type: { kind: "string", pattern: NAME } }, { flag: "--summary", required: true, type: anyText }, { flag: "--tag", repeats: true, type: tag }],
			run: runWith((f) => ({ name: f.name, summary: f.summary, tags: f.tag ?? [], ...common(f) })) },
		{ name: "read", operation: "read", changes: false, flags: [{ flag: "--name", type: { kind: "string", pattern: NAME } }, { flag: "--id", type: { kind: "string", pattern: "^[0-9a-f]{8}$" } }], groups: [{ exactlyOne: ["--name", "--id"] }],
			run: runWith((f) => ({ ...(f.name === undefined ? { id: f.id } : { name: f.name }), ...common(f) })) },
		{ name: "find", operation: "find", changes: false, flags: [{ flag: "--tag", repeats: true, type: tag }],
			run: runWith((f, page) => ({ tags: f.tag ?? [], page, ...common(f) }), 2) },
	],
	client,
	callBound: "--timeout",
	prepareTime: "--connect-timeout",
};
runProcess(declareProgram(declaration));
