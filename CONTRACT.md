---
id: unminted
category: component
title: operation-command - named operations run from a command line, each ending reported through the exit status
status: draft
hydrate-when: A program offers named operations as commands, and you are about to write flag parsing, exit statuses or the difference between failed and unknown by hand
sovereignty: internal
supersedes: []
related: [C0, A3]
---

# operation-command

The contract of record for operation-command: what a consumer can depend on, admitted to zorg's component set by the director's rulings `D35` and `D37` in zorg's `docs/DECISIONS.md`; its vision is ratified (zorg's `D44`), and this contract is a draft until its capabilities are built and verified.\
It also carries the fields of a mission-kit registry entry, and that entry is generated from this file when the component is filed, never written as a second copy.\
The registry id is unminted on purpose; one is minted only when the entry is admitted to the registry.

---

## Duty

Run one declared invocation from a command line, reporting its ending through the exit status.

---

## Contract

What a consumer can depend on, one capability per row.\
A capability is named for what it offers, not for who offers it, so two components that provide the same capability share its name, and the overlap is visible.\
**Provides** means this component implements the capability; **carries from X** means it passes X's capability through its own interface.\
**Requires** names the capabilities of other components a row depends on, as `component:capability`, so a census can follow an application's demand down through the components it reaches.\
The trait column names any trait a system takes on by using the capability.

| Capability | Relation | Requires | What a consumer can depend on | Trait |
|---|---|---|---|---|
| `declared-command-dispatch` | provides | none | Commands, their flags, groups of flags of which exactly one or at least one must be given, the environment variables standing in for settings, their defaults and their valid values are declared as data, with the application's function running each command through its client; a flag overrides its variable and a variable its default, and a command that breaks its declaration is refused with a usage error before anything is prepared or invoked. | none |
| `ending-exit-status` | provides | `operation-call:honest-call-ending`, `shape-check:plain-json-value` | Each of the call layer's four endings exits with its own status and prints its own record, in a plain form or as one JSON object, with the ending unchanged; a command refused before anything was invoked - a usage error or an interruption - exits with one status of its own; and a client that cannot get ready without saying how ends the command not delivered, no call having been made; a command whose answer comes in parts prints each part as it arrives, then its ending, which says how many parts it printed and the last of them. | none |
| `repeat-command-line` | provides | `operation-call:invocation-identity` | An invocation that ends unknown prints the command that repeats it, with the settings it used, save any secret: under its invocation identity when it changes something, so the owner of the effect can recognise the repeat, and as a fresh run when it changes nothing; as a list of arguments and as one quoted command line. | none |
| `command-call-bound` | provides | `operation-call:caller-chosen-bound` | A command's declared settings give its call's bound and the time it may take to reach its caller, so neither is left to defaults the application cannot see. | none |
| `command-reference` | provides | none | A reference of every command, its flags, their variables, defaults and valid values is generated from the declaration, never written beside it. | none |

The component holds nothing between runs, coordinates no actors and contains no model, so none of its capabilities brings a trait.\
In zorg's Delta 1, all rows but `command-reference` are built, for zorg's six commands; `command-reference` is built in zorg's Delta 3 (`D57`); printing an answer in parts joins `ending-exit-status` and `repeat-command-line` in zorg's Delta 4 (`D64`).

---

## Command design

**Maturity: provisional**, designed under zorg's Delta 1, amendment 2, and zorg's rulings `D8`, `D21`, `D35` and `D37`; a URL type's pattern added under amendment 8 and `D56`; answers in parts added under zorg's Delta 4, its stage 8 and amendment 8, and `D64`.\
Each declaration names the exit criterion of zorg's `docs/DELTAS/DELTA-1.md` or `docs/DELTAS/DELTA-4.md` that proves it and the test that exercises it.\
Endings and invocation identities are those of zorg's `docs/ARCHITECTURE-TARGET.md`, `EM11` and `EM12`.

