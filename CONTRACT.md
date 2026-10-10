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
| `declared-command-dispatch` | provides | none | Commands, their flags, the environment variables that stand in for them, their defaults and their valid values are declared as data; a flag overrides its variable and a variable its default, and a command that breaks its declaration is refused with a usage error before anything is invoked. | none |
| `ending-exit-status` | provides | `operation-call:honest-call-ending` | Each of the call layer's four endings, and a usage error, exits with its own status and prints its own record, in a plain form or as one JSON object, with the ending unchanged. | none |
| `repeat-command-line` | provides | `operation-call:invocation-identity` | An invocation that ends unknown prints the command that repeats it under its invocation identity, as a list of arguments and as one quoted command line; a command given that identity repeats the same request. | none |
| `command-call-bound` | provides | `operation-call:caller-chosen-bound` | A command's declared settings give its call's bound and the time it may take to reach its caller, so neither is left to defaults the application cannot see. | none |
| `command-reference` | provides | none | A reference of every command, its flags, their variables, defaults and valid values is generated from the declaration, never written beside it. | none |

The component holds nothing between runs, coordinates no actors and contains no model, so none of its capabilities brings a trait.\
In zorg's Delta 1, all rows but `command-reference` are built, for zorg's six commands; `command-reference` is left out of Delta 1, which drawv2's command line, generating its help from its manifest, needs.

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
