---
name: faq-create
description: Record a question and its answer in docs/faq/ so the next person finds it instead of asking. Use when someone asks a question that has been asked before or will be, when a question was just answered in chat, when onboarding friction is hit ("how do I run this", "why is this port odd", "where does this file go"), or when asked to add/update/check an FAQ entry.
---

# Create an FAQ entry

`docs/faq/` exists because several people build this and people join. The same handful of questions
get asked, answered in chat, and lost — and the answer given the second time is slightly different.
That drift is the cost this folder pays down.

**One question in, one entry out.** The FAQ *explains and points*; it never becomes a second source
of truth.

Run everything from the repo root.

---

## 1 — Get the question in the asker's words

The question is either the skill's argument, or the thing just asked in the conversation.

**Write the heading the way it was actually asked**, not the tidy version. People search for what
they would have typed:

| Write this | Not this |
| --- | --- |
| `## Why does my list flicker, or show stale numbers?` | `## Query cache configuration` |
| `## The app runs but every screen is empty. What did I miss?` | `## Seeding` |
| `## graphify: command not found` | `## Tooling setup` |

If the question arrived vague ("the thing with the ports"), restate it as the question a newcomer
would type and confirm that reading in your reply.

---

## 2 — Check it is not already answered

**A near-duplicate is worse than nothing** — two entries drift apart and neither is trusted.

```sh
grep -rin "<a few keywords>" docs/faq/
```

Then decide:

| Found | Do |
| --- | --- |
| an entry that already answers it | **Do not add.** Point at it. If it was hard to find, improve its heading — that is the real bug |
| an entry that answers it *partly* | **Extend that entry.** Never add a second heading beside it |
| nothing | continue |

---

## 3 — Pick the file

| File | Covers |
| --- | --- |
| `getting-started.md` | first day — what to read, running it, logging in, ports |
| `workflow.md` | branches, issues, the board, which docs a change must carry, `plans/` vs `disscuss/` |
| `backend.md` | services, RPCs, Wire, tests, the audits, authorization |
| `contract.md` | the proto: generation, pagination, who may call what |
| `database.md` | migrations, the local database, the test database, Redis |
| `frontend.md` | where files go, the design system, freshness, Storybook, e2e |
| `troubleshooting.md` | **symptoms** and what they turned out to be |

Two judgement calls:

- **"Why is X broken?" goes in `troubleshooting.md`; "how does X work?" goes in its topic file.**
  Cross-link rather than answering twice — the topic file owns the explanation, troubleshooting owns
  the symptom and links to it.
- **If it fits none of them, add a new file** rather than stretching one, and add it to the table in
  both `docs/faq/readme.md` and here.

---

## 4 — Find the authoritative answer before writing it

The FAQ must not invent an answer, and must not become the place a rule is *defined*. Establish
where the truth lives first:

```sh
graphify query "<the question>"        # code questions — before grep/read
grep -n "<keyword>" CLAUDE.md guidelines/*.md guidelines/architectures/*.md
ls plans/ docs/
```

| Authority | Where |
| --- | --- |
| the project's rules | `CLAUDE.md` |
| service / RPC shapes | `guidelines/` (programmer-authoritative) |
| schema | `docs/database-schema.md` + the migrations |
| RPC flows | `docs/services/<service>/rpc.md` |
| the CLI | `docs/tools/san.md` |
| still being designed | `plans/<service>/brainstorming.md` |

⚠ **`disscuss/` is never an answer.** It is mid-argument by definition — never cite it as decided.

⚠ **If the answer is not decided, that IS the entry:** say so plainly and link the `plans/` doc.
Never settle an open design question here — that is the owner's call.

⚠ **Never answer from a sibling repo under `d:\pdcgo`.** They are not a design input.

---

## 5 — Write the entry

Append to the chosen file, in the existing shape:

```markdown
---

## <the question, as asked>

<The shortest true answer — the first line should answer it.>

<Then the why, if the rule looks arbitrary, and a link to the authority.>
```

House style — this is what the review checks:

| Do | Don't |
| --- | --- |
| the shortest true answer first, detail after | build up to the answer |
| **include the *why*** when the rule looks arbitrary | state the rule bare |
| link the authoritative doc | restate its content and let the copy go stale |
| a table or a list | a paragraph |
| runnable commands, copy-pasteable, with the directory they run from | prose describing a command |
| relative links (`../database-schema.md`, `../../CLAUDE.md`) | absolute paths |

**"Postgres is on 5433" is forgettable. "Because another project on this machine already holds 5432
and this system must not share its database" is not** — the why is what makes an answer stick, and
it is why the same question stops coming back.

**Keep it under about fifteen lines.** Longer means the real answer belongs in a proper doc — write
it there and let the FAQ entry link to it.

Remember the repo is **public**: no credentials, no names of unrelated internal systems. The
deliberately-public development credentials (`docker-compose.yaml`, `seed dev`) are the exception.

---

## 6 — Add the index row

`docs/faq/readme.md` → *Every question* → the right section, in the same commit. An entry missing
from the index is an entry nobody finds.

The anchor is the heading lowercased, punctuation dropped, spaces hyphenated — a `/` or `—` between
spaces leaves **two** hyphens. Generate them rather than guessing:

```sh
node -e '
const fs=require("fs"),f=process.argv[1];
const slug=s=>s.toLowerCase().replace(/[`*]/g,"").replace(/[^\w\s-]/g,"").trim().replace(/\s/g,"-");
for(const l of fs.readFileSync("docs/faq/"+f,"utf8").split("\n"))
  if(l.startsWith("## ")){const q=l.slice(3).trim();console.log(`- [${q}](${f}#${slug(q)})`)}
' <file>.md
```

---

## 7 — Verify

```sh
grep -c '^## ' docs/faq/<file>.md          # the entry landed
grep -n '<the question>' docs/faq/readme.md # the index row landed
cd frontend && npm run lint:mermaid         # only if the entry has a mermaid diagram
```

Click-check every link you wrote actually resolves (the file exists, the anchor matches a heading).

---

## 8 — Report

Two lines, no more:

```
Added to docs/faq/<file>.md — "<the question>"
Answer sourced from <authority>. Indexed in docs/faq/readme.md.
```

If you found an existing entry instead of adding one, say which and stop — that is the better
outcome.

---

## Also use this skill to KEEP the FAQ true

**A wrong FAQ entry is worse than a missing one** — it is confidently wrong and the reader has no
reason to doubt it.

When a rule changes, grep `docs/faq/` for it **in the same commit that changes the rule**, and fix
or delete what is now false:

```sh
grep -rin "<the thing that changed>" docs/faq/
```

Deleting a stale entry is a valid, complete outcome.
