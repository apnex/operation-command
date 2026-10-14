/**
 * Settling what the application gives back - what `prepare` and `run` return (OC3, OC4; zorg's D54, D55).
 * A native `Promise` is awaited, by attaching reactions through `Promise.prototype.then` itself, so no `then`
 * the application wrote is ever looked up or called; anything else, a non-native thenable included, is the
 * settled value as it is, which the reading that follows (shape-check's `readPlainJson`, operation-call's
 * `readCallEnding`) judges as plain data, running none of its code.
 */

/** How a value settled: to a value, or with an error. */
export type Settled = { readonly value: unknown } | { readonly error: unknown };

/** True for a native promise; a Proxy's trap that throws while asked makes the value no promise. */
function isNativePromise(value: unknown): value is Promise<unknown> {
	if (value === null || typeof value !== "object") return false;
	try {
		return value instanceof Promise;
	} catch {
		return false;
	}
}

/**
 * Settles a value: a native promise awaited, to the value it fulfils with or the reason it rejects with;
 * anything else is its own settled value, never probed for a `then`. Never rejects.
 */
export function settle(value: unknown): Promise<Settled> {
	if (!isNativePromise(value)) return Promise.resolve({ value });
	return new Promise((done) => {
		try {
			Reflect.apply(Promise.prototype.then, value, [(fulfilled: unknown) => done({ value: fulfilled }), (error: unknown) => done({ error })]);
		} catch (error) {
			// A promise whose own `constructor` or `Symbol.species` threw before its reactions were installed.
			done({ error });
		}
	});
}

/** Settles what a call returns, or the error it throws, as an outcome; never rejects. */
export function outcomeOf(call: () => unknown): Promise<Settled> {
	let returned: unknown;
	try {
		returned = call();
	} catch (error) {
		return Promise.resolve({ error });
	}
	return settle(returned);
}
