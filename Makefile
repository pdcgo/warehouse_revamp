# Graphify convenience targets.
#
# graphify refreshes the knowledge graph in graphify-out/ in two modes:
#   * a free, AST-only refresh (no LLM, keeps existing names)  -> make graphify-update
#   * a full re-analyze that also (re)names communities via    -> make graphify-full
#     an LLM (this is what turns "Community 231" into a name)
#
# The full and label passes use the `claude-cli` backend: it routes through your
# locally-installed `claude` CLI (Claude Code) and bills the work to your Pro/Max
# subscription — no ANTHROPIC_API_KEY, no pay-as-you-go API credit. Requires the
# `claude` CLI on PATH (you already have it).

GRAPHIFY                  ?= graphify
GRAPHIFY_BACKEND          ?= claude-cli
# Model for the claude-cli backend. Override per-run for a faster/lighter pass:
#   make graphify-label GRAPHIFY_CLAUDE_CLI_MODEL=haiku
GRAPHIFY_CLAUDE_CLI_MODEL ?= opus
export GRAPHIFY_CLAUDE_CLI_MODEL

# graphify skips writing graph.html above 5000 nodes, and this repo is already
# past that — so the viz silently stops regenerating. Raise the ceiling to keep
# it rendering, with headroom as the repo grows. Note a graph this size is heavy
# in a browser; drop the value (or pass --no-viz) if graph.html gets sluggish.
GRAPHIFY_VIZ_NODE_LIMIT   ?= 15000
export GRAPHIFY_VIZ_NODE_LIMIT

# `graphify tree` is a separate viz from the graph.html above: a D3 collapsible
# tree whose hierarchy is the filesystem, not the communities. It only READS an
# existing graph.json, so it needs no LLM and finishes in well under a second —
# but it is only as fresh as the last graphify-update.
#
# Caveat: the emitted HTML loads D3 from https://d3js.org, so it renders blank
# with no network. It is a local review tool, not something to hand off.
GRAPHIFY_TREE_OUT          ?= graphify-out/GRAPH_TREE.html
GRAPHIFY_TREE_LABEL        ?= warehouse_revamp
# Wide directories are truncated to this many children, silently. Raise it if a
# directory looks suspiciously short in the tree.
GRAPHIFY_TREE_MAX_CHILDREN ?= 200

# ---------------------------------------------------------------------------
# Pin the shell. The recipes here are POSIX sh, but on Windows make only uses sh
# if it happens to be on PATH — and from a plain cmd.exe it is NOT (Git ships it
# in "C:\Program Files\Git\usr\bin", which the system PATH does not carry). make
# then falls back silently to cmd.exe, and `dev` fails as nonsense:
#
#     'api' is not recognized as an internal or external command
#
# because cmd reads `&` as a command separator, so `( … ) & api=$!` becomes an
# attempt to RUN a program called `api`. Nothing in the error names the shell,
# which is what makes it worth pinning rather than documenting.
#
# The 8.3 short path (PROGRA~1) sidesteps the space in "Program Files" — make
# cannot quote SHELL, so a spaced path fails to exec.
#
# ⚠ NEVER C:\Windows\System32\bash.exe. That is WSL: a different filesystem with
# a different root, so it cannot see backend/bin — and on this machine WSL has no
# distro installed, so it only errors.
#
# If Git lives somewhere else, this falls back to whatever `sh` PATH resolves —
# the old behaviour, so nothing gets worse.
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
SHELL := $(firstword $(wildcard C:/PROGRA~1/Git/usr/bin/sh.exe) sh)
.SHELLFLAGS := -c
endif

.PHONY: help graphify-full graphify-update graphify-label graphify-tree

.DEFAULT_GOAL := help

help:
	@echo "Development targets:"
	@echo "  make dev           postgres + api (:8080) + ui (:5174) in this terminal; Ctrl-C stops it"
	@echo "  make dev-setup     first run only: migrate every service, then seed the dev fixture"
	@echo "  make dev-db        just the containers (postgres :5433, redis :6380)"
	@echo "  make dev-api       just the api          make dev-ui   just the ui"
	@echo "  make dev-down      stop the containers"
	@echo "  make storybook     the component workbench (:6006)"
	@echo ""
	@echo "Graphify targets:"
	@echo "  make graphify-full     Full re-analyze + semantic community naming (LLM via claude-cli; sequential/slow, uses subscription)"
	@echo "  make graphify-update   Fast AST-only refresh, no LLM, keeps existing community names"
	@echo "  make graphify-label    Re-name communities only (LLM via claude-cli; cheaper than a full pass)"
	@echo "  make graphify-tree     Emit the D3 collapsible tree HTML from the current graph (no LLM, instant)"

graphify-full:
	@echo ">> graphify full pass (backend=$(GRAPHIFY_BACKEND), model=$(GRAPHIFY_CLAUDE_CLI_MODEL)); sequential — this can take a while"
	$(GRAPHIFY) . --backend $(GRAPHIFY_BACKEND)

graphify-update:
	@echo ">> graphify AST-only refresh (no LLM)"
	$(GRAPHIFY) update .

