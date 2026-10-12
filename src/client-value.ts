/**
 * What the application gives back - what `prepare` settles to, what `run` returns, what `word` returns or
 * throws - read once (OC3, OC4). Each field of such a value is read exactly once, into a snapshot of plain
 * copies, and each value read is observed as it is read: a promise met is consumed at that moment, and a
 * value a getter throws is read in turn, so a promise thrown is consumed too. Everything decided afterwards -
 * whether a value is an ending, its record, a diagnostic - is decided from the snapshot, which runs nothing
 * of the application's, so no getter runs twice and nothing read can change or throw later.
 *
 * Every copied object is built by defining own enumerable data properties, so a member named `__proto__`
 * is kept as a member at every depth; and the walk keeps its own stack rather than recursing, so depth
 * alone never overflows the call stack. The pattern is entity-store's and operation-call's json-value.ts,
 * written again here rather than imported (zorg's BL19 records the shared component for later).
 */

/** What stands in a snapshot where the value read was no JSON value, or where reading it threw. */
export class Odd {
	/** For `threw`, what was thrown, as read. */
	thrown: Snapshot = null;
	/** For `error`, its name and message, as read. */
	name: Snapshot = null;
	message: Snapshot = null;
	constructor(
		readonly kind: "non-finite" | "bigint" | "undefined" | "symbol" | "function" | "promise" | "error" | "object" | "itself" | "threw",
		/** For a non-finite number, a BigInt and undefined, how it is written. */
		readonly text = "",
	) {}
}

/** A value as it was read: JSON values as plain copies, and an Odd wherever there was anything else. */
export type Snapshot = null | boolean | number | string | Odd | Snapshot[] | { [name: string]: Snapshot };

/** The `then` already read from a value, so reading the value never reads it again. */
export interface ReadThen {
	readonly holder: object;
	readonly then: unknown;
}

/** How a value settled: to a value, with the `then` read from it if it is an object, or with an error. */
export type Settled = { readonly value: unknown; readonly then?: ReadThen } | { readonly error: unknown };

const ignore = (): void => undefined;

