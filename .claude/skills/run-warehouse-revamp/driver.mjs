#!/usr/bin/env node
// Driver for the warehouse_revamp app: start the stack, log in, drive the real UI,
// screenshot it, and call the API — all headless and non-interactive.
//
// Agent tooling, not product surface. Run it from anywhere:
//   node .claude/skills/run-warehouse-revamp/driver.mjs <command> [args]
//
// Playwright is NOT a dependency of this directory — it lives in frontend/node_modules,
// so the browser is imported through a require() rooted there (see loadChromium).

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SKILL_DIR, "..", "..", "..");
const BACKEND = join(ROOT, "backend");
const FRONTEND = join(ROOT, "frontend");
const SHOTS = join(SKILL_DIR, "shots");
const LOGS = join(SKILL_DIR, "logs");
const STATE = join(SKILL_DIR, ".driver-state.json");

// The two stacks this repo runs. `dev` is what the owner previews on and what `docker compose up`
// serves; `test` is the e2e's dedicated ports + database, so a destructive flow can never touch
// review data (CLAUDE.md HARD RULE 2).
const TARGETS = {
  dev: {
    api: "http://localhost:8080",
    ui: "http://localhost:5174",
    dsn: "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable",
    uiPort: 5174,
  },
  test: {
    api: "http://localhost:8081",
    ui: "http://localhost:5175",
    dsn: "host=localhost port=5433 user=user password=password dbname=warehouse_test sslmode=disable",
    uiPort: 5175,
  },
};

const DEV_USER = process.env.DRIVER_USER ?? "dev";
const DEV_PASSWORD = process.env.DRIVER_PASSWORD ?? "devpassword123";

// Where the app keeps its bearer token and active team. Seeding these directly is how the driver
// skips the login form on every navigation — the form itself is still exercised by `flow`.
const TOKEN_KEY = "warehouse_revamp.token";
const TEAM_KEY = "warehouse_revamp.team";

// ---------------------------------------------------------------- small utilities

const argv = process.argv.slice(2);
const command = argv[0];
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  } else {
    positional.push(a);
  }
}

const target = TARGETS[flags.target ?? "dev"];
if (!target) fail(`unknown --target ${flags.target} (dev|test)`);

function log(...a) {
  console.log(...a);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readState() {
  if (!existsSync(STATE)) return {};
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

// Is a Playwright run in progress? It OWNS 8081/5175 through its `webServer` block, and its
// manager RESTARTS whatever dies there — so a teardown on --target test silently fights it, and
// killing its servers mid-run fails somebody's test suite.
function e2ePids() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*@playwright*test*cli.js*' } | ForEach-Object { $_.ProcessId }",
    ],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "")
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
}

function refuseIfE2ERunning(action) {
  if ((flags.target ?? "dev") !== "test" || flags.force === "true") return;

  const pids = e2ePids();
  if (!pids.length) return;

  console.error(`✗ refusing to ${action} --target test: a Playwright run is in progress (pid ${pids.join(", ")}).`);
  console.error("  The e2e suite owns :8081/:5175 and restarts anything killed there.");
  console.error("  Wait for it to finish, use --target dev, or pass --force if you are certain.");
  process.exit(1);
}

// A snapshot of pid -> {parent, name}. One CIM call; walking the chain per-pid is far too slow.
function processMap() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)\" }",
    ],
    { encoding: "utf8" },
  );

  const map = new Map();
  for (const line of (r.stdout ?? "").split("\n")) {
    const [pid, ppid, name] = line.trim().split("|");
    if (pid) map.set(Number(pid), { parent: Number(ppid), name: (name ?? "").toLowerCase() });
  }
  return map;
}

// Every pid from here to the root. NEVER kill anything in this set — the driver itself is a
// node.exe, and its ancestors include the shell and the agent that launched it.
function ownAncestry(map) {
  const mine = new Set();
  let pid = process.pid;
  for (let i = 0; i < 12 && pid; i++) {
    mine.add(pid);
    pid = map.get(pid)?.parent;
  }
  return mine;
}

// The supervisor chain above a listener. `go run` is THREE hops — the go.exe we spawned, the
// toolchain go.exe it re-execs, then the built binary — and vite is cmd.exe -> npm node -> vite
// node. Killing only the leaf leaves a supervisor that rebuilds and re-listens.
function supervisorsOf(pid, map, protectedPids) {
  const chain = [];
  let cur = map.get(pid)?.parent;

  for (let i = 0; i < 4 && cur; i++) {
    const info = map.get(cur);
    if (!info || protectedPids.has(cur)) break;
    // Only the launchers we actually create. Anything else means we have walked out of our own
    // process tree and must stop.
    if (!["go.exe", "node.exe", "cmd.exe", "npm.cmd"].includes(info.name)) break;
    chain.push(cur);
    cur = info.parent;
  }
  return chain;
}