graphify-label:
	@echo ">> graphify community (re)naming (backend=$(GRAPHIFY_BACKEND), model=$(GRAPHIFY_CLAUDE_CLI_MODEL))"
	$(GRAPHIFY) label . --backend $(GRAPHIFY_BACKEND)

graphify-tree:
	@echo ">> graphify collapsible tree -> $(GRAPHIFY_TREE_OUT)"
	$(GRAPHIFY) tree \
		--label "$(GRAPHIFY_TREE_LABEL)" \
		--output "$(GRAPHIFY_TREE_OUT)" \
		--max-children $(GRAPHIFY_TREE_MAX_CHILDREN)

# Same wrapper problem as vite (see the dev section): node_modules/.bin/storybook and
# npm's own launcher are POSIX scripts needing Git coreutils, so they break under a
# cmd.exe PATH. Go straight to the dispatcher through node.
storybook:
	cd frontend && exec node ./node_modules/storybook/dist/bin/dispatcher.js dev -p 6006

# ---------------------------------------------------------------------------
# Development stack — postgres (:5433) + redis (:6380) + API (:8080) + UI (:5174).
#
#   make dev         run the whole stack in this terminal; Ctrl-C stops it
#   make dev-setup   FIRST RUN ONLY — migrate every service, then seed the fixture
#
# `dev` COMPILES the API rather than `go run`-ing it, on purpose: `go run` builds a
# binary and then starts it as a CHILD process, so killing `go run` on Windows can
# orphan that child still holding :8080 — and the next `make dev` then dies on a
# port collision it did not cause. A built binary is one PID, so Ctrl-C really does
# release the port. `backend/bin/` is already gitignored.
#
# The UI runs as `node node_modules/vite/bin/vite.js`, NOT `node_modules/.bin/vite`.
# That wrapper is a POSIX script calling `dirname` and `uname`, which live in Git's
# usr/bin — absent from a cmd.exe PATH, where it resolves a garbage module path and
# dies with `Cannot find module 'D:\vite\bin\vite.js'`. Going through node needs only
# node. Same reason `exec` is used: it makes $! the server's own PID rather than a
# wrapper's, so the trap actually kills the thing holding the port.
# ---------------------------------------------------------------------------

API_PORT ?= 8080
# The UI port is fixed at 5174 by frontend/vite.config.ts (strictPort). It is repeated
# here only so the banner can print it — changing it here does NOT move the server.
UI_PORT  ?= 5174

POSTGRES_HOST     ?= localhost
POSTGRES_PORT     ?= 5433
POSTGRES_USER     ?= user
POSTGRES_PASSWORD ?= password
POSTGRES_DB       ?= postgres

# The same keyword DSN san_dbtarget.LocalDSN() assembles. Passing it explicitly is what
# makes `dev-setup` non-interactive: the CLI prompts for Local-or-Production only when it
# has to work the target out for itself.
DEV_DSN ?= host=$(POSTGRES_HOST) port=$(POSTGRES_PORT) user=$(POSTGRES_USER) password=$(POSTGRES_PASSWORD) dbname=$(POSTGRES_DB) sslmode=disable

ifeq ($(OS),Windows_NT)
API_BIN := backend/bin/app_development.exe
else
API_BIN := backend/bin/app_development
endif

.PHONY: dev dev-db dev-down dev-setup dev-build dev-api dev-ui storybook

dev: dev-db dev-build
	@echo ""
	@echo "  api  http://localhost:$(API_PORT)     ui  http://localhost:$(UI_PORT)"
	@echo "  Ctrl-C stops both. The containers stay up - 'make dev-down' stops those."
	@echo ""
	@trap 'kill $$api $$ui 2>/dev/null' INT TERM; \
	( cd backend && exec "$(CURDIR)/$(API_BIN)" ) & api=$$!; \
	( cd frontend && exec node ./node_modules/vite/bin/vite.js ) & ui=$$!; \
	wait -n $$api $$ui; \
	echo ""; echo ">> one server exited - stopping the other"; \
	kill $$api $$ui 2>/dev/null; true

# --wait blocks on the healthchecks in docker-compose.yaml rather than on the container
# merely existing: postgres accepts connections for a moment before it is actually usable,
# and a migration fired into that window fails for no reason a reader could guess.
dev-db:
	@echo ">> postgres :$(POSTGRES_PORT) + redis :6380"
	docker compose up -d --wait postgres redis

dev-down:
	docker compose down

# Separate from `dev` because it is a ONE-TIME cost that wants to fail loudly. Folding it
# into `dev` would re-run a migration check on every start and bury its error in the
# server banner.
dev-setup: dev-db
	@echo ">> migrating every service, in dependency order"
	go run ./tools/san --dsn "$(DEV_DSN)" migrate up-all
	@echo ">> seeding the dev fixture"
	go run ./tools/san --dsn "$(DEV_DSN)" seed dev

dev-build:
	@echo ">> building the api -> $(API_BIN)"
	go build -o $(API_BIN) ./backend/cmd/app_development

# The halves of `dev`, for a second terminal or when only one side is being worked on.
dev-api: dev-build
	cd backend && exec "$(CURDIR)/$(API_BIN)"

dev-ui:
	cd frontend && exec node ./node_modules/vite/bin/vite.js
