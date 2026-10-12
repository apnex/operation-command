// structural-ending - endings built as the caller interface's types allow, not only as plain objects with
// enumerable members (OC3, OC4): a frozen class instance, a frozen plain object whose `ending` is not
// enumerable, and objects whose fields are getters - inherited from a custom prototype, own and not
// enumerable, or own on a class instance - each getter counting its reads. Fields the reading must never
// touch are getters too, recording a touch and throwing, so touching one is seen twice over.

/** The fields each kind of ending declares, besides `ending` and the address every ending declares. */
export const KIND_FIELDS = Object.freeze({
	answered: ["answer"],
	refused: ["refusal"],
	"not-delivered": ["agpCode", "proxyCode", "earlierAttemptsUncertain"],
	unknown: ["reason", "agpCode", "deliveryReport"],
});

/** The address every ending declares. */
export const ADDRESS = Object.freeze({ invocation: "1791540000000-1234567890abcdef", attempt: "1791540000000-1234567890abcdef.0123abcd", operation: "create" });

/** A field another kind declares, for each kind: present on the ending, never to be read. */
export const OTHER_KIND_FIELD = Object.freeze({ answered: "refusal", refused: "answer", "not-delivered": "reason", unknown: "earlierAttemptsUncertain" });

/** The getter forms, each counting reads. */
export const GETTER_FORMS = Object.freeze(["inherited", "not-enumerable", "own-getters"]);

/** The data forms, nothing to count. */
export const DATA_FORMS = Object.freeze(["class-instance", "ending-not-enumerable"]);

class Ending {}

/**
 * Builds `fields` in a getter form, each field a getter counting its reads in `reads`, and each name in
 * `untouched` a getter that records itself in `touched` and throws.
 */
export function gettersEnding(fields, form, untouched) {
	const reads = {};
	const touched = [];
	const enumerable = form !== "not-enumerable";
	const descriptors = {};
	for (const [name, value] of Object.entries(fields)) descriptors[name] = { enumerable, get() { reads[name] = (reads[name] ?? 0) + 1; return value; } };
	for (const name of untouched) descriptors[name] = { enumerable, get() { touched.push(name); throw new Error(`the field ${name} was touched`); } };
	let value;
	if (form === "inherited") value = Object.freeze(Object.create(Object.freeze(Object.defineProperties(new Ending(), descriptors))));
	else if (form === "not-enumerable") value = Object.freeze(Object.defineProperties({}, descriptors));
	else value = Object.freeze(Object.defineProperties(new Ending(), descriptors));
	return { value, reads, touched };
}

/** Builds `fields` in a data form: a frozen class instance, or a frozen plain object whose `ending` is not enumerable. */
export function dataEnding(fields, form) {
	if (form === "class-instance") return Object.freeze(Object.assign(new Ending(), fields));
	return Object.freeze(Object.defineProperty({ ...fields }, "ending", { value: fields.ending, enumerable: false }));
}

/** Wraps `fields` with one field a getter that throws, or that gives a promise rejecting, the rest data; with whatever it made. */
export function oneGetterEnding(fields, name, gives) {
	const made = [];
	const descriptors = { [name]: { enumerable: true, get() {
		const error = new Error(`the ${name} getter ${gives === "throws" ? "threw" : "gave a rejected promise"}`);
		if (gives === "throws") throw error;
		const promise = Promise.reject(error);
		made.push(promise);
		return promise;
	} } };
	const rest = { ...fields };
	delete rest[name];
	return { value: Object.freeze(Object.defineProperties(Object.assign(new Ending(), rest), descriptors)), made };
}