// Which pids are LISTENING on a port. This is the authoritative teardown handle — see killTree.
function pidsOnPort(port) {
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  const pids = new Set();

  for (const line of (r.stdout ?? "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    // proto  local  foreign  state  pid
    if (parts.length < 5 || parts[3] !== "LISTENING") continue;
    if (Number(parts[1].split(":").pop()) === port) pids.add(Number(parts[4]));
  }

  return [...pids].filter(Boolean);
}

// Killing the pid we spawned is NOT enough, and this cost a debugging session:
//
//   recorded `go run` pid 14384  ->  listener was app_development.exe 39580, parent 39260
//   recorded cmd.exe  pid  9188  ->  listener was vite node 26900, parent 30500
//
// `go run` builds to a cache dir and execs the binary, and npm-under-a-shell adds its own hop, so
// by teardown the listener's parent chain no longer leads back to the pid we hold. `taskkill /T`
// walks the CURRENT tree and simply does not reach it — it reports success and the port stays
// bound. So kill the recorded tree AND whatever still holds the port.
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function probe(url, ms = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  waiting for ${label} (${url}) `);
  while (Date.now() < deadline) {
    const status = await probe(url);
    if (status >= 200 && status < 500) {
      log(` up (${status})`);
      return true;
    }
    process.stdout.write(".");
    await sleep(1500);
  }
  log(" TIMEOUT");
  return false;
}

// ---------------------------------------------------------------- browser

async function loadChromium() {
  // ESM resolution walks up from THIS file, which would miss frontend/node_modules entirely.
  // Resolve from the frontend package instead.
  //
  // require(), not import(): playwright is CJS, and dynamic-importing it BY ABSOLUTE PATH loses
  // the named exports — `mod.chromium` comes back undefined even though `import("playwright")`
  // from inside frontend/ works fine. require() gives the real module object either way.
  const req = createRequire(join(FRONTEND, "package.json"));
  try {
    return req("playwright").chromium;
  } catch (e) {
    fail(`playwright not loadable from frontend/node_modules — run \`npm install\` in frontend/ (${e.message})`);
  }
}

