#!/usr/bin/env node
// Frontend structure inventory — the MECHANICAL half of /audit-frontend-structure.
//
// Emits facts only, never verdicts: file sizes, locally-declared components and their
// line spans, inline-unit markers, and three cross-checks that are pure bookkeeping
// (misfiled page components, missing gallery `description`, components absent from the
// gallery). Judgement is the agents' job — see SKILL.md.
//
//   node .claude/skills/audit-frontend-structure/inventory.mjs          # ranked table
//   node .claude/skills/audit-frontend-structure/inventory.mjs --json   # machine-readable
//   node .claude/skills/audit-frontend-structure/inventory.mjs --page product-detail

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = "frontend/src";
const GALLERY = `${SRC}/pages/components-gallery/index.tsx`;

// A page directory that is large BY DESIGN — one entry per component is the point of it.
const EXEMPT_PAGES = new Set(["components-gallery"]);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const onlyPage = args.includes("--page") ? args[args.indexOf("--page") + 1] : null;

if (!existsSync(SRC)) {
  console.error(`error: ${SRC} not found — run this from the repo root.`);
  process.exit(1);
}

const read = (p) => readFileSync(p, "utf8");
const lines = (s) => s.split(/\r?\n/);
const dirs = (p) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : [];
const tsx = (p) =>
  existsSync(p) ? readdirSync(p).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)) : [];

