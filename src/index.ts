/**
 * Public surface of operation-command: exactly the capabilities CONTRACT.md lists, and nothing else.
 * declareProgram - declared-command-dispatch, ending-exit-status, repeat-command-line and command-call-bound:
 *   checks a declaration (OC1) and runs one command (OC2 to OC5).
 * DeclarationError - declared-command-dispatch: the error refusing a declaration, naming the rule it breaks.
 * EXIT_STATUS - ending-exit-status: the status of each ending and of a command refused before invoking.
 * systemCommandClock - command-call-bound: the default clock port, `performance.now()`.
 * formatReference - command-reference: generates the reference of every command from the declaration (OC6).
 * The process adapter is `@apnex/operation-command/process`.
 */
export { declareProgram, INTERRUPTED_LINE, type CommandIo, type Interruptions, type Program } from "./program.js";
export { formatReference } from "./reference.js";
export { DeclarationError, type DeclarationRule } from "./declaration.js";
export { EXIT_STATUS, RUN_FAILED } from "./endings.js";
export { systemCommandClock } from "./system-ports.js";
export type { CommandClient, CommandClock, CommandDeclaration, FlagDeclaration, Flags, FlagValue, GroupDeclaration, InvokingCommandDeclaration, LocalCommandDeclaration, LocalContext, PrepareNotDelivered, PrepareRequest, PrepareResult, ProgramDeclaration, RunContext, SettingDeclaration, ValueType } from "./declaration-types.js";