async function apiLogin() {
  const res = await fetch(`${target.api}/warehouse.user.v1.AuthService/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: DEV_USER,
      password: DEV_PASSWORD,
      agent: "driver",
      agentVersion: "1",
    }),
  });
  const body = await res.text();
  if (!res.ok) fail(`login failed (${res.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  if (!parsed.token) fail(`login returned no token: ${body.slice(0, 300)}`);
  return parsed;
}

// Opens an authenticated page and wires up the noise collectors. Every visit reports console
// errors and failed network calls — those are the failures a screenshot alone hides.
async function openApp({ headed = false } = {}) {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const problems = [];
  context.on("weberror", (e) => problems.push(`pageerror: ${e.error().message}`));

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    problems.push(`requestfailed: ${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
  });

  return { browser, context, page, problems };
}

async function seedAuth(context, token, teamId) {
  // addInitScript runs before any app code on every navigation, so the AuthGate sees a token on
  // first paint and never bounces to /login.
  await context.addInitScript(
    ({ tokenKey, teamKey, token, teamId }) => {
      window.localStorage.setItem(tokenKey, token);
      if (teamId) window.sessionStorage.setItem(teamKey, String(teamId));
    },
    { tokenKey: TOKEN_KEY, teamKey: TEAM_KEY, token, teamId },
  );
}

// Git Bash (MSYS2) PATH-CONVERTS any argument that starts with a slash:
//   /inventories/racks  ->  C:/Program Files/Git/inventories/racks
// The app then renders React Router's "Unexpected Application Error!" and it looks like a broken
// route rather than a mangled argument. Undo it, and accept slash-less routes too.
function normalizeRoute(raw) {
  let r = String(raw).replace(/\\/g, "/");

  const mangled = r.match(/^[A-Za-z]:\/.*?\/Git\/(.*)$/);
  if (mangled) r = `/${mangled[1]}`;

  if (!r.startsWith("/")) r = `/${r}`;
  return r;
}

function shotPath(route) {
  mkdirSync(SHOTS, { recursive: true });
  const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return join(SHOTS, `${slug}.png`);
}

// The app is code-split and every page fetches on mount, so "load" fires long before there is
// anything to look at. Wait for the shell, then for the network to settle.
async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    /* a page that polls never goes idle — screenshot it anyway */
  }
  await sleep(400);
}

function reportProblems(problems, where) {
  if (!problems.length) return;
  log(`  ⚠ ${problems.length} problem(s) on ${where}:`);
  for (const p of [...new Set(problems)].slice(0, 12)) log(`      ${p}`);
  problems.length = 0;
}

// ---------------------------------------------------------------- commands

async function cmdStatus() {
  log(`target: ${flags.target ?? "dev"}  api=${target.api}  ui=${target.ui}`);

  const ps = spawnSync("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}"], {
    encoding: "utf8",
  });
  const containers = (ps.stdout ?? "").trim();
  log("\ncontainers:");
  log(
    containers
      ? containers
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      : "  (none — run `docker compose up -d`)",
  );

  const api = await probe(`${target.api}/healthz`);
  const ui = await probe(target.ui);
  log("\nservers:");
  log(`  api ${target.api}/healthz  -> ${api || "DOWN"}`);
  log(`  ui  ${target.ui}           -> ${ui || "DOWN"}`);

  const state = readState();
  if (state.backendPid || state.frontendPid) {
    log(`\nstarted by this driver: backend pid=${state.backendPid} vite pid=${state.frontendPid}`);
    log(`logs: ${LOGS}`);
  }
}

async function cmdSetup() {
  log("→ docker compose up -d");
  spawnSync("docker", ["compose", "up", "-d"], { cwd: ROOT, stdio: "inherit" });

  // Postgres accepts connections briefly before it is usable; the compose healthcheck is the
  // thing to wait on, not the port.
  process.stdout.write("  waiting for postgres healthy ");
  for (let i = 0; i < 60; i++) {
    const r = spawnSync(
      "docker",
      ["inspect", "-f", "{{.State.Health.Status}}", "warehouse_revamp_postgres"],
      { encoding: "utf8" },
    );
    if ((r.stdout ?? "").trim() === "healthy") {
      log(" ok");
      break;
    }
    process.stdout.write(".");
    await sleep(1000);
  }

  // warehouse_test does not exist on a fresh machine, and gorm.Open crashes on a missing database
  // before any migration can create it.
  if ((flags.target ?? "dev") === "test") {
    log("→ db ensure-test");
    spawnSync("go", ["run", "./cmd/tool", "db", "ensure-test"], { cwd: BACKEND, stdio: "inherit" });
  }

  // Order is a CONTRACT: team_service seeds team 1, and user_service's root seed puts ROLE_ROOT
  // *in team 1*. No foreign key enforces it, so the wrong order yields a role pointing at a team
  // that does not exist yet. Everything after is independent (HARD RULE 3).
  const seededFirst = ["team_service", "user_service"];
  const discovered = readdirSync(join(BACKEND, "services"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith("_service"))
    .map((e) => e.name)
    .filter((n) => !seededFirst.includes(n))
    .sort();

  for (const service of [...seededFirst, ...discovered]) {
    log(`→ migrate up --service ${service}`);
    const r = spawnSync(
      "go",
      ["run", "./cmd/tool", "migrate", "up", "--service", service, "--dsn", target.dsn],
      { cwd: BACKEND, stdio: "inherit" },
    );
    if (r.status !== 0) fail(`migration failed for ${service}`);
  }

  log("→ seed dev fixture");
  const seed = spawnSync(
    "go",
    ["run", "./cmd/tool", "seed", "dev", "--password", DEV_PASSWORD, "--dsn", target.dsn],
    { cwd: BACKEND, stdio: "inherit" },
  );
  if (seed.status !== 0) fail("dev seed failed");

  log(`\n✓ setup complete — login with ${DEV_USER} / ${DEV_PASSWORD}`);
}

async function cmdUp() {
  refuseIfE2ERunning("up");
  mkdirSync(LOGS, { recursive: true });
  const state = readState();

  const apiUp = await probe(`${target.api}/healthz`);
  if (apiUp) {
    log(`✓ api already up at ${target.api} (reusing)`);
  } else {
    const out = openSync(join(LOGS, "backend.log"), "a");
    const child = spawn("go", ["run", "./cmd/app_development"], {
      cwd: BACKEND,
      stdio: ["ignore", out, out],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        DATABASE_URL: target.dsn,
        ADDR: target.api.replace("http://", ""),
        ALLOWED_ORIGINS: target.ui,
        INTERNAL_BASE_URL: target.api,
        DOCUMENT_BASE_URL: `${target.api}/local-storage`,
      },
    });
    child.unref();
    state.backendPid = child.pid;
    state.api = target.api;
    // Persist IMMEDIATELY: if the next spawn throws, `down` must still know about this process,
    // or it is an orphan holding the port with nothing tracking it.
    writeState(state);
    log(`→ backend starting (pid ${child.pid}), log: ${join(LOGS, "backend.log")}`);
  }

  const uiUp = await probe(target.ui);
  if (uiUp) {
    log(`✓ ui already up at ${target.ui} (reusing)`);
  } else {
    const out = openSync(join(LOGS, "frontend.log"), "a");
    const child = spawn(
      "npm",
      ["run", "dev", "--", "--port", String(target.uiPort), "--strictPort"],
      {
        cwd: FRONTEND,
        stdio: ["ignore", out, out],
        detached: process.platform !== "win32",
        // npm is npm.cmd on Windows, and Node >=20 refuses to spawn a .cmd without a shell
        // (it throws EINVAL, not ENOENT — which reads like a bad argument, not a policy).
        shell: process.platform === "win32",
        env: { ...process.env, VITE_API_URL: target.api },
      },
    );
    child.unref();
    state.frontendPid = child.pid;
    state.uiPort = target.uiPort;
    writeState(state);
    log(`→ vite starting (pid ${child.pid}), log: ${join(LOGS, "frontend.log")}`);
  }

  writeState(state);

  const okApi = await waitFor(`${target.api}/healthz`, "api");
  const okUi = await waitFor(target.ui, "ui");
  if (!okApi || !okUi) {
    fail(`stack did not come up — check ${LOGS}`);
  }
  log("\n✓ stack up");
}

async function cmdDown() {
  refuseIfE2ERunning("down");
  const state = readState();
  if (!state.backendPid && !state.frontendPid) {
    log("nothing was started by this driver — leaving every running server alone");
    log("(the dev servers on :8080/:5174 are usually the owner's. Never kill those blind.)");
    return;
  }

  // Only ports THIS driver started get the port sweep. A blind sweep of :8080/:5174 would kill
  // the servers the owner is previewing on.
  const ports = [];
  if (state.backendPid) ports.push(Number(new URL(state.api ?? target.api).port));
  if (state.frontendPid) ports.push(state.uiPort ?? target.uiPort);

  killTree(state.backendPid);
  killTree(state.frontendPid);

  // Sweep until the ports stay clean across TWO consecutive checks. One check is not enough: a
  // `go run` that was still building when we killed its binary will happily start a fresh
  // listener a second later, so a single-shot teardown reports success and leaves a server up.
  let clean = 0;
  for (let round = 0; round < 8 && clean < 2; round++) {
    const map = processMap();
    const mine = ownAncestry(map);

    let killedAny = false;
    for (const port of ports) {
      for (const pid of pidsOnPort(port)) {
        if (mine.has(pid)) continue;
        const chain = supervisorsOf(pid, map, mine);
        log(`  port ${port} held by pid ${pid}${chain.length ? ` (supervisors ${chain.join(", ")})` : ""} — killing`);
        for (const victim of [pid, ...chain]) killTree(victim);
        killedAny = true;
      }
    }

    await sleep(killedAny ? 1200 : 800);
    clean = ports.some((p) => pidsOnPort(p).length) ? 0 : clean + 1;
  }

  const stuck = ports.filter((p) => pidsOnPort(p).length);
  if (stuck.length) fail(`ports still bound after teardown: ${stuck.join(", ")}`);

  log(`✓ down — ports ${ports.join(", ")} released`);
  writeState({});
}

async function cmdLogin() {
  const { token, identity } = await apiLogin();
  log(`user=${identity.username} id=${identity.identityId} expires=${identity.expiredAt}`);
  log(token);
}

async function cmdApi() {
  const method = positional[0];
  if (!method) fail('usage: api <Service/Method> [json]  e.g. api warehouse.team.v1.TeamService/TeamList \'{"page":{"limit":5}}\'');
  const body = positional[1] ?? "{}";

  let headers = { "Content-Type": "application/json" };
  if (flags.anon !== "true") {
    const { token } = await apiLogin();
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${target.api}/${method}`, { method: "POST", headers, body });
  const text = await res.text();
  log(`HTTP ${res.status}`);
  try {
    log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    log(text);
  }
  if (!res.ok) process.exitCode = 1;
}

async function cmdShot() {
  const routes = positional.length ? positional : ["/"];
  const { token } = await apiLogin();
  const { browser, context, page, problems } = await openApp({ headed: flags.headed === "true" });
  await seedAuth(context, token, flags.team);

  for (const raw of routes) {
    const route = normalizeRoute(raw);
    await page.goto(`${target.ui}${route}`, { waitUntil: "commit" });
    await settle(page);

    const path = shotPath(route);
    await page.screenshot({ path, fullPage: flags.full === "true" });

    const heading = await page
      .locator("h1, h2")
      .first()
      .textContent()
      .catch(() => null);

    // React Router swallows a bad route into its ErrorBoundary, which still screenshots as a
    // perfectly valid-looking page. Call it out.
    const broke = (heading ?? "").includes("Unexpected Application Error");
    log(`${broke ? "✗" : "✓"} ${route} → ${path}${heading ? `   [${heading.trim()}]` : ""}`);
    if (broke) process.exitCode = 1;

    reportProblems(problems, route);
  }

  await browser.close();
}

async function cmdEval() {
  const route = normalizeRoute(positional[0] ?? "/");
  const expr = positional[1];
  if (!expr) fail('usage: eval <route> "<js expression>"');

  const { token } = await apiLogin();
  const { browser, context, page, problems } = await openApp();
  await seedAuth(context, token, flags.team);

  await page.goto(`${target.ui}${route}`, { waitUntil: "commit" });
  await settle(page);

  const result = await page.evaluate(`(() => (${expr}))()`);
  log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  reportProblems(problems, route);
  await browser.close();
}

// The one command that proves the app actually WORKS end to end: it types into the real login
// form, waits for the real redirect, and walks the real navigation. Everything else seeds a token
// and skips that.
async function cmdFlow() {
  const { browser, page, problems } = await openApp({ headed: flags.headed === "true" });
  mkdirSync(SHOTS, { recursive: true });

  log("→ login form");
  await page.goto(`${target.ui}/login`, { waitUntil: "commit" });
  await page.getByLabel("Username").fill(DEV_USER);
  await page.getByLabel("Password", { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await settle(page);
  await page.screenshot({ path: join(SHOTS, "flow-1-home.png") });
  log(`✓ signed in as ${DEV_USER} → ${page.url()}`);

  // Walk a few real screens through the nav rather than by URL, so a broken menu link fails here.
  const stops = [
    { route: "/products", expect: "Products" },
    { route: "/teams", expect: "Teams" },
    { route: "/users", expect: "Users" },
  ];

  let step = 2;
  for (const stop of stops) {
    await page.goto(`${target.ui}${stop.route}`, { waitUntil: "commit" });
    await settle(page);

    const body = await page.locator("body").innerText();
    const ok = body.includes(stop.expect);
    const shot = join(SHOTS, `flow-${step}-${stop.expect.toLowerCase()}.png`);
    await page.screenshot({ path: shot });
    log(`${ok ? "✓" : "✗"} ${stop.route} — ${ok ? `found "${stop.expect}"` : `MISSING "${stop.expect}"`} → ${shot}`);
    if (!ok) process.exitCode = 1;
    step++;
  }

  reportProblems(problems, "flow");
  await browser.close();
  log("\n✓ flow complete");
}

// ---------------------------------------------------------------- dispatch

const COMMANDS = {
  status: cmdStatus,
  setup: cmdSetup,
  up: cmdUp,
  down: cmdDown,
  login: cmdLogin,
  api: cmdApi,
  shot: cmdShot,
  eval: cmdEval,
  flow: cmdFlow,
};

if (!command || !COMMANDS[command]) {
  console.log(`warehouse_revamp driver

  node .claude/skills/run-warehouse-revamp/driver.mjs <command> [args] [--target dev|test]

  status              docker containers + api/ui reachability
  setup               docker compose up, migrate every service, seed the dev fixture
  up                  start backend + vite in the background (reuses anything already up)
  down                kill only what THIS driver started
  flow                real login form → walk real screens → screenshots (the smoke test)
  shot <route...>     authenticated screenshot of each route  [--full] [--team <id>] [--headed]
  eval <route> <js>   run JS in the page and print the result
  login               print a bearer token for ${DEV_USER}
  api <Svc/Method> [json]   authenticated Connect call  [--anon]

  screenshots → ${SHOTS}
  logs        → ${LOGS}`);
  process.exit(command ? 1 : 0);
}

await COMMANDS[command]();
