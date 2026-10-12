// held-write - holds this process's standard output until the process has itself received each of the
// signals named, so a test establishes that an interruption sent after the ending was given, or during its
// printing, reached the process while the command held its signals and before it exited. Each receipt is
// recorded with the number of listeners the signal had, so a test sees that the process adapter's own
// handler was among them; a signal sent during the held write is sent from within it.

/** Holds standard output's writes until each signal in `until` was received; `duringWrite` sends one from within the first write. */
export function holdStdoutUntilSignals({ until, duringWrite }, record) {
	const waiting = new Set(until);
	const held = [];
	for (const signal of until) {
		process.on(signal, () => {
			record("signal-received", { signal, listeners: process.listenerCount(signal) });
			waiting.delete(signal);
			if (waiting.size === 0) for (const release of held.splice(0)) release();
		});
	}
	const write = process.stdout.write.bind(process.stdout);
	let sent = false;
	process.stdout.write = (chunk, encoding, callback) => {
		const done = typeof encoding === "function" ? encoding : callback;
		record("write-held", { pending: [...waiting] });
		const release = () => {
			record("write-released", {});
			write(chunk, done);
		};
		if (waiting.size === 0) release();
		else held.push(release);
		if (duringWrite !== undefined && !sent) {
			sent = true;
			record("signal-sent-during-write", { signal: duringWrite });
			process.kill(process.pid, duringWrite);
		}
		return true;
	};
}