// ── locally-declared components ───────────────────────────────────────────────
// Top-level `function X` / `const X = ...` whose name is Capitalised and whose body
// contains JSX. The line span is what makes it a candidate: a 90-line local component
// is a file waiting to happen, a 6-line one is a helper.
// The file's OWN page/component export is flagged `isPage` and excluded from the
// candidate list — a 620-line page body is the symptom, not something to move.
function localComponents(src) {
  const ls = lines(src);
  const decls = [];
  ls.forEach((line, i) => {
    const m = line.match(/^(export\s+)?(default\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/);
    if (m) decls.push({ name: m[3], exported: Boolean(m[1]), start: i });
  });
  return decls
    .map((d, i) => {
      const end = i + 1 < decls.length ? decls[i + 1].start : ls.length;
      const body = ls.slice(d.start, end).join("\n");
      return {
        ...d,
        line: d.start + 1,
        lines: end - d.start,
        jsx: /<[A-Za-z][^>]*>/.test(body),
        isPage: /(?:Page|View)$/.test(d.name) || (d.exported && /export default/.test(body)),
      };
    })
    // JSX-bearing, and not a SCREAMING_CASE constant — a lookup table whose values
    // happen to contain markup is data, not a component.
    .filter((d) => d.jsx && !/^[A-Z0-9_]+$/.test(d.name));
}

// ── inline-unit markers ───────────────────────────────────────────────────────
// Each of these is a self-contained UI unit that can move to its own file without
// dragging page state along. Counts, not judgements.
const MARKERS = {
  dialog: /<(?:Dialog\.Root|ConfirmDialog|Drawer\.Root)\b/g,
  table: /<Table\.Root\b/g,
  menu: /<Menu\.Root\b/g,
  form: /<(?:Field\.Root|Fieldset\.Root)\b/g,
  tabs: /<Tabs\.Root\b/g,
};
const STATE = /\b(?:useState|useReducer|useQuery|useMutation|useForm|useEffect)\(/g;
const ALL_HOOKS = /\b(?:useState|useReducer|useQuery|useMutation|useForm|useEffect|useMemo|useCallback|useRef|useContext)\(/g;

const count = (src, re) => (src.match(re) ?? []).length;

// ── complexity ────────────────────────────────────────────────────────────────
// A component can be SHORT and still need splitting: a dense conditional tree is
// harder to hold in your head than twice as many lines of straight markup. These
// are counted separately rather than summed into one number, because the KIND of
// complexity decides the KIND of split:
//
//   branch-heavy  → the component renders several different shapes → split by shape
//   state-heavy   → it owns too many concerns  → lift data out (a hook / features/ query)
//   depth-heavy   → deeply nested markup       → extract the inner subtree
//
// Conditional RENDERING is counted per-line below (a `?:`/`&&` on a line carrying
// markup) — a plain logic ternary above the return is not a rendering branch.
const CX = {
  maps: /\.map\(/g,
  earlyReturns: /^\s+return\s+(?:null|false|<)/gm,
  switches: /\bswitch\s*\(/g,
};

function complexity(body) {
  const ls = lines(body);
  const branches = ls.filter(
    (l) => /<[A-Za-z/]/.test(l) && /(\?|&&|\|\|)/.test(l),
  ).length;
  // Max JSX nesting, by indentation of markup lines — a proxy, but a stable one.
  const indents = ls.filter((l) => /^\s+<[A-Za-z]/.test(l)).map((l) => l.match(/^\s*/)[0].length);
  const depth = indents.length ? Math.floor(Math.max(...indents) / 2) : 0;
  // A .map inside a .map — a list of lists is the single strongest split signal.
  const nestedMaps = ls.filter((l, i) => {
    if (!/\.map\(/.test(l)) return false;
    const indent = l.match(/^\s*/)[0].length;
    return ls.slice(0, i).some(
      (p) => /\.map\(/.test(p) && p.match(/^\s*/)[0].length < indent,
    );
  }).length;
  const props = body.match(/^\s*(?:export\s+)?(?:function|const)[^(]*\(\s*\{([^}]*)\}/m);
  return {
    branches,
    maps: count(body, CX.maps),
    nestedMaps,
    depth,
    earlyReturns: count(body, CX.earlyReturns),
    switches: count(body, CX.switches),
    hooks: count(body, ALL_HOOKS),
    props: props ? props[1].split(",").filter((s) => s.trim()).length : 0,
  };
}

// A single number for RANKING only — never for the verdict. Weighted so that a
// dense 200-line component outranks a flat 500-line one.
const cxScore = (c) =>
  c.branches * 2 + c.maps + c.nestedMaps * 4 + Math.max(0, c.depth - 8) * 2 + c.hooks + c.switches * 2;

// Which kind dominates — this is what the report turns into a recommendation.
//
// Thresholds are derived from THIS corpus (75th percentile), not hardcoded: a fixed
// number both rots as the codebase grows and mislabels — a first pass with `depth >= 12`
// tagged 20 of 28 pages "depth-heavy", which is not a finding, it is the house style.
// The floors stop a tidy codebase from flagging its own median.
const FLOOR = { branches: 4, hooks: 8, depth: 14, nestedMaps: 2 };
let CUT = { ...FLOOR };

const p75 = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))];
};

function calibrate(profiles) {
  const at = (k) => Math.max(FLOOR[k], p75(profiles.map((p) => p.cx[k])));
  CUT = {
    branches: at("branches"),
    hooks: at("hooks"),
    depth: at("depth"),
    nestedMaps: at("nestedMaps"),
  };
}

function cxKind(c) {
  const kinds = [];
  if (c.branches >= CUT.branches || c.switches >= 2) kinds.push("branch-heavy");
  if (c.hooks >= CUT.hooks) kinds.push("state-heavy");
  if (c.depth >= CUT.depth) kinds.push("depth-heavy");
  if (c.nestedMaps >= CUT.nestedMaps) kinds.push("nested-lists");
  return kinds;
}

function profile(path) {
  const src = read(path);
  const markers = Object.fromEntries(
    Object.entries(MARKERS).map(([k, re]) => [k, count(src, re)]),
  );
  const locals = localComponents(src).map((l) => ({
    ...l,
    cx: complexity(lines(src).slice(l.line - 1, l.line - 1 + l.lines).join("\n")),
  }));
  const cx = complexity(src);
  return {
    file: relative(".", path).replace(/\\/g, "/"),
    lines: lines(src).length,
    locals,
    markers,
    hooks: count(src, STATE),
    imports: count(src, /^import\s/gm),
    cx,
    cxScore: cxScore(cx),
    // Extension, not a regex: `useQuery<Row>` looks exactly like a JSX tag, so a
    // content test reads a plain-TS queries file as a component.
    hasJsx: /\.tsx$/.test(path),
    cxKind: [], // filled by calibrate()/label() once the whole corpus is known
  };
}

// ── pages ─────────────────────────────────────────────────────────────────────
const pages = dirs(`${SRC}/pages`)
  .filter((p) => (onlyPage ? p === onlyPage : true))
  .map((page) => {
    const index = `${SRC}/pages/${page}/index.tsx`;
    const siblings = tsx(`${SRC}/pages/${page}/components`);
    const own = existsSync(index) ? profile(index) : null;
    const extra = tsx(`${SRC}/pages/${page}`)
      .filter((f) => f !== "index.tsx")
      .map((f) => profile(`${SRC}/pages/${page}/${f}`));
    return { page, exempt: EXEMPT_PAGES.has(page), siblings, index: own, extra };
  })
  .filter((p) => p.index);

// ── shared: features/ and components/ ─────────────────────────────────────────
const features = dirs(`${SRC}/features`).flatMap((d) =>
  tsx(`${SRC}/features/${d}`).map((f) => ({ domain: d, ...profile(`${SRC}/features/${d}/${f}`) })),
);
const design = tsx(`${SRC}/components`).map((f) => {
  const path = `${SRC}/components/${f}`;
  const src = read(path);
  return {
    ...profile(path),
    name: f.replace(/\.tsx?$/, ""),
    hasDescription: /export const description\s*=/.test(src),
  };
});

// ── calibrate the complexity thresholds against the whole corpus, then label ───
// Pages, shared components and features files are one population: a `components/`
// file is not allowed a laxer bar than a page — it has more callers to hurt.
const allProfiles = [...pages.map((p) => p.index), ...features, ...design];
// Calibrate on JSX files only — a data-layer file's 14 query hooks would otherwise
// drag the `state-heavy` cut upward and hide genuinely overloaded components.
calibrate(allProfiles.filter((p) => p.hasJsx));
for (const prof of allProfiles) {
  // A JSX-free file is the data layer (a `queries.ts`): one hook per RPC is its JOB,
  // so "state-heavy" is a miscount there. It can still be too long — judge it by size
  // and split by entity, never by hook count.
  prof.cxKind = prof.hasJsx ? cxKind(prof.cx) : ["data-layer"];
  for (const l of prof.locals) l.cxKind = cxKind(l.cx);
}

// ── cross-checks (bookkeeping, not judgement) ─────────────────────────────────
const allSources = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) allSources.push(p.replace(/\\/g, "/"));
  }
})(SRC);

