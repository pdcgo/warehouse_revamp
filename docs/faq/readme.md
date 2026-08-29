# FAQ

**Every question anyone on this team has had to ask, with the answer, once.**

We are several people building this, and people join. The same handful of questions — *which branch
do I commit to, why is Postgres on 5433, where does this component go, why is my RPC denied* — get
asked over and over, answered in chat, and lost. This folder is where the answer goes so the second
person to ask finds it instead of asking.

**New here? Start with [getting-started.md](getting-started.md).**

---

## The rule

> **Answered a question? Write it down here, the same day.**

An answer that lives only in a chat thread will be asked again next month, and the answer given the
second time will be slightly different. That drift is the actual cost.

- The FAQ **explains and points** — it never becomes a second source of truth. The authority is
  `CLAUDE.md`, `guidelines/`, the code and the other `docs/`; an entry says the short answer and
  links there.
- **Not decided yet is a valid answer.** Say so, and link the `_clarify.md` where it is being
  argued (flagged as not-yet-decided) or say plainly that nothing is written yet. Do not settle an
  open design question in the FAQ — that is the owner's call.
- One `##` heading per question, phrased **the way it was actually asked**.

---

## Where things are

| File | Covers |
| --- | --- |
| [getting-started.md](getting-started.md) | first day — what to read, running it locally, logging in, ports |
| [workflow.md](workflow.md) | branches, issues, the board, which docs a change must carry, serving the repo to an agent |
| [backend.md](backend.md) | services, RPCs, Wire, tests, the audits, authorization |
| [contract.md](contract.md) | the proto: generation, pagination, who may call what |
| [database.md](database.md) | migrations, the local database, the test database, Redis |
| [frontend.md](frontend.md) | where files go, the design system, freshness, Storybook, e2e |
| [troubleshooting.md](troubleshooting.md) | symptoms and what they turned out to be |

---

## Every question

### Getting started

