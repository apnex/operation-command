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
| `ending-exit-status` | provides | `operation-call:honest-call-ending` | Each of the call layer's four endings exits with its own status and prints its own record, in a plain form or as one JSON object, with the ending unchanged; a command refused before anything was invoked - a usage error or an interruption - exits with one status of its own; and a client that cannot get ready without saying how ends the command not delivered, no call having been made. | none |
| `repeat-command-line` | provides | `operation-call:invocation-identity` | An invocation that ends unknown prints the command that repeats it, with the settings it used, save any secret: under its invocation identity when it changes something, so the owner of the effect can recognise the repeat, and as a fresh run when it changes nothing; as a list of arguments and as one quoted command line. | none |
| `command-call-bound` | provides | `operation-call:caller-chosen-bound` | A command's declared settings give its call's bound and the time it may take to reach its caller, so neither is left to defaults the application cannot see. | none |
| `command-reference` | provides | none | A reference of every command, its flags, their variables, defaults and valid values is generated from the declaration, never written beside it. | none |

The component holds nothing between runs, coordinates no actors and contains no model, so none of its capabilities brings a trait.\
In zorg's Delta 1, all rows but `command-reference` are built, for zorg's six commands; `command-reference` is left out of Delta 1, which drawv2's command line, generating its help from its manifest, needs.

---

## Command design

**Maturity: provisional**, designed under zorg's Delta 1, amendment 2, and zorg's rulings `D8`, `D21`, `D35` and `D37`.\
Each declaration names the exit criterion of zorg's `docs/DELTAS/DELTA-1.md` that proves it and the test that exercises it.\
Endings and invocation identities are those of zorg's `docs/ARCHITECTURE-TARGET.md`, `EM11` and `EM12`.

**OC1 - The declaration.**\
An application declares its program as data, with three kinds of part.\
Its settings: each with a flag, an optional environment variable, an optional default, a type and its valid values, and whether it is secret; a setting with a variable is required or has a default, so it always takes a value, and a switch has no variable and no default, so it is off unless given.\
Its commands: each with a name, the name of the operation it invokes, its own flags, which take no variable and no default, groups of its flags of which exactly one, or at least one, must be given, whether the command changes anything, and the application's `run` function, which performs the command's invocation through the application's client under the invocation identity, repeat flag, bound and abort signal it is given (`OC3`), and returns the call layer's ending.\
Its client: an object the application supplies, which `run` calls through - for zorg, its SDK over entity-api and operation-proxy's client half - and which may offer a `prepare` step (`OC3`).\
A command may instead be local: operation-command reads its flags and passes them to the application's code, whose exit is its own, with no invocation and no ending.\
A flag's type is a string matching a stated pattern, a whole number within stated bounds, a duration within stated bounds, a URL of stated schemes, or a switch; a flag may be required, may repeat, and may exclude or require another flag.\
A duration is a whole number with no sign followed by one of `ms`, `s`, `m`, `h` or `d`, in lower case.\
The flag `--invocation` is operation-command's own, offered by every command that is not local (`OC3`), and is no setting of the application's.\
The declaration names the settings that give a call's bound and its time to prepare (`command-call-bound`).\
Time is read from a clock port, in milliseconds that a change to the wall clock does not move, by default `performance.now()`, which a test may replace.\
A declaration that breaks these rules is refused by an error, thrown when the declaration is given to operation-command and naming the rule, before any argument is read; this is the application's defect, not a command's ending.\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a fixture application, including a declaration refused for a setting with a variable but neither a default nor required, and for a switch with a variable or a default.

**OC2 - Reading a command.**\
Arguments are the command's name followed by flags written `--flag value` or `--flag=value`, or `--flag` alone for a switch, which takes no value; a setting's value comes from its flag, else its variable, else its default, and a variable set to the empty string counts as unset.\
A usage error is any of: an unknown command or flag; a flag without its value, or a switch given one; a flag given twice that may not repeat; a required flag missing; a value of the wrong type or outside its valid values; two flags that exclude each other; a flag missing that another requires; and a group with none of its flags given, or with more than one given when exactly one must be.\
A usage error prints `usage: ` and what was wrong on standard error, one line, and exits with status 1 before the client is prepared, so nothing is prepared and nothing is invoked.\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a case for each kind of usage error, each group with none, one and two of its flags, an empty variable, a flag overriding its variable, a variable overriding its default, a repeated flag kept in order, and neither preparing nor invoking on any usage error.

