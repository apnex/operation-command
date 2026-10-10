# operation-command - Vision

**Status: drafted 2026-10-10 under zorg's `D35` and `D37`; not ratified.**\
This document states why operation-command exists and what it will never be.\
It carries no current state, no roadmap, and no schedule.

Holding this document authorises nothing.\
It does not ratify a decision, admit a component to any registry, or approve a contract change.\
Until the director ratifies it, it is a proposal, and nothing may cite it as enduring.\
A change of direction is recorded as a decision first and absorbed here afterwards.

---

## North star

> Let any application offer its named operations as commands from a declaration alone, so that whoever runs one - a person or an agent - learns from its exit status and output exactly how the invocation ended, and how to repeat it when that cannot be known.

Four terms in that sentence carry weight, so this document defines them rather than leaving them to the reader.

**Named operations** means operations a caller reaches by name and that end in one of four ways: answered, refused with a reason, not delivered, or unknown.

**A declaration alone** means each command, its flags, the environment variables that may stand in for them, their defaults and their valid values are written as data, and the application writes no parsing of its own.

**Exactly how the invocation ended** means each of the four endings, and an error in the command itself, has its own exit status and its own output, so a script or an agent can act on it without reading prose.

**How to repeat it** means an invocation whose ending is unknown prints the command that repeats it under the same invocation identity, so whatever owns the effect can recognise the repeat.

---

## Why it exists

A command is how an agent or a script most easily reaches an operation.\
Every application that offers commands writes the same layer: parsing flags, choosing between a flag, an environment variable and a default, refusing a bad command before doing anything, printing an answer, and choosing an exit status.

Most of them lose the one distinction that matters most.\
A command that exits with "failed" when the honest answer is "unknown" teaches an agent to repeat a write that may already have landed, and a command that cannot say how to repeat itself leaves the agent to guess.

operation-command writes that layer once, so a command tells the truth about its operation through the channel a script reads first: its exit status.

---

## What it is

A library that a command-line program embeds.\
It reads a declaration of commands, takes the program's arguments and environment, invokes the named operation through a caller of the call layer, prints the ending, and exits with that ending's status.

The application supplies its declaration, the caller to invoke through, and how its answers are worded; operation-command supplies everything between.

---

## What it is not

**Not the call layer.**\
It does not pair answers with requests, keep a call's bound, or decide how a call ended; it reports the ending the call layer gives it, unchanged.

**Not a retrier.**\
It never repeats an invocation on its own; it prints how to repeat one, and the person or agent decides.

**Not a shell or a terminal interface.**\
It runs one command and exits; it keeps no session, draws no screen, and offers no prompts.

**Not the application's voice.**\
What a command is called, what it says about itself, and how an answer reads are the application's, supplied with the declaration.

**Not an authority.**\
It passes the identity it is configured with to the caller, and decides nothing about what that identity may do.

**Not agentic.**\
It is run by agents and contains no cognition, model, or orchestration.

---

## What success means

Four dimensions.\
They are not weighted, and they do not collapse.

**Honest exits.**\
Every command exits with the status of the ending that is true.\
The measure is that no unknown ending ever exits as an answer or as not delivered, and every unknown ending prints how to repeat it.

**Ease.**\
A new command is a new declaration.\
The measure is the code an application writes to add a command, beyond declaring it and wording its answer, stated and small.

**Leanness.**\
It adds little time or code to the call beneath.\
The measure is its own cost per command, stated and small against the invocation.

**Reuse.**\
A second, unrelated application adopts it without a variant, a fork, or a privileged path.

A programme strong on three of these and weak on one has one unmet dimension, and which one it is says more than any average of the four.

---

## Authority

Held by the director.\
Drafted by anyone; ratified only by the director.

This statement is amended, never quietly rewritten.\
A ruling that changes direction is recorded as a decision and absorbed here, so the reasoning survives the change.

Where this narrative and a verified record disagree about state, the record governs.
