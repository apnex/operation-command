/**
 * The default ports: the clock port, `performance.now()` (OC1), and where a new invocation identity takes
 * its time and randomness from, operation-call's own source (zorg's target, EM11). This is the only file
 * of the package that reads a clock itself, and it uses only what every runtime offers (zorg's D31).
 */
import { systemIdentitySource, type IdentitySource } from "@apnex/operation-call";
import type { CommandClock } from "./declaration-types.js";

/** The default clock port: milliseconds that a change to the wall clock does not move. */
export const systemCommandClock: CommandClock = Object.freeze({ now: (): number => globalThis.performance.now() });

/** The default identity source, operation-call's: `Date.now()` and `crypto.getRandomValues`. */
export const systemIdentities: IdentitySource = systemIdentitySource;