**OC3 - Preparing and invoking.**\
Before it prepares anything, a command fixes its invocation identity: the one `--invocation` gives, or a new one as `EM11` writes it.\
A value of `--invocation` that is not an invocation identity as `EM11` writes it is a usage error.\
For a command that changes something, an identity given by `--invocation` marks the invocation as a repeat; for one that changes nothing, it only names the command's first call and marks nothing, because no earlier attempt can have taken effect, so such a command's not-delivered ending says `earlierAttemptsUncertain` `false`.\
When the client offers `prepare`, the command calls it with a deadline - the clock port's reading when the command began reading its arguments, plus its preparation setting - with the clock port, and with an abort signal, and waits for it to settle.\
`prepare` settles to `ready`, or to a not-delivered ending as the call layer's caller interface writes it, with its `agpCode` and `proxyCode`, each the ending's or `null`.\
The client decides which, and the deadline is its to keep, as operation-proxy's client half keeps it (`PX5`, `PX6`): its result is `ready` only when it became ready at or before the deadline, and once the clock port reads past the deadline with the client not ready, the timeout has won and its result is that not-delivered ending, which no readiness obtained afterwards supersedes; a deadline already past when `prepare` is called gives the timeout at once, unless the client is already ready.\
The command keeps no timer of its own for preparing and trusts the decided result whenever it observes it, so a `ready` decided in time and observed after the deadline is ready; it cannot tell that from a client that breaks the rule above, and holding the deadline is tested where the client is - for zorg, with zorg-sdk's `prepare`, in zorg's `packages/zorg-cli/test/preparing.test.js` (`RT3`).\
On `ready` the command calls `run`; on an ending it never calls `run`, and reports that ending as the command's own, with the command's operation name, its invocation identity and the repeat flag above (`OC4`).\
A `prepare` that rejects, or settles to anything else, ends the command not delivered with `agpCode` and `proxyCode` `null`, its error written as one diagnostic line on standard error, and `run` is not called.\
Whenever `prepare` does not reach `ready`, nothing has been invoked.\
The command then calls `run` with the parsed flags and the call's settings: its bound setting as the call's bound, which starts when `run` invokes (`EM12`), so preparing does not count against it; the invocation identity and repeat flag above; and an abort signal (`OC4`).\
`run` makes its first call under that identity, which is the one the command prints; a command whose `run` makes several calls, as zorg's find does for its pages, gives its later calls new identities (`EM10`), none of them marked a repeat when the command changes nothing.\
Tested by: `E19`, in `test/contract/command-call-bound.test.js`, with the injected clock port and a fixture client recording the preparation deadline and clock, and the bound, identity, repeat flag and abort signal `run` receives; with `prepare` settling ready before the deadline, and a ready decided before the deadline but observed after it, each reaching `run`; settling not delivered with an `agpCode` and with a `proxyCode`, before and after the deadline, each ending printed whole with its operation and invocation and the command keeping no timer that ends it sooner; rejecting, and settling to something else, each without reaching `run`; and with `--invocation` given to a command that changes something and to one of several calls that changes nothing, whose not-delivered ending says `earlierAttemptsUncertain` `false`.

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
A command interrupted by `SIGINT` or `SIGTERM` before it called `run`, while preparing included, fires the abort signal it gave `prepare`, if it called `prepare`, prints `interrupted: nothing was invoked` on standard error and exits with status 1, calling nothing more, whatever `prepare` settles to afterwards.\
Interrupted after it called `run`, it fires the abort signal it gave `run`, which the call layer honours as `EM12` says - ending the call not delivered with `ABORTED` only if its send was not yet admitted - then waits for the ending the call layer gives, which the call's bound guarantees, prints it and exits with its status.\
Further interruptions change nothing: the command keeps waiting for that ending, so no interruption a process can handle makes it exit without reporting how its invocation ended; `SIGKILL`, which no process can handle, ends it with nothing printed, as it ends any process.\
An interruption that arrives after the ending was given, or while it is being printed, changes nothing either: the command prints the ending whole and exits with its status.\
With `--json` a command prints one JSON object holding those fields; without it, it prints the same facts one per line, as a name, a colon and a value, the answer worded by the application.\
Tested by: `E19`, in `test/contract/ending-exit-status.test.js`, with a fixture client, which checks both output streams and the status of every case: each ending's JSON object whole and its plain form; a usage error and an interruption before `run`, each with and without `--json`, leaving standard output empty; an interruption while preparing, after which `prepare` settles ready and `run` is never called; one after `run` with the send not yet admitted; one after admission; a second and a third interruption after admission, the command still reporting the ending the call layer gives; and one after the ending was given, during its printing.

