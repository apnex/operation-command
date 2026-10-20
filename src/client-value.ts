/**
 * Settling what the application gives back - what `prepare` and `run` return (OC3, OC4; zorg's D54, D55).
 * A native `Promise` is awaited, by attaching reactions through `Promise.prototype.then` itself, so no `then`
 * the application wrote is ever looked up or called; anything else, a non-native thenable included, is the
 * settled value as it is, which the reading that follows (shape-check's `readPlainJson`, operation-call's
 * `readCallEnding`) judges as plain data, running none of its code.
 */
import { observePromises } from "@apnex/shape-check";

/** How a value settled: to a value, or with an error. */
export type Settled = { readonly value: unknown } | { readonly error: unknown };

/**
 * Settles a value: a native promise awaited, to the value it fulfils with or the reason it rejects with;
 * anything else is its own settled value, never probed for a `then`. A Proxy's trap that throws while the
 * value is asked whether it is a native promise settles it with that error at once, the value never read as
 * though nothing threw; what was thrown, the value, and an error attaching or rejecting have their native
 * promises observed. Never rejects.
 *
 * `observed`, when given, is called once, at the moment the settling is observed: at once for anything but a
 * native promise, and otherwise inside the reaction attached to the promise here, before anything awaiting
 * the result runs (OC4: a parts command's printing closes then).
 */
export function settle(value: unknown, observed?: () => void): Promise<Settled> {
	if (value === null || typeof value !== "object") {
		observed?.();
		return Promise.resolve({ value });
	}
	try {
		if (!(value instanceof Promise)) {
			observed?.();
			return Promise.resolve({ value });
		}
	} catch (error) {
		observePromises(error);
		observePromises(value);
		observed?.();
		return Promise.resolve({ error });
	}
	return new Promise((done) => {
		try {
			Reflect.apply(Promise.prototype.then, value, [
				(fulfilled: unknown) => {
					observed?.();
					done({ value: fulfilled });
				},
				(error: unknown) => {
					observed?.();
					observePromises(error);
					done({ error });
				},
			]);
		} catch (error) {
			// A promise whose own `constructor` or `Symbol.species` threw before its reactions were installed.
			observed?.();
			observePromises(error);
			done({ error });
		}
	});
}

/** Settles what a call returns, or the error it throws, as an outcome; never rejects. `observed` as `settle` says. */
export function outcomeOf(call: () => unknown, observed?: () => void): Promise<Settled> {
	let returned: unknown;
	try {
		returned = call();
	} catch (error) {
		observed?.();
		return Promise.resolve({ error });
	}
	return settle(returned, observed);
}
