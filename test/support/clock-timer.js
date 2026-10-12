// clock-timer - a timer on a clock port: a timer's waking is not its deadline (zorg's target, EM12), so on
// every waking the clock is read and, while the deadline has not passed on it, the timer is set again for
// the time remaining. Every timer the tests and their fixtures arm against a clock port is armed here.

/** Calls `callback` once `clock.now()` reads past `due`; returns a function that cancels it. */
export function afterOnClock(clock, due, callback) {
	let handle;
	let cancelled = false;
	const wake = () => {
		if (cancelled) return;
		const left = due - clock.now();
		if (left >= 0) handle = setTimeout(wake, Math.max(1, Math.ceil(left)));
		else callback();
	};
	wake();
	return () => {
		cancelled = true;
		clearTimeout(handle);
	};
}

/** A promise that settles once `clock.now()` reads past `due`. */
export function untilOnClock(clock, due) {
	return new Promise((resolve) => afterOnClock(clock, due, resolve));
}

/** The real clock the tests measure margins on. */
export const realClock = Object.freeze({ now: () => performance.now() });

/** A promise that settles once `ms` milliseconds have passed on the real clock. */
export function sleep(ms) {
	return untilOnClock(realClock, realClock.now() + ms);
}

/** Rejects when a promise has not settled within `ms` of the real clock, so a failing case fails rather than hangs. */
export function within(promise, what, ms = 30_000) {
	let cancel;
	const late = new Promise((_resolve, reject) => { cancel = afterOnClock(realClock, realClock.now() + ms, () => reject(new Error(`${what} did not settle within ${ms} ms`))); });
	return Promise.race([promise, late]).finally(() => cancel());
}