- [I just joined the team. What do I read, and in what order?](getting-started.md#i-just-joined-the-team-what-do-i-read-and-in-what-order)
- [How do I get everything running locally?](getting-started.md#how-do-i-get-everything-running-locally)
- [How do I log in? The database has no users.](getting-started.md#how-do-i-log-in-the-database-has-no-users)
- [The app runs but every screen is empty. What did I miss?](getting-started.md#the-app-runs-but-every-screen-is-empty-what-did-i-miss)
- [Why are the ports 5433 / 6380 / 5174 instead of the usual ones?](getting-started.md#why-are-the-ports-5433--6380--5174-instead-of-the-usual-ones)
- [What should I work on?](getting-started.md#what-should-i-work-on)
- [My question isn't in this FAQ. What do I do?](getting-started.md#my-question-isnt-in-this-faq-what-do-i-do)

### Working on the project

- [Which branch do I commit to? Do I open a PR per task?](workflow.md#which-branch-do-i-commit-to-do-i-open-a-pr-per-task)
- [How do I pick up an issue?](workflow.md#how-do-i-pick-up-an-issue)
- [Where is the real spec for an issue?](workflow.md#where-is-the-real-spec-for-an-issue)
- [`gh issue view N --comments` errors. What do I use instead?](workflow.md#gh-issue-view-n---comments-errors-what-do-i-use-instead)
- [How do I know which issue is highest priority?](workflow.md#how-do-i-know-which-issue-is-highest-priority)
- [What has to be green before I commit?](workflow.md#what-has-to-be-green-before-i-commit)
- [Which docs must I update in the same commit as my change?](workflow.md#which-docs-must-i-update-in-the-same-commit-as-my-change)
- [Where do I write a design idea?](workflow.md#where-do-i-write-a-design-idea)
- [Can I edit one of the owner's requirement docs?](workflow.md#can-i-edit-one-of-the-owners-requirement-docs)
- [How does work get done here?](workflow.md#how-does-work-get-done-here)
- [Can I copy a model / screen / enum from the other repos on this machine?](workflow.md#can-i-copy-a-model--screen--enum-from-the-other-repos-on-this-machine)
- [I hit a genuine design fork. Do I just pick one?](workflow.md#i-hit-a-genuine-design-fork-do-i-just-pick-one)
- [This repo is public. What does that change?](workflow.md#this-repo-is-public-what-does-that-change)
- [How do I let another AI agent work on this checkout?](workflow.md#how-do-i-let-another-ai-agent-work-on-this-checkout)
- [How do I let Claude on the web work on my local checkout?](workflow.md#how-do-i-let-claude-on-the-web-work-on-my-local-checkout)
- [Why does `san remote` have its own token instead of a normal login?](workflow.md#why-does-san-remote-have-its-own-token-instead-of-a-normal-login)

### Backend

- [Where do I put a new service?](backend.md#where-do-i-put-a-new-service)
- [How do I add an RPC?](backend.md#how-do-i-add-an-rpc)
- [How do I wire a new service in?](backend.md#how-do-i-wire-a-new-service-in)
- [Where do models and migrations go? Can two services share a model?](backend.md#where-do-models-and-migrations-go-can-two-services-share-a-model)
- [Where do I run `go build` / `go test` from?](backend.md#where-do-i-run-go-build--go-test-from)
- [Do the tests touch my development database?](backend.md#do-the-tests-touch-my-development-database)
- [My Go tests all pass suspiciously fast. Are they actually running?](backend.md#my-go-tests-all-pass-suspiciously-fast-are-they-actually-running)
- [Do I really have to audit every RPC?](backend.md#do-i-really-have-to-audit-every-rpc)
- [Where did `backend/cmd/tool` go?](backend.md#where-did-backendcmdtool-go)
- [How do I reset a user's password?](backend.md#how-do-i-reset-a-users-password)
- [Why is my new RPC returning permission denied?](backend.md#why-is-my-new-rpc-returning-permission-denied)
- [Does the token carry my role?](backend.md#does-the-token-carry-my-role)
- [How is Go written here?](backend.md#how-is-go-written-here)

### The proto contract

- [Where do I change the API?](contract.md#where-do-i-change-the-api)
- [I changed a `.proto` and nothing changed in my code. Why?](contract.md#i-changed-a-proto-and-nothing-changed-in-my-code-why)
- [Can I edit anything under `gen/`?](contract.md#can-i-edit-anything-under-gen)
- [Does my list RPC need pagination?](contract.md#does-my-list-rpc-need-pagination)
- [Where do I declare who may call an RPC?](contract.md#where-do-i-declare-who-may-call-an-rpc)
- [What other behaviour is declared on a proto message?](contract.md#what-other-behaviour-is-declared-on-a-proto-message)
- [What do I need installed to run `buf generate`?](contract.md#what-do-i-need-installed-to-run-buf-generate)
- [`buf generate` emptied `backend/gen` and `frontend/src/gen`. What happened?](contract.md#buf-generate-emptied-backendgen-and-frontendsrcgen-what-happened)
- [`protoc-gen-es` says "Cannot read properties of undefined (reading 'length')"](contract.md#protoc-gen-es-says-cannot-read-properties-of-undefined-reading-length)
- [How do I call an RPC by hand, without the UI?](contract.md#how-do-i-call-an-rpc-by-hand-without-the-ui)
- [What is `HelloService` for?](contract.md#what-is-helloservice-for)

### Database

- [How do I create a migration?](database.md#how-do-i-create-a-migration)
- [How do I apply migrations?](database.md#how-do-i-apply-migrations)
- [It is prompting me for Local or Production. Which do I pick?](database.md#it-is-prompting-me-for-local-or-production-which-do-i-pick)
- [Why is Postgres on 5433?](database.md#why-is-postgres-on-5433)
- [Do I have to update `docs/database-schema.md`?](database.md#do-i-have-to-update-docsdatabase-schemamd)
- [How do I reset my local database?](database.md#how-do-i-reset-my-local-database)
- [How do I seed categories?](database.md#how-do-i-seed-categories)
- [Where is my data actually stored?](database.md#where-is-my-data-actually-stored)
- [Which database do automated tests use?](database.md#which-database-do-automated-tests-use)
- [What about Redis?](database.md#what-about-redis)

### Frontend

- [Where do I put a new file?](frontend.md#where-do-i-put-a-new-file)
- [Do I write the component myself?](frontend.md#do-i-write-the-component-myself)
- [Can I use a raw `<button>` / `<input>` / `<select>` / `<div>`?](frontend.md#can-i-use-a-raw-button--input--select--div)
- [Where do sizes, spacing and colours come from?](frontend.md#where-do-sizes-spacing-and-colours-come-from)
- [How do I add an icon?](frontend.md#how-do-i-add-an-icon)
- [Why does my list flicker, or show stale numbers?](frontend.md#why-does-my-list-flicker-or-show-stale-numbers)
- [How does mobile work? Do I add responsive props?](frontend.md#how-does-mobile-work-do-i-add-responsive-props)
- [Where does user-visible text go?](frontend.md#where-does-user-visible-text-go)
- [How do I run Storybook?](frontend.md#how-do-i-run-storybook)
- [Does my component need a Storybook story?](frontend.md#does-my-component-need-a-storybook-story)
- [What bites when writing a story?](frontend.md#what-bites-when-writing-a-story)
- [How do I run the e2e?](frontend.md#how-do-i-run-the-e2e)

### Troubleshooting

- [My mermaid diagram renders as an error box](troubleshooting.md#my-mermaid-diagram-renders-as-an-error-box)
- [`graphify: command not found`](troubleshooting.md#graphify-command-not-found)
- [`python3: command not found`](troubleshooting.md#python3-command-not-found)
- [Storybook pickers never fill — every dropdown is empty](troubleshooting.md#storybook-pickers-never-fill--every-dropdown-is-empty)
- [My story needs `useTeam()` and throws](troubleshooting.md#my-story-needs-useteam-and-throws)
- [`wire_gen.go` is not picking up my new provider](troubleshooting.md#wire_gengo-is-not-picking-up-my-new-provider)
- [`buf generate` output does not match what CI expects](troubleshooting.md#buf-generate-output-does-not-match-what-ci-expects)
- [The e2e passes locally but the results make no sense](troubleshooting.md#the-e2e-passes-locally-but-the-results-make-no-sense)
- [A port is already in use](troubleshooting.md#a-port-is-already-in-use)
- [Permission denied calling an RPC](troubleshooting.md#permission-denied-calling-an-rpc)
- [Something cached is stale after I changed a role/permission](troubleshooting.md#something-cached-is-stale-after-i-changed-a-rolepermission)
- [A Pub/Sub message keeps being redelivered forever](troubleshooting.md#a-pubsub-message-keeps-being-redelivered-forever)
- [My MCP endpoint answers 403 to everything, but only through the tunnel](troubleshooting.md#my-mcp-endpoint-answers-403-to-everything-but-only-through-the-tunnel)
- [My MCP client re-initializes on every call and loses its state](troubleshooting.md#my-mcp-client-re-initializes-on-every-call-and-loses-its-state)
- [My MCP client connects but every tool call comes back unauthorized](troubleshooting.md#my-mcp-client-connects-but-every-tool-call-comes-back-unauthorized)

---

## How do I add a new question?

With Claude Code, run **`/faq-create`** and give it the question — it picks the file, writes the
entry in house style, adds the index row, and checks nothing already answers it.

By hand, five steps:

1. **Check it is not already answered** — search this folder before adding. A near-duplicate is
   worse than nothing: two entries drift apart and neither is trusted.
2. **Pick the file** from the table above. If the question fits none of them, add a new file rather
   than stretching one — and add it to the table.
3. **Write the question as a `##` heading, in the asker's words.** Not the tidy version. People
   search for what they would have typed: *"why is my list flickering"*, not *"query cache
   configuration"*.
4. **Answer short.** The shortest true answer, then a link to the authority. If the answer runs past
   about fifteen lines, the real answer belongs in a proper doc and the FAQ entry links to it.
   Include the *why* when the rule looks arbitrary — "Postgres is on 5433" is forgettable, "because
   another project already holds 5432 and we must not share its database" is not.
5. **Add the row to *Every question* above**, in the same commit.

### House style

| Do | Don't |
| --- | --- |
| one question per `##` heading | one heading covering three questions |
| the asker's phrasing | the tidied-up phrasing nobody would search for |
| link the authoritative doc | restate its content and let the copy go stale |
| say "not decided yet" and link the `_clarify.md` | settle an open design question here |
| a table or a list | a paragraph |
| the symptom, in `troubleshooting.md` | the diagnosis as the heading — people search the symptom |

### When an entry goes out of date

**Fix it or delete it.** A wrong FAQ entry is worse than a missing one — it is confidently wrong,
and the reader has no reason to doubt it. If a rule changes, grep this folder for it in the same
commit that changes the rule.