**OC1 - The declaration.**\
An application declares its program as data, with three kinds of part.\
Its settings: each with a flag, an optional environment variable, an optional default, a type and its valid values, and whether it is secret; a setting with a variable is required or has a default, so it always takes a value, and a switch has no variable and no default, so it is off unless given.\
Its commands: each with a name, the name of the operation it invokes, its own flags, which take no variable and no default, groups of its flags of which exactly one, or at least one, must be given, whether the command changes anything, and the application's `run` function, which performs the command's invocation through the application's client under the invocation identity, repeat flag, bound and abort signal it is given (`OC3`), and returns the call layer's ending.\
A command that invokes may be declared with `parts: true`, a parts command, whose answer may come in parts (zorg's `D64`); its declaration may then also give `wordPart`, which words a part for the plain form as `word` words an answer, and `resume`, which gives the flags that continue where the command stopped (`OC4`, `OC5`).\
Its client: an object the application supplies, which `run` calls through - for zorg, its SDK over entity-api and operation-proxy's client half - and which may offer a `prepare` step (`OC3`).\
A command may instead be local: operation-command reads its flags and passes them to the application's code, whose exit is its own, with no invocation and no ending.\
A flag's type is a string the whole of which matches a stated pattern, a whole number within stated bounds, a duration within stated bounds, a URL of stated schemes that may also state a pattern, or a switch; a flag may be required and may repeat, and a command's own flag may exclude or require another of that command's own flags - never a setting, whose variable and default would make a repeat, which writes every setting that took a value (`OC5`), break a relation the first run kept.\
A pattern is a regular expression written as text, which the whole value must match from its first character to its last, compiled with no flags.\
A duration is a whole number with no sign followed by one of `ms`, `s`, `m`, `h` or `d`, in lower case.\
A URL is text that the WHATWG URL standard's parser, the runtime's `URL`, takes as an absolute URL and takes again, unchanged, from the form it writes for it, whose scheme, written without its colon, is one of those stated, and the whole of whose text matches the type's pattern when it states one; these are checked in that order, and the first that fails is the value's usage error (`OC2`).\
A URL the parser cannot take back from its own form is refused because nothing after can rebuild it: Node 24's parser writes a host such as `xn--a` led by U+00E9 as `xn--xn--a-9ra`, which it then refuses, and setting any part of such a URL stops the process.\
The flags `--invocation` (`OC3`) and `--json`, a switch (`OC4`), are operation-command's own, offered by every command that is not local, and are no settings of the application's.\
A flag is written `--` and a name matching `^[a-z0-9][a-z0-9-]*$`, a variable matches `^[A-Za-z_][A-Za-z0-9_]*$`, and a command's name matches `^[a-z0-9][a-z0-9-]*$`; the bound setting's declared range lies wholly within 1 millisecond to 2147483647, each of its ends checked, and the preparation setting's wholly within 0, a deadline already past, to that maximum; a duration's ends are whole numbers of milliseconds no larger than 9007199254740991.\
The declaration names the settings that give a call's bound and its time to prepare (`command-call-bound`).\
Time is read from a clock port, in milliseconds that a change to the wall clock does not move, by default `performance.now()`, which a test may replace.\
A declaration that breaks these rules - a setting both required and defaulted, a switch required or repeating, a `parts` that is not `true` or `false`, a `wordPart` or `resume` that is not a function or is given by a command not declared `parts: true`, and a field the declaration does not define, `parts` on a local command included, among them - is refused by an error, thrown when the declaration is given to operation-command and naming the rule, before any argument is read; this is the application's defect, not a command's ending.\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a fixture application, including a declaration refused for a setting with a variable but neither a default nor required, for a switch with a variable or a default, and for a URL type whose pattern is not text or is not a regular expression; and, for `D4-E8`, a declaration refused for a `parts` that is not `true` or `false`, for `parts` on a local command, and for a `wordPart` or a `resume` that is not a function or is given by a command that is not a parts command.

**OC2 - Reading a command.**\
Arguments are the command's name followed by flags written `--flag value` or `--flag=value`, or `--flag` alone for a switch, which takes no value; a setting's value comes from its flag, else its variable, else its default, and a variable set to the empty string counts as unset.\
A usage error is any of: an unknown command or flag; a flag without its value, or a switch given one; a flag given twice that may not repeat; a required flag missing; a value of the wrong type or outside its valid values; two flags that exclude each other; a flag missing that another requires; and a group with none of its flags given, or with more than one given when exactly one must be.\
Where several usage errors apply, the first met is reported: the arguments in the order given, then the settings' variables and required settings in the declaration's order, then the command's required flags, then the command's flags that exclude or require others, then the groups.\
A usage error prints `usage: ` and what was wrong on standard error, one line, and exits with status 1 before the client is prepared, so nothing is prepared and nothing is invoked.\
An interruption delivered while the arguments are read is reported in place of any usage error that reading found, a local command's included, as an interruption before `run` (`OC4`).\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a case for each kind of usage error, each group with none, one and two of its flags, an empty variable, a flag overriding its variable, a variable overriding its default, a repeated flag kept in order, and neither preparing nor invoking on any usage error; and a URL type with a pattern, given a value that the parser takes, of a stated scheme, which matches the pattern, one of a stated scheme which does not match it, one whose text matches the pattern but which the parser refuses, such as `ws://xn--abc.example:1/` against `ws://[^/]+:[0-9]+/`, and one the parser takes but not back from the form it writes for it, wherever the runtime's parser has one, such as `ws://xn--a:1/` with U+00E9 before its host in Node 24, the last three each a usage error saying why, and the value accepted kept as the text it was taken from.

**OC3 - Preparing and invoking.**\
Before it prepares anything, a command fixes its invocation identity: the one `--invocation` gives, or a new one as `EM11` writes it.\
A value of `--invocation` that is not an invocation identity as `EM11` writes it is a usage error.\
For a command that changes something, an identity given by `--invocation` marks the invocation as a repeat; for one that changes nothing, it only names the command's first call and marks nothing, because no earlier attempt can have taken effect, so such a command's not-delivered ending says `earlierAttemptsUncertain` `false`.\
When the client offers `prepare`, the command calls it with a deadline - the clock port's reading when the command began reading its arguments, plus its preparation setting - with the clock port, with an abort signal, and with the command and its read settings and flags, from which the client knows what to prepare, and waits for it to settle.\
`prepare` settles to `ready`, or to a not-delivered ending carrying `ending: "not-delivered"` and optional `agpCode` and `proxyCode`, each a string or `null`, with or without the other fields of a caller-interface not-delivered ending (`invocation`, `attempt`, `operation`, `earlierAttemptsUncertain`).\
The client decides which, and the deadline is its to keep, as operation-proxy's client half keeps it (`PX5`, `PX6`): its result is `ready` only when it became ready at or before the deadline, and once the clock port reads past the deadline with the client not ready, the timeout has won and its result is that not-delivered ending, which no readiness obtained afterwards supersedes; a deadline already past when `prepare` is called gives the timeout at once, unless the client is already ready.\
The command keeps no timer of its own for preparing and trusts the decided result whenever it observes it, so a `ready` decided in time and observed after the deadline is ready; it cannot tell that from a client that breaks the rule above, and holding the deadline is tested where the client is - for zorg, with zorg-sdk's `prepare`, in zorg's `packages/zorg-cli/test/preparing.test.js` (`RT3`).\
On `ready` the command calls `run`; on an ending it never calls `run`, and reports that ending as the command's own, with the command's operation name, its invocation identity and the repeat flag above (`OC4`).\
A `prepare` that returns a native `Promise` is awaited, while a non-native thenable is not awaited; when it rejects, throws, or settles to anything other than the string `"ready"` or a plain-data not-delivered ending (`D54`, `D55` - read through shape-check's `readPlainJson` and `observePromises`, a plain object with own enumerable data properties `ending: "not-delivered"`, optional `agpCode` and `proxyCode` (each a string or `null`), and optional `invocation`, `attempt` and `operation` (each a string or `null`) and `earlierAttemptsUncertain` (a boolean), with no other properties, no getters, no inherited properties and no promises), it ends the command not delivered with `agpCode` and `proxyCode` `null`, its error written as one diagnostic line on standard error, and `run` is not called.\
Whenever `prepare` does not reach `ready`, nothing has been invoked.\
The command then calls `run` with the command and its read settings and flags, and the call's settings: its bound setting as the call's bound, which starts when `run` invokes (`EM12`), so preparing does not count against it; the invocation identity and repeat flag above; an abort signal (`OC4`); and, for a parts command alone, `onPart`, a function for its client to pass on and call with each part's answer, in order, for the command to print (`OC4`), which returns nothing and never throws.\
`run` makes its first call under that identity, which is the one the command prints; a command whose `run` makes several calls, as zorg's find does for its pages, gives its later calls new identities (`EM10`), none of them marked a repeat when the command changes nothing.\
Tested by: `E19`, in `test/contract/command-call-bound.test.js`, with the injected clock port and a fixture client recording the preparation deadline and clock, and the bound, identity, repeat flag and abort signal `run` receives; with `prepare` settling to the string `"ready"` before the deadline, and a ready decided before the deadline but observed after it, each reaching `run`; settling to a plain-data not-delivered ending with an `agpCode` and with a `proxyCode`, before and after the deadline, each ending printed whole with its operation and invocation and the command keeping no timer that ends it sooner; and, each checked in both forms with both streams, its status and its whole record: `prepare` settling to an object that is not a plain-data not-delivered ending - one with a custom prototype, an inherited field, a non-enumerable field, an extra field, a getter (never called), or a non-native thenable - or a native promise in a field, or rejecting or throwing an error whose own `message` is itself, exceeds 1000 characters with a rejected promise in another own property, or holds a value that holds it, each ending not delivered with `agpCode` and `proxyCode` `null`, one finite diagnostic line, zero getter calls, no unhandled rejection, and none reaching `run`; and each of these settling after an interruption while preparing, which leaves the interruption's report and status 1 alone, reaches nothing, and lets no rejection escape; and with `--invocation` given to a command that changes something and to one of several calls that changes nothing, whose not-delivered ending says `earlierAttemptsUncertain` `false`; and, for `D4-E8`, `run` of a parts command given `onPart` with the other settings, and `run` of any other command given none.

**OC4 - Exit statuses and output.**\
A command prints its ending on standard output and nothing else there; standard error carries only diagnostics, usage errors and the report of an interruption before `run`.\
A usage error and an interruption before `run` print nothing on standard output, with `--json` or without it.

| Ending | Exit status | Fields with `--json`, besides `ending`, `operation` and `invocation` |
|---|---|---|
| answered | 0 | `answer`, as the operation gave it |
| refused | 2 | `refusal`, the refusal record unchanged (zorg's `D21`) |
| not delivered | 3 | `agpCode` and `proxyCode`, each the ending's or `null`; `earlierAttemptsUncertain`, true for a repeat (`OC3`) |
| unknown | 4 | `reason`; `agpCode` or `null`; `deliveryReport`, `delivered`, `unknown` or `null`; and `repeat` (`OC5`) |
| usage error | 1 | none, and nothing on standard output; `OC2` |
| interrupted before `run` | 1 | none, and nothing on standard output |

`ending` is written `answered`, `refused`, `not-delivered` or `unknown`, exactly as the call layer names it, and `operation` is the command's operation name as declared (`OC1`).\
A command interrupted by `SIGINT` or `SIGTERM` before it called `run`, while its arguments are read and while preparing included, fires the abort signal it gave `prepare`, if it called `prepare`, prints `interrupted: nothing was invoked` on standard error and exits with status 1, calling nothing more, whatever `prepare` settles to afterwards.\
Interrupted after it called `run`, it fires the abort signal it gave `run`, which the call layer honours as `EM12` says - ending the call not delivered with `ABORTED` only if its send was not yet admitted - then waits for the ending the call layer gives, which the call's bound guarantees, prints it and exits with its status.\
Further interruptions change nothing: the command keeps waiting for that ending, so no interruption a process can handle makes it exit without reporting how its invocation ended; `SIGKILL`, which no process can handle, ends it with nothing printed, as it ends any process.\
An interruption that arrives after the ending was given, or while it is being printed, changes nothing either: the command prints the ending whole and exits with its status.\
With `--json` a command prints one JSON object holding those fields; without it, it prints the same facts one per line, as a name, a colon and a value - a string as it is unless it holds a control character, and any other value as JSON - the answer worded by the application's `word`, given the answer and the flags, or written `answer: ` and its JSON where the application gives none or its `word` fails, with one diagnostic line; `word` fails when it throws or returns anything but a string, which may hold several lines, a value it throws is never the wording, and a promise it returns is consumed.\
A `run` that returns a native `Promise` is awaited, while a non-native thenable is not awaited; when it rejects, throws, or settles to anything that operation-call's `readCallEnding` refuses (`D54`, `D55` - read as plain data through shape-check's `readPlainJson` and `observePromises`, so any custom prototype, inherited field, non-enumerable field, extra field, getter or promise in any field, `invocation`, `attempt` and `operation` included, or a refusal that breaks `EM9`, is refused with zero getter calls and every native promise observed), it may have invoked, so the command ends `unknown` with `reason` `run-failed`, `agpCode` and `deliveryReport` `null` and its repeat, and one diagnostic line; a client that never settles leaves the command waiting, since no ending is known.\
A diagnostic line is formatted by operation-command from own data descriptors only (including an `Error`'s own non-enumerable `message`, never its inherited `name`, and never invoking a getter or conversion), observing every native promise met through `observePromises` before any length cut so truncating a line never leaves a promise in another field unobserved: a value met a second time on the active path is written `<cycle>`, at most 1000 nodes are visited, control characters are replaced by spaces, and the line is cut at 1000 Unicode code points with `...` added; its wording is otherwise not fixed, and it is always one line.\
The invocation a command prints is always the identity it fixed (`OC3`), never a later call's.\
A parts command (`OC1`) prints each part on standard output as its client calls `onPart` with the part's answer (`OC3`), before its ending, which stays the last thing it prints.\
Its printing of parts closes when it observes that `run` has settled: when `run` returns what is not a native promise or throws, or, for a native promise, when the reaction it attaches to that promise as `run` returns it runs; a part passed on before that moment is printed, one passed on after it is not, whatever it is, and from that moment an interruption changes nothing.\
It reads each part's answer once, as plain data through shape-check's `readPlainJson` (`D54`, `D55`), and numbers the parts it prints itself, 1 for the first and one more for each after, since its client passes on the answer alone.\
With `--json` a part is printed as one line, `{"part": <number>, "answer": <answer>}`; without it, as the application's `wordPart`, given the answer and the flags, or as `part: ` and the answer's JSON where the application gives none or its `wordPart` fails, as `word` fails, with one diagnostic line at the first part it cannot word and none at any later.\
The ending of a parts command adds, after the fields above, `partsTaken`, how many parts it printed, and `lastPart`, the answer of the last part it printed or `null`; and, when its declaration gives `resume`, `resume`, the flags `resume` gives for `lastPart`, or `null` where it fails (`OC5`, zorg's Delta 4, amendment 8) - each in both forms and in every ending, one whose client could not get ready and an unknown one with `run-failed` included.\
The command counts each text it gives standard output as unwritten, by its UTF-8 bytes, a part's line and its line break included, until its write settles - a write that returns no native promise settles at once - and keeps nothing of a write once it has settled.\
A part counts as printed, in `partsTaken` and `lastPart`, once its text is handed to standard output without the write throwing.\
A write that throws, or whose native promise rejects, closes the printing of parts as an overflow does, below, with one diagnostic line, a part whose write threw not counted and every rejection observed; the ending is written however earlier writes fared, and a write of the ending that throws or rejects leaves the command's exit status its ending's, with one diagnostic line.\
The process adapter's write returns a native promise that fulfils when the stream calls back for the text and rejects when the callback carries an error, whatever `write` itself returned; and it listens for the errors of both its streams, so a standard output that breaks fails its writes and ends no process before the command exits with its status.\
It keeps at most 16777216 bytes of standard output unwritten while it prints parts: the first part that would take it past that closes its printing of parts for good - that part and every later one, a checkpoint included, are not printed - fires the abort signal it gave `run` once, and leaves `partsTaken` and `lastPart` as they stood, with one diagnostic line, so what it printed is always an unbroken run from the first part.\
A part whose answer does not read as plain data closes its printing of parts in the same way, its promises observed and with one diagnostic line.\
The bound governs the parts: the ending, which the command must print (zorg's `D8`) and holds whole whether it is written at once or waits, is written after them whatever is unwritten, its size that of the answer, which crossed AGP within `EM11`'s limits, and of the application's wording of it.\
The exit statuses and the rules on interruption are unchanged: interrupted after it called `run`, a parts command fires the abort signal it gave `run`, which cancels a call AGP has admitted (zorg's `EM12`), waits for the ending and prints it.\
Tested by: `E19`, in `test/contract/ending-exit-status.test.js`, with a fixture client, which checks both output streams and the status of every case: each ending's JSON object whole and its plain form; a usage error and an interruption before `run`, each with and without `--json`, leaving standard output empty; an interruption while preparing, after which `prepare` settles ready and `run` is never called; one after `run` with the send not yet admitted; one after admission; a second and a third interruption after admission, the command still reporting the ending the call layer gives; and one after the ending was given, during its printing; and each of the four endings as plain data (including a whole-find `bound-passed` ending with `attempt: null` and hop endings) with every member of an answer or refusal kept, a nested `__proto__` or `then` data property included, in both forms, and a `word` returning 200000 lines printed whole without overflowing the call stack; and `run` returning an ending with a custom prototype, an inherited field, a non-enumerable field, an extra field, a getter (never called), or a promise in `invocation`, `attempt`, `operation` or a payload field, each ending `unknown` with `run-failed`, its repeat and one diagnostic line; and `run` and `word` throwing an error whose own `message` is itself, exceeds 1000 characters alongside a rejected promise in another own property, or holds a value that holds it, the run ending `unknown` with `run-failed` and its repeat and the word's answer written as JSON, each with one diagnostic line cut at 1000 characters and zero unhandled rejections; and `D4-E8`, in `test/contract/parts-output.test.js`, which checks both streams and the status of every case: a parts command printing each part before its ending in both forms, numbered from 1; `wordPart` used, and a `wordPart` that throws or returns what is not text falling back to the part's JSON with one diagnostic line however many parts it fails for; `partsTaken`, `lastPart` and, with `resume` declared, `resume` in the record of each of the four endings, of one whose client could not get ready and of an unknown one with `run-failed`, in both forms; a part passed on after `run` settled not printed; an interruption after `run` firing its signal and then printing the ending with its status after the parts printed before it; a standard output whose writes never settle reaching 16777216 unwritten bytes, the signal fired once, `lastPart` the last part printed and no later part or checkpoint printed after it, however small, with one diagnostic line, and the ending printed; a part whose answer has a getter, a custom prototype or a promise closing printing the same way, with zero getter calls and no unhandled rejection; and the memory a command keeps, measured after garbage collection, not growing with the parts written, in the command and through the process adapter; and the moment printing closes - a part passed on in the same turn just before a native promise `run` returned is fulfilled printed, and one passed on in a microtask queued after the fulfilment, one after a synchronous return and one after a throw not printed; parts passed on after an interruption while `run` is pending printed before the ending; a part whose line, in multi-byte UTF-8 with its framing and line break, brings the unwritten bytes to exactly 16777216 printed and one a byte longer not; held writes released one at a time freeing their bytes, so that more than 16777216 bytes in all are printed with no overflow; a writer returning no promise counted as settled at once; a write that throws and one whose promise rejects, each closing printing with one diagnostic line, and a write of the ending that throws leaving the exit status its ending's; through the process adapter, a write whose callback is held while `write` returned true counted as unwritten, and a standard output that breaks leaving the command's exit status; and the exact order of the ending's fields in both forms for each of the four endings, one whose client could not get ready and an unknown one with `run-failed`, with `resume` declared and without, and a `resume` that fails on an ending that is not unknown.

**OC5 - Repeating an unknown ending.**\
Every unknown ending carries `repeat`, a JSON array of strings holding the arguments that follow the program's name, as the certified form of zorg's `RT5` had it.\
They are, in order: the command's name; each setting that is not secret and took a value, in the order the declaration lists them, with the value it took from its flag, its variable or its default; `--json` when it was given; the command's own flags as given, in the order given; and, for a command that changes something, `--invocation` and the invocation identity, so the owner of the effect can recognise the repeat, while for one that changes nothing no identity is written, so the repeat is a fresh run.\
An `--invocation` the command was given, in either form, is never copied: the identity appears only as the last two elements, and only for a command that changes something.\
A setting that takes a value is written as two elements, its flag and the text of its value exactly as it was taken - a duration as written, such as `10s` - once for each value, in order, for one that repeats.\
A switch that is on is written as its flag alone, and one that is off is left out, which is exact because a switch has no variable and no default (`OC1`); a setting that took no value has no variable (`OC1`), so leaving it out leaves it without a value in any environment.\
A secret setting is never written: whoever runs the repeat supplies it again, by its flag or its variable, and with the value it had, the repeat reaches the same host, service and principal with the same input, in any environment.\
The plain form prints `repeat` as one command line: the program's name as declared, then each element of `repeat`, each of them - the program's name included - as one shell word in single quotes, each single quote within it written `'\''`, so a program's name holding a space or a quote runs as itself.\
The repeat of a parts command whose declaration gives `resume` (`OC1`) takes the command's own flags from what `resume` gives, so the repeat continues where the command stopped (zorg's Delta 4, stage 8); without `resume` the flags are as given.\
It is called once for every ending of the command, when the ending is known, with two arguments: `lastPart` (`OC4`), and the flags as given - the same frozen flags `run` and `word` are given, settings included, each value as it was read (`OC1`); its result serves both the repeat and the ending's `resume` (`OC4`).\
The application's `resume` returns an object, read as plain data through shape-check's `readPlainJson`, each of whose members names one of the command's own flags without its leading `--`: a string is that flag's text; a list of strings, the texts of a flag that repeats; `true` or `false`, a switch on or off; and `null` leaves the flag out.\
Each flag it names takes the place of every value given for it, at the place of the first, one not given following the flags given in the order the command declares its flags, and every flag it does not name stays as given.\
The flags so made must read, with the settings the command used, as the command's arguments are read (`OC2`) - each value by its flag's type, a flag that may not repeat given once, and the command's required flags, relations and groups kept; where they do not, or `resume` throws, returns a promise or returns what is not such an object, the repeat takes the flags as given, the ending's `resume` is `null` (`OC4`), and one diagnostic line says why.\
Tested by: `E19`, in `test/contract/repeat-command-line.test.js`, which runs each printed repeat through the real parser and compares the settings and flags it reads with the first run's, for a program's name holding a space and a single quote, whose plain repeat, split into words as a POSIX shell splits it, names exactly that program with the JSON array's arguments unchanged, for an argument holding spaces and quotes, settings taken from flags, from variables and from defaults, the variables then changed or unset before the repeat is run, a duration setting, a switch on and a switch off, a repeating setting, a setting with no value, a secret setting supplied again, an invocation given as `--invocation <identity>` and as `--invocation=<identity>`, a repeat that itself ends unknown, which gives a `repeat` with one `--invocation`, and a command that changes nothing, each in its JSON and its plain form; and, for `D4-E8`, the repeat of a parts command whose `resume` replaces a flag's value, replaces the values of a repeating flag, adds a flag not given, turns a switch off and leaves a flag out, each run through the real parser and continuing as `resume` said, with the same `resume` in the ending's record; and one whose `resume` throws, returns a promise or a list, returns an object with a getter, names a setting, an unknown flag or a name written with `--`, gives a value its flag's type refuses, gives a flag that may not repeat two values, leaves out a required flag, breaks an exclusion or a requirement, or leaves a group of either kind unkept, each giving the flags as given, `resume` `null` and one diagnostic line; a repeating flag given between others, and several flags added, each checked as the exact `repeat` array and its quoted line; `resume` called exactly once, its result in both the repeat and the ending's `resume`; and `resume` given the frozen flags, with an integer, a duration, a repeating flag, a flag not given and a switch off, for an ending whose client could not get ready too, with `lastPart` `null`.

**OC6 - The reference (`D57`).**\
`command-reference` generates a deterministic reference of the program from its declaration alone, offered as `program.reference()` on the `Program` returned by `declareProgram(declaration)` and as `formatReference(declaration)`, which validates the declaration as `declareProgram` does before formatting it.\
The reference is plain text ending in a newline, stating in order: the program's name; its settings in declared order - each flag, its environment variable when declared, `required` or `default: <value>` when declared, `repeats` and `secret` when true, its type and valid values (`string` with `pattern`, `integer` with `min` to `max`, `duration` with `min` to `max`, `url` with `schemes` and optional `pattern`, or `switch`), and its description when declared; and its commands in declared order - each command's name, `operation: <operation>` and `changes: true | false` for an invoking command or `local` for a local command, its description when declared, its own flags in declared order (with `required`, `repeats`, `excludes`, `requires`, type and description), its groups (`exactly-one` and `at-least-one`), and, on every invoking command, operation-command's own `--invocation` and `--json` flags.\
Tested by: `D3-E1`, in `test/contract/command-reference.test.js`, checking that every part of a declaration appears in the generated reference, that changing any declared setting, command, flag, group, relation, type, bound, pattern or description changes the generated reference, and that `formatReference` refuses an invalid declaration with `DeclarationError`.

**OC7 - The whole path, and what zorg composes.**\
`test/contract/integrated-commands.test.js` runs a fixture application's declared commands, and the printed repeats of their unknown endings, through operation-call over AGP's production in-process carrier, comparing the input and invocation identity the operation receives, and the output, with the declaration's.\
Its repeats are of a command that changes something and of one that changes nothing, each run with a switch on and with it off, and each repeat is run in a changed environment through the same real parser and path.\
Its interruptions go through the real call layer: one before the send is admitted, which ends not delivered with `agpCode` `ABORTED` and leaves the operation never receiving the request; one after admission and one after the ending, each reporting the call layer's ending unchanged.\
The command-line client of zorg declares its settings, its six invocation commands and its local `proxy` command to operation-command, with zorg's SDK as its client; zorg's own declaration - its settings, commands, groups, how each runs and how each answer is worded - is zorg's `RT2`.\
A parts command runs the same path: its parts, from a host answering in parts through operation-call (zorg's `EM11`), are printed before its ending, and an interruption after its first part cancels the call, whose host's signal fires, and prints the ending the call layer gives.\
Tested by: `E19`, in that file; and `E15`, in zorg's `test/e2e/command-configuration.test.js` and `test/e2e/command-endings.test.js`, including a find whose answer takes several pages; and `E15`, in zorg's `packages/zorg-cli/test/interruptions.test.js`, the same interruptions through zorg's SDK and operation-proxy (`RT5`); and, in `test/contract/integrated-commands.test.js`, real answers and refusals through the call layer printed unchanged in both forms with their own status, while an ending wrapped in a custom prototype or with a non-enumerable `ending` is refused as `unknown` with `run-failed`; and, for `D4-E8`, in that file, a parts command printing a real host's parts before its ending, and interrupted after its first part, the host's signal firing and the ending printed with its status.

---

## Reference

This repository, `apnex/operation-command`, private until its first working code is certified.\
The package `@apnex/operation-command` exports `declareProgram`, which checks a declaration, runs one command of it and formats its reference, `formatReference`, `DeclarationError`, `EXIT_STATUS`, `INTERRUPTED_LINE`, `RUN_FAILED` and `systemCommandClock`; `@apnex/operation-command/process` exports `runProcess`, which runs a declared program as a Node process, as `export-map.json` records.\
It depends on `@apnex/operation-call` and `@apnex/shape-check` through `file:` links, and imports no module particular to one runtime outside its process adapter.

---

## Fit criteria

### Does my project want this at all

- A program offers named operations as commands, to people, scripts or agents.
- A caller must tell refused from not delivered from unknown, and an agent must know when repeating is safe to try.
- Commands are many, and each should be a declaration rather than code.

### Does it meet my requirement

- Each ending has its own exit status, and an unknown ending says how to repeat it.
- A flag overrides its environment variable, which overrides its default, for every command alike.
- A bad command is refused before anything is invoked.

**It is the wrong tool when**

| You need | Reach elsewhere, because operation-command is |
|---|---|
| a session, a prompt or a screen | not a shell or a terminal interface |
| calls repeated for you | not a retrier |
| reply pairing, time-outs or the call's ending | not the call layer; that is operation-call |
| a decision about who may run what | not an authority |

---

## Adjustment policy

Internal and sovereign, so a fit gap has somewhere to go.

1. Record a measured gap where both sides can see it.
2. Resolve it by adjusting operation-command, so every consumer gets the change, or by fracturing it when the gap reveals a second duty.
3. Never fork.

It invokes through the call layer's caller interface, so a command runs the same through operation-call directly or through operation-proxy's client half.

---

## Edges

**Composes:** nothing registered.

**Consumes, through a declared contract:**

- `operation-call`: `honest-call-ending`, `invocation-identity`, `caller-chosen-bound`
- `shape-check`: `plain-json-value`

**Composed-by:** nothing yet.\
Its first consumer, once built, is zorg's command-line client.

The registry's edge vocabulary has no edge for one component using another's contract without containing it; see the note in operation-call's entry.
