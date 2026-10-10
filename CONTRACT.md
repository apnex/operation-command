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

The contract of record for operation-command: what a consumer can depend on, admitted to zorg's component set by the director's rulings `D35` and `D37` in zorg's `docs/DECISIONS.md`; its vision awaits the director's ratification, and until then this contract is a draft.\
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
| `ending-exit-status` | provides | `operation-call:honest-call-ending` | Each of the call layer's four endings, and a usage error, exits with its own status and prints its own record, in a plain form or as one JSON object, with the ending unchanged. | none |
| `repeat-command-line` | provides | `operation-call:invocation-identity` | An invocation that ends unknown prints the command that repeats it, with the settings it used: under its invocation identity when it changes something, so the owner of the effect can recognise the repeat, and as a fresh run when it changes nothing; as a list of arguments and as one quoted command line. | none |
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
Its settings: each with a flag, an optional environment variable, an optional default, a type and its valid values, and whether it is secret.\
Its commands: each with a name, its own flags, groups of its flags of which exactly one, or at least one, must be given, whether the command changes anything, and the application's `run` function, which performs the command's invocation through the application's client and returns the call layer's ending.\
Its client: an object the application supplies, which `run` calls through - for zorg, its SDK over entity-api and operation-proxy's client half - and which may offer a `prepare` step.\
A command may instead be local: operation-command reads its flags and passes them to the application's code, whose exit is its own, with no invocation and no ending.\
A flag's type is a string matching a stated pattern, a whole number within stated bounds, a duration within stated bounds, a URL of stated schemes, or a switch; a flag may be required, may repeat, and may exclude or require another flag.\
A duration is a whole number with no sign followed by one of `ms`, `s`, `m`, `h` or `d`, in lower case.\
The declaration names the settings that give a call's bound and its time to prepare (`command-call-bound`).\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a fixture application.

**OC2 - Reading a command.**\
Arguments are the command's name followed by flags written `--flag value` or `--flag=value`, or `--flag` alone for a switch, which takes no value; a setting's value comes from its flag, else its variable, else its default, and a variable set to the empty string counts as unset.\
A usage error is any of: an unknown command or flag; a flag without its value, or a switch given one; a flag given twice that may not repeat; a required flag missing; a value of the wrong type or outside its valid values; two flags that exclude each other; a flag missing that another requires; and a group with none of its flags given, or with more than one given when exactly one must be.\
A usage error prints `usage: ` and what was wrong on standard error, one line, and exits with status 1 before the client is prepared, so nothing is prepared and nothing is invoked.\
Tested by: `E19`, in `test/contract/declared-command-dispatch.test.js`, with a case for each kind of usage error, each group with none, one and two of its flags, an empty variable, a flag overriding its variable, a variable overriding its default, a repeated flag kept in order, and neither preparing nor invoking on any usage error.

**OC3 - Invoking.**\
A command prepares its client, when the client offers `prepare`, with a deadline of the moment the command started plus its preparation setting, then calls its `run` with the parsed flags and the call's settings: its bound setting as the call's bound, the invocation identity given by `--invocation` - which marks the invocation as a repeat - or a new one as `EM11` writes it, and an abort signal.\
A value of `--invocation` that is not an invocation identity as `EM11` writes it is a usage error.\
The invocation `run` reports is the one the command prints; a command whose `run` makes several calls, as zorg's find does for its pages, reports its first call's identity, which is the one it was given (`EM10`).\
Tested by: `E19`, in `test/contract/command-call-bound.test.js`, with a fixture client recording the preparation deadline and the bound, identity, repeat flag and abort signal `run` receives.

**OC4 - Exit statuses and output.**\
A command prints its ending on standard output and nothing else there; standard error carries only diagnostics and usage errors.

| Ending | Exit status | Fields with `--json`, besides `ending`, `operation` and `invocation` |
|---|---|---|
| answered | 0 | `answer`, as the operation gave it |
| refused | 2 | `refusal`, the refusal record unchanged (zorg's `D21`) |
| not delivered | 3 | `agpCode` and `proxyCode`, each the ending's or `null`; `earlierAttemptsUncertain`, true for a repeat |
| unknown | 4 | `reason`; `agpCode` or `null`; `deliveryReport`, `delivered`, `unknown` or `null`; and `repeat` (`OC5`) |
| usage error | 1 | none; `OC2` |

`ending` is written `answered`, `refused`, `not-delivered` or `unknown`, exactly as the call layer names it.\
A command interrupted by `SIGINT` or `SIGTERM` before it called `run` exits with status 1, printing `interrupted: nothing was invoked` on standard error; interrupted after, it fires the abort signal it gave `run`, which the call layer honours as `EM12` says - ending the call not delivered with `ABORTED` only if its send was not yet admitted - and prints whatever ending the call layer gives, within the bound; a second interruption ends the process at once, printing nothing more.\
With `--json` a command prints one JSON object holding those fields; without it, it prints the same facts one per line, as a name, a colon and a value, the answer worded by the application.\
Tested by: `E19`, in `test/contract/ending-exit-status.test.js`, which checks each ending's status, its JSON object whole and its plain form with a fixture client, and an interruption before `run`, one after with the send not yet admitted, one after admission, and one after the ending was already given.

**OC5 - Repeating an unknown ending.**\
Every unknown ending carries `repeat`: a JSON array of strings - the program's name, the command's name, every setting not secret with the value it took, from its flag, variable or default, written as its flag, then the command's own flags as given, with any `--invocation` in either form removed; for a command that changes something, `--invocation` and the invocation identity are added at the end, so the store can recognise the repeat, and for one that changes nothing, nothing is added, so the repeat is a fresh run.\
The plain form prints `repeat` as one command line, each element in single quotes and each single quote within one written `'\''`.\
Run in a different environment, the repeat still reaches the same host, service and principal with the same input, except where a setting is secret and must come from the environment again.\
Tested by: `E19`, in `test/contract/repeat-command-line.test.js`, for an argument holding spaces and quotes, settings taken from variables then changed or unset before the repeat is run, an invocation given as `--invocation=<identity>`, a repeat that itself ends unknown, which gives a `repeat` with one `--invocation`, and a command that changes nothing.

**OC6 - The reference, outside Delta 1.**\
`command-reference` generates the reference of every command from the declaration.\
Verified as a design under `E13`; its executable test, `test/contract/command-reference.test.js`, is owed with the capability, which Delta 1 leaves out.

**OC7 - The whole path, and what zorg composes.**\
`test/contract/integrated-commands.test.js` runs a fixture application's declared commands, and the printed repeats of their unknown endings, through operation-call over AGP's production in-process carrier, comparing the input and invocation identity the operation receives, and the output, with the declaration's.\
The command-line client of zorg declares its settings, its six invocation commands and its local `proxy` command to operation-command, with zorg's SDK as its client; zorg's own declaration - its settings, commands, groups, how each runs and how each answer is worded - is zorg's `RT2`.\
Tested by: `E19`, in that file; and `E15`, in zorg's `test/e2e/command-configuration.test.js` and `test/e2e/command-endings.test.js`, including a find whose answer takes several pages.

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