/** Defines an own enumerable data property, so a member named `__proto__` is a member like any other. */
export function define(target: object, key: string | number, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Settles a value as `await` would - a thenable adopted, whatever it resolves with settled in turn - but
 * reads each thenable's `then` once, and gives the `then` read from the value it settles to, so reading
 * that value does not read it again. A value thrown, or given as a rejection's reason, is the error outcome;
 * one given or thrown after the outcome is known is read at once, so a promise among them is consumed too.
 */
export function settle(value: unknown, known?: ReadThen): Promise<Settled> {
	return new Promise((done) => {
		let finished = false;
		const finish = (outcome: Settled): void => {
			if (!finished) {
				finished = true;
				done(outcome);
			} else if ("error" in outcome) readOnce(outcome.error);
		};
		const adopt = (item: unknown, given?: ReadThen): void => {
			if (item === null || (typeof item !== "object" && typeof item !== "function")) return finish({ value: item });
			let then: unknown;
			if (given !== undefined && given.holder === item) then = given.then;
			else {
				try {
					then = (item as { readonly then?: unknown }).then;
				} catch (error) {
					return finish({ error });
				}
			}
			if (typeof then !== "function") return finish({ value: item, then: { holder: item, then } });
			// Called as a promise job calls it, with the first resolution or rejection taken.
			let called = false;
			const take = (): boolean => !called && (called = true);
			const resolve = (next: unknown): void => {
				if (!take()) readOnce(next);
				else if (next === item) finish({ error: new TypeError("a thenable resolved with itself") });
				else adopt(next);
			};
			const reject = (error: unknown): void => { if (take()) finish({ error }); else readOnce(error); };
			void Promise.resolve().then(() => {
				try {
					Reflect.apply(then as (...args: unknown[]) => unknown, item, [resolve, reject]);
				} catch (error) {
					reject(error);
				}
			});
		};
		adopt(value, known);
	});
}

/** The prototype chain from `first` holds `wanted`; walked from a prototype already read. */
function inherits(first: object | null, wanted: object): boolean {
	for (let p = first; p !== null; p = Object.getPrototypeOf(p) as object | null) if (p === wanted) return true;
	return false;
}

type Shape = "function" | "array" | "plain" | "error" | "promise" | "object";

/**
 * Reads a value once, whole: null, booleans, strings and finite numbers as they are, arrays and plain
 * objects as copies of their members, each member read once. Anything else is an Odd, observed as it is
 * met: a promise, a function or an object of a class is consumed - its `then` read once and, if callable,
 * called as a promise job would call it - and an error's name and message are read once for a diagnostic.
 * A member whose reading throws is an Odd holding what was thrown, which is read the same way. An object
 * reached by more than one path is read the first time only; one that holds itself is an Odd there.
 * `known` is a `then` already read from the value, as settling it read it.
 */
export function readOnce(value: unknown, known?: ReadThen): Snapshot {
	interface Slot { readonly value: unknown; readonly store: (copy: Snapshot) => void }
	interface Exit { readonly item: object; readonly copy: Snapshot; readonly depth: number }
	let result: Snapshot = null;
	const stack: Slot[] = [{ value, store: (copy) => { result = copy; } }];
	// The `then` settling read is observed whether or not it is among the members read.
	if (known !== undefined) stack.unshift({ value: known.then, store: ignore });
	const open = new Set<object>();
	const done = new Map<object, Snapshot>();
	const exits: Exit[] = [];
	/** Reads one member of `item` once; when the reading throws, an Odd holding what was thrown. */
	const member = (item: object, key: string | number, store: (copy: Snapshot) => void): void => {
		if (known !== undefined && item === known.holder && key === "then") return void stack.push({ value: known.then, store });
		let read: unknown;
		try {
			read = (item as { readonly [key: string | number]: unknown })[key];
		} catch (error) {
			const odd = new Odd("threw");
			store(odd);
			return void stack.push({ value: error, store: (copy) => { odd.thrown = copy; } });
		}
		stack.push({ value: read, store });
	};
	/** Consumes what may be a promise or a thenable: its `then` read once, and called if it is a function. */
	const consume = (item: object): void => {
		let then: unknown;
		if (known !== undefined && item === known.holder) then = known.then;
		else {
			try {
				then = (item as { readonly then?: unknown }).then;
			} catch (error) {
				return void stack.push({ value: error, store: ignore });
			}
		}
		if (typeof then !== "function") return void stack.push({ value: then, store: ignore });
		void settle(item, { holder: item, then }).then((outcome) => { if ("error" in outcome) readOnce(outcome.error); });
	};
	while (stack.length > 0) {
		while (exits.length > 0 && (exits.at(-1) as Exit).depth >= stack.length) {
			const exit = exits.pop() as Exit;
			open.delete(exit.item);
			done.set(exit.item, exit.copy);
		}
		const { value: item, store } = stack.pop() as Slot;
		if (item === null || typeof item === "boolean" || typeof item === "string") store(item);
		else if (typeof item === "number") store(Number.isFinite(item) ? item : new Odd("non-finite", String(item)));
		else if (typeof item === "bigint") store(new Odd("bigint", `${item}n`));
		else if (typeof item === "undefined") store(new Odd("undefined", "undefined"));
		else if (typeof item === "symbol") store(new Odd("symbol"));
		else if (done.has(item)) store(done.get(item) as Snapshot);
		else if (open.has(item)) store(new Odd("itself"));
		else {
			// Everything that may throw - a proxy's traps - is read before anything is stored or pushed.
			let shape: Shape;
			let length = 0;
			let keys: string[] = [];
			try {
				if (typeof item === "function") shape = "function";
				else if (Array.isArray(item)) {
					const read: unknown = (item as unknown[]).length;
					// A proxy may claim any length: one no array can have is no JSON array.
					if (typeof read === "number" && Number.isInteger(read) && read >= 0 && read <= 0xffffffff) {
						shape = "array";
						length = read;
					} else shape = "object";
				} else {
					const prototype = Object.getPrototypeOf(item) as object | null;
					if (prototype === Object.prototype || prototype === null) {
						shape = "plain";
						keys = Object.keys(item);
					} else shape = inherits(prototype, Error.prototype) ? "error" : inherits(prototype, Promise.prototype) ? "promise" : "object";
				}
			} catch (error) {
				// Its structure could not be read: what was thrown is read in turn.
				const odd = new Odd("threw");
				store(odd);
				done.set(item, odd);
				stack.push({ value: error, store: (copy) => { odd.thrown = copy; } });
				continue;
			}
			if (shape === "array" || shape === "plain") {
				const copy: Snapshot[] | { [name: string]: Snapshot } = shape === "array" ? new Array<Snapshot>(length) : {};
				store(copy);
				open.add(item);
				exits.push({ item, copy, depth: stack.length });
				// Members are pushed last first, so they are read in their own order.
				if (shape === "array") for (let i = length - 1; i >= 0; i--) member(item, i, (c) => { define(copy, i, c); });
				else for (let i = keys.length - 1; i >= 0; i--) member(item, keys[i] as string, (c) => { define(copy, keys[i] as string, c); });
				continue;
			}
			const odd = new Odd(shape);
			store(odd);
			done.set(item, odd);
			consume(item);
			if (shape === "error") {
				member(item, "message", (c) => { odd.message = c; });
				member(item, "name", (c) => { odd.name = c; });
			}
		}
	}
	return result;
}