// 1. A file under pages/A/components/ imported from anywhere that is not pages/A.
//    Per CLAUDE.md that is misfiled TODAY: it has become a domain component.
//    Resolve each relative import against the importing file — a regex cannot tell
//    `../../components/Toaster` (the design system) from `../products/components/X`.
const misfiled = [];
for (const path of allSources) {
  const owner = path.match(/\/pages\/([^/]+)\//)?.[1] ?? null;
  const fromDir = path.slice(0, path.lastIndexOf("/"));
  for (const m of read(path).matchAll(/from\s+"(\.[^"]+)"/g)) {
    const target = join(fromDir, m[1]).replace(/\\/g, "/");
    const hit = target.match(/\/pages\/([^/]+)\/components\/(.+)$/);
    if (hit && hit[1] !== owner) {
      misfiled.push({ component: `pages/${hit[1]}/components/${hit[2]}`, importedBy: path });
    }
  }
}

// 2 & 3. Gallery bookkeeping.
const galleryText = existsSync(GALLERY) ? read(GALLERY) : "";
const missingDescription = design.filter((c) => !c.hasDescription).map((c) => c.name);
const notInGallery = design.filter((c) => !galleryText.includes(c.name)).map((c) => c.name);

const report = { pages, features, design, misfiled, missingDescription, notInGallery };

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ── human/agent-readable ranked table ─────────────────────────────────────────
// Rank by what actually predicts "needs splitting": big local components living inline,
// and multiple self-contained units in one file. NOT by raw line count.
const candidates = (p) => p.index.locals.filter((l) => !l.isPage);
const bodySize = (p) => p.index.locals.find((l) => l.isPage)?.lines ?? p.index.lines;

// Rank by what predicts "needs splitting": a fat page BODY, sizeable local components
// sitting inline, and several self-contained units in one file. NOT raw line count.
const score = (p) => {
  const big = candidates(p).filter((l) => l.lines >= 40).length;
  const units = Object.values(p.index.markers).reduce((a, b) => a + b, 0);
  return big * 3 + units * 2 + Math.floor(bodySize(p) / 150) + Math.floor(p.index.cxScore / 8);
};

const ranked = pages
  .filter((p) => !p.exempt)
  .map((p) => ({ ...p, score: score(p) }))
  .sort((a, b) => b.score - a.score);