**OC5 - Repeating an unknown ending.**\
Every unknown ending carries `repeat`, a JSON array of strings holding the arguments that follow the program's name, as the certified form of zorg's `RT5` had it.\
They are, in order: the command's name; each setting that is not secret and took a value, in the order the declaration lists them, with the value it took from its flag, its variable or its default; the command's own flags as given, in the order given; and, for a command that changes something, `--invocation` and the invocation identity, so the owner of the effect can recognise the repeat, while for one that changes nothing no identity is written, so the repeat is a fresh run.\
An `--invocation` the command was given, in either form, is never copied: the identity appears only as the last two elements, and only for a command that changes something.\
A setting that takes a value is written as two elements, its flag and the text of its value exactly as it was taken - a duration as written, such as `10s` - once for each value, in order, for one that repeats.\
A switch that is on is written as its flag alone, and one that is off is left out, which is exact because a switch has no variable and no default (`OC1`); a setting that took no value has no variable (`OC1`), so leaving it out leaves it without a value in any environment.\
A secret setting is never written: whoever runs the repeat supplies it again, by its flag or its variable, and with the value it had, the repeat reaches the same host, service and principal with the same input, in any environment.\
The plain form prints `repeat` as one command line: the program's name as declared, then each element of `repeat`, each of them - the program's name included - as one shell word in single quotes, each single quote within it written `'\''`, so a program's name holding a space or a quote runs as itself.\
Tested by: `E19`, in `test/contract/repeat-command-line.test.js`, which runs each printed repeat through the real parser and compares the settings and flags it reads with the first run's, for a program's name holding a space and a single quote, whose plain repeat, split into words as a POSIX shell splits it, names exactly that program with the JSON array's arguments unchanged, for an argument holding spaces and quotes, settings taken from flags, from variables and from defaults, the variables then changed or unset before the repeat is run, a duration setting, a switch on and a switch off, a repeating setting, a setting with no value, a secret setting supplied again, an invocation given as `--invocation <identity>` and as `--invocation=<identity>`, a repeat that itself ends unknown, which gives a `repeat` with one `--invocation`, and a command that changes nothing, each in its JSON and its plain form.

**OC6 - The reference, outside Delta 1.**\
`command-reference` generates the reference of every command from the declaration.\
Verified as a design under `E13`; its executable test, `test/contract/command-reference.test.js`, is owed with the capability, which Delta 1 leaves out.

**OC7 - The whole path, and what zorg composes.**\
`test/contract/integrated-commands.test.js` runs a fixture application's declared commands, and the printed repeats of their unknown endings, through operation-call over AGP's production in-process carrier, comparing the input and invocation identity the operation receives, and the output, with the declaration's.\
Its repeats are of a command that changes something and of one that changes nothing, each run with a switch on and with it off, and each repeat is run in a changed environment through the same real parser and path.\
Its interruptions go through the real call layer: one before the send is admitted, which ends not delivered with `agpCode` `ABORTED` and leaves the operation never receiving the request; one after admission and one after the ending, each reporting the call layer's ending unchanged.\
The command-line client of zorg declares its settings, its six invocation commands and its local `proxy` command to operation-command, with zorg's SDK as its client; zorg's own declaration - its settings, commands, groups, how each runs and how each answer is worded - is zorg's `RT2`.\
Tested by: `E19`, in that file; and `E15`, in zorg's `test/e2e/command-configuration.test.js` and `test/e2e/command-endings.test.js`, including a find whose answer takes several pages; and `E15`, in zorg's `packages/zorg-cli/test/interruptions.test.js`, the same interruptions through zorg's SDK and operation-proxy (`RT5`).

---

## Reference

Not yet built.\
This repository, `apnex/operation-command`, private until its first working code: `VISION.md` and, once built, the implementation.

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

**Composed-by:** nothing yet.\
Its first consumer, once built, is zorg's command-line client.

The registry's edge vocabulary has no edge for one component using another's contract without containing it; see the note in operation-call's entry.
