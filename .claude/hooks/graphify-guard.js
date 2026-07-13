#!/usr/bin/env node
/**
 * PreToolUse guard: nudge toward `graphify query` before raw source exploration.
 *
 * Self-guarding: emits nothing unless graphify-out/graph.json exists, so it stays
 * silent while this repo has no code (and therefore no graph).
 *
 * Node, not python3 — python3 does not exist on this machine, which is why an
 * equivalent python3-based hook elsewhere never fires.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const GRAPH = path.join(PROJECT_ROOT, "graphify-out", "graph.json");

const SEARCH_CMD = /(^|[|;&\s])(grep|egrep|fgrep|rg|ripgrep|ack|ag|find|fd)(\s|$)/;

const SOURCE_EXT = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".kt", ".swift", ".php",
  ".scala", ".lua", ".sh", ".sql", ".proto", ".md", ".rst", ".txt", ".mdx",
]);

const ADVICE =
  "graphify-out/graph.json exists. Prefer `graphify query \"<question>\"` before raw grep/read " +
  "— it returns a scoped subgraph, usually far smaller than grep output or GRAPH_REPORT.md. " +
  "Also: `graphify explain \"<concept>\"`, `graphify path \"<A>\" \"<B>\"`, `graphify affected \"<X>\"`. " +
  "Read raw files once graphify has oriented you, or to modify/debug specific lines. " +
  "Applies to subagents too — carry this into their prompts.";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context,
      },
    })
  );
}

function main(raw) {
  // The whole point of the guard: no graph => stay silent.
  if (!fs.existsSync(GRAPH)) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const tool = payload.tool_name || "";
  const input = payload.tool_input || {};

  if (tool === "Bash") {
    if (SEARCH_CMD.test(String(input.command || ""))) emit(ADVICE);
    return;
  }

  if (tool === "Read" || tool === "Glob") {
    const target = [input.file_path, input.pattern, input.path]
      .filter(Boolean)
      .join(" ")
      .replace(/\\/g, "/")
      .toLowerCase();

    if (!target || target.includes("graphify-out/")) return;
    if ([...SOURCE_EXT].some((ext) => target.includes(ext))) emit(ADVICE);
  }
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  try {
    main(stdin);
  } catch {
    // Never block a tool call because the guard misbehaved.
  }
  process.exit(0);
});