const pad = (s, n) => String(s).padEnd(n);
console.log(`frontend structure inventory — ${pages.length} pages, ${design.length} shared components\n`);
console.log(
  pad("page", 26) +
    pad("lines", 7) +
    pad("body", 7) +
    pad("sib", 5) +
    pad("local(≥40)", 12) +
    pad("cx", 5) +
    pad("br", 4) +
    pad("map", 5) +
    pad("dep", 5) +
    pad("hk", 4) +
    "kind / units",
);
console.log("-".repeat(100));
for (const p of ranked) {
  const cs = candidates(p);
  const c = p.index.cx;
  const units = Object.entries(p.index.markers).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`);
  const tag = p.index.cxKind.length ? p.index.cxKind.join("+") : units.join(" ") || "-";
  console.log(
    pad(p.page, 26) +
      pad(p.index.lines, 7) +
      pad(bodySize(p), 7) +
      pad(p.siblings.length || "-", 5) +
      pad(`${cs.length}(${cs.filter((l) => l.lines >= 40).length})`, 12) +
      pad(p.index.cxScore, 5) +
      pad(c.branches, 4) +
      pad(c.maps + (c.nestedMaps ? `+${c.nestedMaps}n` : ""), 7) +
      pad(c.depth, 5) +
      pad(c.hooks, 4) +
      tag,
  );
}
console.log(
  `\ncx = ranking score only, never the verdict.  br = conditional-render branches,` +
    ` map = .map calls (+N nested), dep = max JSX nesting, hk = all hooks.`,
);

// Candidates: a local is worth its own file if it's LONG (≥40 lines) or DENSE
// (cx ≥ 12) — the second catches the short-but-gnarly ones size alone misses.
console.log(`\n── extraction candidates — long (≥40 lines) OR dense (cx ≥12), page body excluded ──`);
for (const p of ranked) {
  const big = candidates(p).filter((l) => l.lines >= 40 || cxScore(l.cx) >= 12);
  if (!big.length) continue;
  console.log(`\n${p.index.file}  (body ${bodySize(p)} lines, cx ${p.index.cxScore})`);
  for (const l of big) {
    const why = [l.lines >= 40 ? `${l.lines} lines` : null, `cx ${cxScore(l.cx)}`]
      .filter(Boolean)
      .join(", ");
    const kinds = cxKind(l.cx);
    console.log(`  L${pad(l.line, 6)}${pad(l.name, 26)}${why}${kinds.length ? `  [${kinds.join("+")}]` : ""}`);
  }
}

// ── shared components and features — same complexity bar, no page to hide behind ──
// A `components/` file needing a split matters MORE than a page: every screen using
// it inherits the problem.
const shared = [...design.map((d) => ({ ...d, where: "components" })), ...features.map((f) => ({ ...f, where: `features/${f.domain}` }))]
  .filter((s) => s.cxScore >= 12 || s.lines >= 250)
  .sort((a, b) => b.cxScore - a.cxScore);

if (shared.length) {
  console.log(`\n── shared code over the same bar (cx ≥12 or ≥250 lines) ──\n`);
  console.log(pad("file", 46) + pad("lines", 7) + pad("cx", 5) + pad("br", 4) + pad("map", 5) + pad("dep", 5) + pad("hk", 4) + "kind");
  console.log("-".repeat(92));
  for (const s of shared) {
    console.log(
      pad(s.file.replace(`${SRC}/`, ""), 46) +
        pad(s.lines, 7) +
        pad(s.cxScore, 5) +
        pad(s.cx.branches, 4) +
        pad(s.cx.maps + (s.cx.nestedMaps ? `+${s.cx.nestedMaps}n` : ""), 5) +
        pad(s.cx.depth, 5) +
        pad(s.cx.hooks, 4) +
        (s.cxKind.join("+") || "-"),
    );
  }
}

console.log(`\nexempt (large by design): ${[...EXEMPT_PAGES].join(", ")}`);

if (misfiled.length) {
  console.log(`\n⚠ page components imported by another page (misfiled per CLAUDE.md):`);
  for (const m of misfiled) console.log(`  ${m.component}  ←  ${m.importedBy}`);
} else {
  console.log(`\n✓ no page component is imported across pages`);
}
if (missingDescription.length) {
  console.log(`\n⚠ shared components with no \`export const description\`: ${missingDescription.join(", ")}`);
}
if (notInGallery.length) {
  console.log(`⚠ shared components not referenced by the gallery: ${notInGallery.join(", ")}`);
}
