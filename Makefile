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
GRAPHIFY_VIZ_NODE_LIMIT   ?= 9000
export GRAPHIFY_VIZ_NODE_LIMIT

.PHONY: help graphify-full graphify-update graphify-label
.DEFAULT_GOAL := help

help:
	@echo "Graphify targets:"
	@echo "  make graphify-full     Full re-analyze + semantic community naming (LLM via claude-cli; sequential/slow, uses subscription)"
	@echo "  make graphify-update   Fast AST-only refresh, no LLM, keeps existing community names"
	@echo "  make graphify-label    Re-name communities only (LLM via claude-cli; cheaper than a full pass)"

graphify-full:
	@echo ">> graphify full pass (backend=$(GRAPHIFY_BACKEND), model=$(GRAPHIFY_CLAUDE_CLI_MODEL)); sequential — this can take a while"
	$(GRAPHIFY) . --backend $(GRAPHIFY_BACKEND)

graphify-update:
	@echo ">> graphify AST-only refresh (no LLM)"
	$(GRAPHIFY) update .

graphify-label:
	@echo ">> graphify community (re)naming (backend=$(GRAPHIFY_BACKEND), model=$(GRAPHIFY_CLAUDE_CLI_MODEL))"
	$(GRAPHIFY) label . --backend $(GRAPHIFY_BACKEND)
