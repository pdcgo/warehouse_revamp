// Parses every ```mermaid block in the repo's markdown with the REAL mermaid parser (#152).
//
// WHY A PARSER AND NOT A GREP. The rule this enforces — "beware characters that break a diagram, like
// ';'" — cannot be checked by searching for those characters, because whether one breaks a diagram
// depends entirely on where it sits. A semicolon inside a QUOTED erDiagram comment is fine; the same
// semicolon in a sequenceDiagram message ends the statement and the whole diagram fails to render.
// When this check was first written, a grep for ';' flagged 24 lines of which only 5 were real, and
// it missed a broken subgraph title that contained no semicolon at all. Only the parser knows.
//
// A broken diagram is invisible in review: the markdown looks fine in a diff, and GitHub renders an
// error box in its place. This is what makes it visible.
//
// Run: npm run lint:mermaid   (from frontend/)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

// Where prose lives. Generated output and dependencies are not ours to lint.
const ROOTS = ["docs", "plans"];
const EXTRA = ["CLAUDE.md", "README.md"];
const SKIP = ["node_modules", ".git", "graphify-out", ".venv", "dist"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.includes(e.name)) walk(p, out);
    } else if (e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

const files = [
  ...ROOTS.flatMap((r) => walk(join(repo, r))),
  ...EXTRA.map((f) => join(repo, f)).filter(existsSync),
];

const blocks = [];

for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  let inBlock = false;
  let start = 0;
  let buf = [];

  lines.forEach((l, i) => {
    if (!inBlock && /^\s*```mermaid/.test(l)) {
      inBlock = true;
      start = i + 1;
      buf = [];
      return;
    }
    if (inBlock && /^\s*```\s*$/.test(l)) {
      blocks.push({ file: relative(repo, f).split(sep).join("/"), line: start, code: buf.join("\n") });
      inBlock = false;
      return;
    }
    if (inBlock) buf.push(l);
  });
}

if (blocks.length === 0) {
  console.log("lint:mermaid — no mermaid blocks found");
  process.exit(0);
}

// Chromium refuses ES-module imports over file:// (CORS), so the host page is served over http.
const work = mkdtempSync(join(tmpdir(), "mermaid-lint-"));
const mermaidEntry = join(repo, "frontend", "node_modules", "mermaid", "dist", "mermaid.esm.mjs");

if (!existsSync(mermaidEntry)) {
  console.error("lint:mermaid — mermaid is not installed. Run `npm install` in frontend/.");
  process.exit(2);
}

writeFileSync(
  join(work, "host.html"),
  `<!doctype html><html><body><script type="module">
     import mermaid from "/mermaid/mermaid.esm.mjs";
     mermaid.initialize({ startOnLoad: false });
     window.__parse = async (code) => {
       try { await mermaid.parse(code); return { ok: true }; }
       catch (e) { return { ok: false, message: String(e && e.message ? e.message : e) }; }
     };
     window.__ready = true;
   </script></body></html>`,
);

const TYPES = { ".html": "text/html", ".mjs": "text/javascript" };

const mermaidDist = dirname(mermaidEntry);

const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");

  // The whole dist directory, not just the entry: mermaid's ESM bundle imports sibling chunks by
  // relative path, so serving one file leaves the import graph dangling and the page never loads.
  const file = rel.startsWith("mermaid/")
    ? normalize(join(mermaidDist, rel.slice("mermaid/".length)))
    : normalize(join(work, rel));

  const allowed = file.startsWith(normalize(mermaidDist)) || file.startsWith(normalize(work));

  if (!allowed || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  res.writeHead(200, { "Content-Type": TYPES[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`http://127.0.0.1:${server.address().port}/host.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

let broken = 0;

for (const b of blocks) {
  const res = await page.evaluate((code) => window.__parse(code), b.code);
  if (!res.ok) {
    broken++;
    console.error(`\nBROKEN  ${b.file}:${b.line}`);
    console.error("        " + res.message.split("\n").slice(0, 4).join("\n        "));
  }
}

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });

if (broken > 0) {
  console.error(`\nlint:mermaid — ${broken} of ${blocks.length} diagrams do not parse.`);
  console.error("A diagram that does not parse renders as an error box, not as a picture (#152).");
  process.exit(1);
}

console.log(`lint:mermaid — ${blocks.length} diagrams parse`);
