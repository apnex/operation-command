/**
 * Reading what the application gives back - what `prepare` and `run` settle to (OC3, OC4). An ending is read
 * by its declared fields, each once, by ordinary property access, so an inherited field, a field that is not
 * enumerable and a getter all count, whatever the object's prototype; no other field is touched; a read that
 * throws ends the reading. Every value read is observed as it is read: a promise met is consumed then.
 * Only an answer or a refusal is copied, as a JSON value, every member kept, each member read once.
 *
 * Every copied object is built by defining own enumerable data properties, so a member named `__proto__`
 * is kept as a member at every depth; and the copy keeps its own stack rather than recursing, so depth alone
 * never overflows the call stack. The pattern is entity-store's and operation-call's json-value.ts, written
 * again here rather than imported (zorg's BL19 records the shared component for later).
 */
import type { JsonValue } from "@apnex/operation-call";

/** How a value settled: to a value, or with an error. */
export type Settled = { readonly value: unknown } | { readonly error: unknown };

/** Defines an own enumerable data property, so a member named `__proto__` is a member like any other. */
export function define(target: object, key: string | number, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** True for an object or a function, whose fields can be read. */
export const isObject = (value: unknown): value is object => (typeof value === "object" && value !== null) || typeof value === "function";

/**
 * Observes a value met: a promise is consumed, so its rejection never escapes, and what it rejects with is
 * observed in turn; anything else is left alone. Promise.prototype.then refuses what is no promise before it
 * runs anything of the value's.
 */
export function observe(value: unknown): void {
	if (!isObject(value)) return;
	try {
		Reflect.apply(Promise.prototype.then, value, [undefined, observe]);
	} catch {
		// No promise, or a promise whose own machinery threw: nothing is left to consume.
	}
}

/**
 * Settles a value as `await` would - a thenable adopted, whatever it resolves with settled in turn - reading
 * each thenable's `then` once. A value thrown, or given as a rejection's reason, is the error outcome; one
 * given or thrown after the outcome is known is observed, so a promise among them is consumed too.
 */
export function settle(value: unknown): Promise<Settled> {
	return new Promise((done) => {
		let finished = false;
		const finish = (outcome: Settled): void => {
			if (!finished) {
				finished = true;
				done(outcome);
			} else if ("error" in outcome) observe(outcome.error);
		};
		const adopt = (item: unknown): void => {
			if (!isObject(item)) return finish({ value: item });
			let then: unknown;
			try {
				then = (item as { readonly then?: unknown }).then;
			} catch (error) {
				return finish({ error });
			}
			if (typeof then !== "function") {
				observe(then);
				return finish({ value: item });
			}
			// Called as a promise job calls it, with the first resolution or rejection taken.
			let called = false;
			const take = (): boolean => !called && (called = true);
			const resolve = (next: unknown): void => {
				if (!take()) observe(next);
				else if (next === item) finish({ error: new TypeError("a thenable resolved with itself") });
				else adopt(next);
			};
			const reject = (error: unknown): void => { if (take()) finish({ error }); else observe(error); };
			void Promise.resolve().then(() => {
				try {
					Reflect.apply(then as (...args: unknown[]) => unknown, item, [resolve, reject]);
				} catch (error) {
					reject(error);
				}
			});
		};
		adopt(value);
	});
}

/** The fields read from a value, by name, or what a read threw, which ended the reading. */
export type Fields = { readonly fields: ReadonlyMap<string, unknown> } | { readonly threw: unknown };

/**
 * Reads the named fields of an object once each, in order, by ordinary property access, each value observed
 * as it is read; a read that throws ends the reading, its thrown value observed.
 */
export function readFields(value: object, names: readonly string[]): Fields {
	const fields = new Map<string, unknown>();
	for (const name of names) {
		let read: unknown;
		try {
			read = (value as { readonly [name: string]: unknown })[name];
		} catch (threw) {
			observe(threw);
			return { threw };
		}
		observe(read);
		fields.set(name, read);
	}
	return { fields };
}

/** A JSON value copied, or why the value is none: a read threw, a value holds itself, or a value is no JSON. */
export type JsonRead =
	| { readonly json: JsonValue }
	| { readonly threw: unknown }
	| { readonly at: string; readonly itself: true }
	| { readonly at: string; readonly value: unknown };

/**
 * Copies a value read as a JSON value: null, booleans, strings and finite numbers as they are, arrays and
 * plain objects - their prototype Object.prototype or null - as copies of their own enumerable members, each
 * member read once and observed as it is read. The copy stops at the first value that is no JSON value or
 * holds itself, or at a read that throws. An object reached by two paths is read once and copied once.
 */
export function readJson(value: unknown, root: string): JsonRead {
	type Step = { readonly read: () => unknown; readonly at: string; readonly store: (copy: JsonValue) => void } | { readonly leave: object };
	const copies = new Map<object, JsonValue>();
	const open = new Set<object>();
	let result: JsonValue = null;
	const steps: Step[] = [{ read: () => value, at: root, store: (copy) => { result = copy; } }];
	while (steps.length > 0) {
		const step = steps.pop() as Step;
		if ("leave" in step) {
			open.delete(step.leave);
			continue;
		}
		const { at, store } = step;
		let item: unknown;
		try {
			item = step.read();
		} catch (threw) {
			observe(threw);
			return { threw };
		}
		observe(item);
		if (item === null || typeof item === "boolean" || typeof item === "string") store(item);
		else if (typeof item === "number" && Number.isFinite(item)) store(item);
		else if (!isObject(item) || typeof item === "function") return { at, value: item };
		else if (open.has(item)) return { at, itself: true };
		else if (copies.has(item)) store(copies.get(item) as JsonValue);
		else {
			let names: (string | number)[];
			let copy: JsonValue[] | { [name: string]: JsonValue };
			try {
				if (Array.isArray(item)) {
					const length: unknown = (item as unknown[]).length;
					// A proxy may claim any length: one no array can have is no JSON array.
					if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > 0xffffffff) return { at, value: item };
					names = Array.from({ length }, (_, i) => i);
					copy = new Array<JsonValue>(length);
				} else {
					const prototype: unknown = Object.getPrototypeOf(item);
					if (prototype !== Object.prototype && prototype !== null) return { at, value: item };
					names = Object.keys(item);
					copy = {};
				}
			} catch (threw) {
				observe(threw);
				return { threw };
			}
			const holder = item;
			const made = copy;
			store(made);
			copies.set(holder, made);
			open.add(holder);
			steps.push({ leave: holder });
			// Members are pushed last first, so they are read in their own order.
			for (let i = names.length - 1; i >= 0; i--) {
				const name = names[i] as string | number;
				steps.push({ read: () => (holder as { readonly [key: string | number]: unknown })[name], at: typeof name === "number" ? `${at}[${name}]` : `${at}.${name}`, store: (c) => { define(made, name, c); } });
			}
		}
	}
	return { json: result };
}
