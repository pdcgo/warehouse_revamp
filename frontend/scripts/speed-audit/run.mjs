// THE FRONTEND SPEED AUDIT'S BROWSER DRIVER — run by `go run ./tools/san audit frontend` (tools/san/audit.go), never
// by hand: `node scripts/speed-audit/run.mjs --plan <plan.json> --out <results.json>`.
//
// It only MEASURES. San has already started the audit's own API and a `vite preview` of the production build, seeded
// its database and signed every role in; plan.json says, per screen, the address, the role's token and team, what
// "usable" waits for and the one save to do. This opens ONE headless Chromium and ONE page at a time and records:
//
//   - every Connect POST of a load (method, body, start and end on the page's clock — performance.timeOrigin), and the
//     CORS pre-checks (OPTIONS, seen through the DevTools protocol: Playwright's own events never show them);
//   - the moment the screen became usable — taken INSIDE the page by a requestAnimationFrame loop the init script
//     installs (no Node polling in the figure): the first frame at which the ready element is shown with no loading
//     marker in it ([role="status"] — ListSkeleton —, .chakra-spinner, [data-busy="true"] — RefreshOverlay) and no
//     Connect request in flight, held `quiet_ms` with no new request (a late one restarts the wait), capped at
//     `usable_cap_ms` ("never usable");
//   - after the last warm load, the screen's one save through the UI, and every Connect POST that starts after the
//     save's answer, until `save_quiet_ms` without one (capped); then each read-only probe (opening a picker) the same
//     way, from its first step (a probe's `setup` steps — picking the warehouse a picker needs — run before it counts);
//   - THE TYPING PASS (P2, #125) — on a form, React's commits while a person types: in a context of its OWN, whose
//     init script also installs a stub __REACT_DEVTOOLS_GLOBAL_HOOK__ (installRenderHook — never in the context the
//     loads are timed in: its tree walk costs time). react-dom 18's production build attaches to a hook that says
//     `supportsFiber` and calls its onCommitFiberRoot on every commit; the stub records each commit's time and the
//     components it rendered, by name (the audit's build keeps names — vite.audit.config.mjs). Per field, per pass:
//     a fresh load, the field's `setup` steps, a click into it, then each key pressed one by one (`keyboard.press`, two
//     animation frames after each), every keydown's time taken inside the page; then `typing_wait_ms` of quiet in which
//     the TRAILING commits land (a debounced read and its answer). Go turns it into commits and components per
//     keystroke (median) and the trailing count (audit_frontend_typing.go).
//
// Loads: one COLD (a fresh context: empty HTTP cache) then `warm_loads` reloads in the same context. Sign-in needs no
// e2e helper: the init script writes the token where the app keeps it (features/auth/tokenStorage.ts) and the role's
// team where TeamContext.tsx reads it (sessionStorage — per tab, so a saved storageState would not carry it).
//
// Every count is made in Go from what this writes (tools/san/audit_frontend_measure.go). It never imports
// frontend/e2e/** — the audit is a measurement, not a test.

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const planPath = arg("plan");
const outPath = arg("out");

if (!planPath || !outPath) {
  console.error("usage: node scripts/speed-audit/run.mjs --plan <plan.json> --out <results.json>");
  process.exit(2);
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));

// A Connect RPC of this app: POST …/warehouse.<pkg>.v1.<Service>/<Method> (connect-web's JSON transport).
const CONNECT = /\/warehouse\.[a-z_]+\.v1\.([A-Za-z]+)\/([A-Za-z]+)$/;

function connectMethod(url) {
  try {
    const m = CONNECT.exec(new URL(url).pathname);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page before its own scripts, on every document: the sign-in, the in-flight count and the usable clock.
function installHook(cfg) {
  try {
    window.localStorage.setItem("warehouse_revamp.token", cfg.token);
    window.sessionStorage.setItem("warehouse_revamp.team", cfg.team);
  } catch {
    // storage refused — the screen will show the sign-in, and the load reads "never usable"
  }

  const a = { inflight: 0, candidate: null, usable: null, never: false, reason: "" };
  Object.defineProperty(window, "__audit", { value: a, configurable: true });

  const isConnect = (u) => {
    try {
      return /\/warehouse\.[a-z_]+\.v1\.[A-Za-z]+\/[A-Za-z]+$/.test(new URL(u, location.href).pathname);
    } catch {
      return false;
    }
  };

  const orig = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (!isConnect(url)) return orig(input, init);

    a.inflight++;
    a.candidate = null;

    const p = orig(input, init);
    // In flight until its BODY is in — connect-web reads it before the screen can use the answer.
    p.then((res) => res.clone().arrayBuffer())
      .catch(() => undefined)
      .finally(() => {
        a.inflight--;
      });

    return p;
  };

  const MARKERS = '[role="status"], .chakra-spinner, [data-busy="true"]';

  const readyNow = () => {
    const el = document.querySelector(cfg.ready);
    if (!el) {
      a.reason = `no ${cfg.ready}`;
      return false;
    }
    if (el.getClientRects().length === 0) {
      a.reason = `${cfg.ready} is hidden`;
      return false;
    }
    const marker = el.querySelector(MARKERS);
    if (marker) {
      a.reason = `a loading marker in it: ${marker.getAttribute("data-testid") || marker.getAttribute("role") || marker.className}`;
      return false;
    }
    if (a.inflight > 0) {
      a.reason = `${a.inflight} Connect request(s) in flight`;
      return false;
    }
    a.reason = "";
    return true;
  };

  const tick = () => {
    if (a.usable !== null || a.never) return;

    const now = performance.now();
    if (now > cfg.cap) {
      a.never = true;
      return;
    }

    if (readyNow()) {
      if (a.candidate === null) {
        a.candidate = now;
      } else if (now - a.candidate >= cfg.quiet) {
        a.usable = a.candidate;
        return;
      }
    } else {
      a.candidate = null;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

// THE RENDER HOOK — installed in the TYPING context only, before the bundle runs: a stub of the React DevTools global
// hook. react-dom 18.3.1's production file injects itself into it when it says `supportsFiber` (and is not
// `isDisabled`), and its commitRoot calls onCommitFiberRoot(rendererID, root) after EVERY commit. While `on` (the
// keystrokes and the quiet after them), each commit is recorded with its time on the page's clock and the components
// it rendered: the tree is walked from the committed root, a component (function 0, class 1, forwardRef 11, memo 14,
// simple memo 15) counts when its PerformedWork flag (flags & 1) is set, and a subtree whose child list is the same
// object as its alternate's was not entered by this render (React bailed out and kept the old fibers — React
// DevTools' own unchanged-subtree rule), so its stale flags are never read. Every keydown is timed in capture, before
// the app sees it.
function installRenderHook() {
  const rec = { on: false, commits: [], keys: [], total: 0, injected: 0 };
  Object.defineProperty(window, "__auditRender", { value: rec, configurable: true });

  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;

  const nameOf = (f) => {
    const outer = f.type;
    let inner = outer;
    // forwardRef → its render; memo → what it wraps (which can itself be a forwardRef).
    if (inner && typeof inner === "object" && inner.type) inner = inner.type;
    if (inner && typeof inner === "object" && inner.render) inner = inner.render;

    const name =
      (outer && typeof outer !== "string" && outer.displayName) ||
      (inner && (inner.displayName || inner.name)) ||
      "";

    return name || "(anonymous)";
  };

  const walk = (root) => {
    let n = 0;
    const names = {};
    // Where each re-render STARTS: a component that rendered while its nearest component above did not — its own
    // state or a context it reads changed (the page holding the form's state, or the field's card). roots[name] is
    // [how many re-renders started there, how many components those re-renders drew, itself included].
    const roots = {};
    // [fiber, the start the nearest rendered component above belongs to — null when the nearest component above
    // did not render]
    const stack = [[root.current, null]];

    while (stack.length > 0) {
      const [f, owner] = stack.pop();
      let next = owner;

      if (COMPONENT.has(f.tag)) {
        next = null;

        if ((f.flags & PERFORMED_WORK) === PERFORMED_WORK) {
          n++;
          const name = nameOf(f);
          names[name] = (names[name] || 0) + 1;

          next = owner;
          if (next === null) {
            next = name;
            roots[name] = roots[name] || [0, 0];
            roots[name][0]++;
          }

          roots[next][1]++;
        }
      }

      const alt = f.alternate;
      if (f.child && !(alt && alt.child === f.child)) {
        for (let c = f.child; c; c = c.sibling) stack.push([c, next]);
      }
    }

    return { n, names, roots };
  };

  window.addEventListener(
    "keydown",
    () => {
      if (rec.on) rec.keys.push(performance.now());
    },
    true,
  );

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      rec.injected++;
      return id;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      rec.total++;
      if (!rec.on) return;

      const t = performance.now();
      try {
        const w = walk(root);
        rec.commits.push({ t, n: w.n, names: w.names, roots: w.roots });
      } catch (e) {
        rec.commits.push({ t, n: 0, error: String(e) });
      }
    },
  };
}

// Two animation frames on the page — what a keystroke is given to draw — and the page's clock after them.
async function twoFrames(page) {
  return page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())));
      }),
  );
}

// The page's Connect traffic: each POST goes to the sink open when it STARTED.
async function recorder(context, page) {
  const st = { sink: null, map: new Map(), last: Date.now(), inflight: 0, onFinished: null };

  page.on("request", (req) => {
    const method = connectMethod(req.url());
    if (!method || req.method() !== "POST") return;

    st.last = Date.now();
    st.inflight++;

    const r = { method, body: req.postData() ?? "", wall: Date.now(), timing: null, wallEnd: null, status: 0 };
    st.map.set(req, r);
    if (st.sink) st.sink.requests.push(r);
  });

  const done = (req, failed) => {
    const r = st.map.get(req);
    if (!r) return;

    st.map.delete(req);
    st.inflight--;
    st.last = Date.now();
    r.wallEnd = Date.now();
    r.timing = req.timing();
    if (failed) r.failed = true;

    // Synchronously, before anything awaits: the reads a save's answer fires start right after this event.
    if (st.onFinished) st.onFinished(r);

    req
      .response()
      .then(async (res) => {
        r.status = res ? res.status() : 0;
        // A refused write says why — the first thing to read when a save "fired nothing after".
        if (res && res.status() >= 400) r.answer = (await res.text().catch(() => "")).slice(0, 400);
      })
      .catch(() => undefined);
  };

  page.on("requestfinished", (req) => done(req, false));
  page.on("requestfailed", (req) => done(req, true));

  // CORS pre-checks: only the DevTools protocol reports them.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.request.method === "OPTIONS" && st.sink) {
      st.sink.preflights.push({ url: e.request.url, wall: e.wallTime * 1000 });
    }
  });

  return st;
}

// Waits until no Connect request is in flight and none has started or ended for quietMs (capped).
async function settle(st, quietMs, capMs) {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    if (st.inflight <= 0 && Date.now() - st.last >= quietMs) return true;
    await sleep(50);
  }
  return false;
}

// A request's start and end on a clock whose zero is origin (epoch ms).
function timed(r, origin) {
  const start = (r.timing && r.timing.startTime > 0 ? r.timing.startTime : r.wall) - origin;
  const end =
    r.timing && r.timing.startTime > 0 && r.timing.responseEnd >= 0
      ? r.timing.startTime + r.timing.responseEnd - origin
      : (r.wallEnd ?? Date.now()) - origin;

  return {
    method: r.method,
    body: r.body,
    start: Math.round(start * 10) / 10,
    end: Math.round(end * 10) / 10,
    status: r.status,
    ...(r.failed ? { failed: true } : {}),
  };
}

async function waitUsable(page, s) {
  await page
    .waitForFunction(() => window.__audit && (window.__audit.usable !== null || window.__audit.never), null, {
      timeout: s.usable_cap_ms + 5000,
      polling: "raf",
    })
    .catch(() => undefined);

  return page
    .evaluate(() => ({
      usable: window.__audit ? window.__audit.usable : null,
      never: window.__audit ? window.__audit.never : true,
      reason: window.__audit ? window.__audit.reason : "the hook never ran",
      origin: performance.timeOrigin,
    }))
    .catch((e) => ({ usable: null, never: true, reason: String(e), origin: Date.now() }));
}

// One load of the screen: cold (goto in the fresh context) or warm (reload).
async function load(page, st, s, kind) {
  const sink = { requests: [], preflights: [] };
  st.sink = sink;

  if (kind === "cold") {
    await page.goto(s.url, { waitUntil: "commit" });
  } else {
    await page.reload({ waitUntil: "commit" });
  }

  const a = await waitUsable(page, s);
  await settle(st, 300, 5000);
  st.sink = null;

  return {
    kind,
    usable_ms: a.never || a.usable === null ? null : Math.round(a.usable * 10) / 10,
    never: Boolean(a.never || a.usable === null),
    ...(a.never ? { not_ready: a.reason } : {}),
    requests: sink.requests.map((r) => timed(r, a.origin)),
    preflights: sink.preflights.map((p) => ({ url: p.url, start: Math.round((p.wall - a.origin) * 10) / 10 })),
  };
}

// THE DEPENDENCY PASS — which call waits on which, MEASURED instead of guessed from timings. For each of the screen's
// requests in the reference load (the shell's never), one more load holds THAT request back by dep_delay_ms (a route
// that sleeps before letting it go), and every request that now starts at least half that much later waits on it,
// directly or through another. Each request of the reference load gets `after`: the indices of the requests it waits
// on. A gap rule ("started within 100 ms of an answer") cannot tell a call fired from a .then from one that happened to
// start then, and a long render between an answer and its follow-up (a 45-line shelf) breaks it; holding an answer
// back can do neither.
//
// The pass runs `dep_passes` times (tools/san: auditDepPasses). `after` is the first pass's; `after_passes` has every
// pass's, so Go can judge a chain only when it holds in every pass — a wait that is measured in one pass and not the
// next (a call fired by a timer or an answer, whichever comes later) is not a chain the slice made.
async function dependencyPass(page, st, s, ref) {
  const passes = Math.max(1, s.dep_passes ?? 1);
  const afterOf = [];

  for (let p = 0; p < passes; p++) {
    afterOf.push(await onePass(page, st, s, ref));
  }

  ref.requests.forEach((r, i) => {
    if (afterOf[0][i].length > 0) r.after = afterOf[0][i];
    if (passes > 1 && afterOf.some((a) => a[i].length > 0)) r.after_passes = afterOf.map((a) => a[i]);
  });
  ref.deps = true;
  ref.dep_passes = passes;
}

// onePass is one dependency pass: for each request of the reference load, the indices of the requests it waits on.
async function onePass(page, st, s, ref) {
  const D = s.dep_delay_ms;
  const isShell = (r) => s.shell.some((x) => x.method === r.method && r.body.includes(x.body_has ?? ""));
  const occurrences = (reqs) => {
    const seen = {};
    return reqs.map((r) => {
      const k = `${r.method}\u0000${r.body}`;
      seen[k] = (seen[k] ?? 0) + 1;
      return `${k}\u0000${seen[k]}`;
    });
  };

  const refKeys = occurrences(ref.requests);
  const after = ref.requests.map(() => []);

  for (const [t, target] of ref.requests.entries()) {
    if (isShell(target)) continue;

    const nth = Number(refKeys[t].split("\u0000")[2]);
    const [service, method] = target.method.split("/");
    const glob = `**/*.${service}/${method}`;
    let seen = 0;

    const hold = async (route) => {
      const req = route.request();
      if (req.method() === "POST" && (req.postData() ?? "") === target.body) {
        seen++;
        if (seen === nth) await sleep(D);
      }
      await route.continue().catch(() => undefined);
    };

    await page.route(glob, hold);
    const l = await load(page, st, s, "dep");
    await page.unroute(glob, hold);

    const keys = occurrences(l.requests);
    const startOf = new Map(keys.map((k, i) => [k, l.requests[i].start]));

    refKeys.forEach((k, i) => {
      if (i === t) return;
      const moved = startOf.get(k);
      if (moved !== undefined && moved - ref.requests[i].start >= D / 2) after[i].push(t);
    });
  }

  return after;
}

// A receipt the audit uploads: a 1×1 PNG (a photographed slip is an image; a PNG is never read for numbers —
// features/shipment/receiptCheck.ts reads PDFs only — so the upload is the whole of it).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// A step's element: a data-testid, or — where the app gives the element none of its own (a calendar's today cell, a
// combobox's input inside its test id'd box) — a CSS selector over the app's own attributes. Never an edit of the app.
function stepLocator(page, step) {
  if (step.selector) return page.locator(step.selector).first();
  if (step.testid) return page.locator(`[data-testid="${step.testid}"]`).first();

  return null;
}

async function runStep(page, step) {
  const loc = stepLocator(page, step);

  switch (step.op) {
    case "click":
      await loc.click({ timeout: 10_000 });
      break;
    case "fill":
      await loc.fill(step.value ?? "", { timeout: 10_000 });
      break;
    case "wait":
      await loc.waitFor({ state: "visible", timeout: 10_000 });
      break;
    case "press":
      await page.keyboard.press(step.value);
      break;
    case "upload":
      await loc.setInputFiles({ name: step.value || "audit-resi.png", mimeType: "image/png", buffer: PNG_1X1 }, { timeout: 10_000 });
      break;
    default:
      throw new Error(`unknown step ${step.op}`);
  }
}

// A scripted interaction: a save (counted from its answer) or a read-only probe (counted from its first step). Its
// `setup` steps run first and are never counted — what the counted part needs on screen (a warehouse picked).
async function interact(page, st, s, it) {
  const out = { name: it.name, ...(it.rpc ? { rpc: it.rpc } : {}), sent: !it.rpc, requests: [] };
  const sink = { requests: [], preflights: [] };
  const before = page.url();
  let answeredAt = null;
  let answer = null;

  try {
    if ((it.setup ?? []).length > 0) {
      for (const step of it.setup) await runStep(page, step);
      await settle(st, 500, s.save_cap_ms);
    }

    if (it.rpc) {
      st.onFinished = (r) => {
        if (answeredAt === null && r.method === it.rpc) {
          answeredAt = r.wallEnd;
          answer = r;
          out.sent = true;
          st.sink = sink;
        }
      };
    } else {
      st.sink = sink;
      answeredAt = Date.now();
    }

    for (const step of it.steps) await runStep(page, step);

    if (it.rpc) {
      const deadline = Date.now() + 10_000;
      while (answeredAt === null && Date.now() < deadline) await sleep(25);
      if (answeredAt === null) throw new Error(`${it.rpc} was not sent within 10 s of the last step`);
    }

    await settle(st, it.rpc ? s.save_quiet_ms : 1000, s.save_cap_ms);
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).split("\n")[0];
  }

  // The write's own answer: a refused one (4xx/5xx) says why, and what fired after it is no save's refresh.
  if (answer) {
    out.status = answer.status;
    if (answer.status >= 400 && !out.error) out.error = `the write was refused (${answer.status}): ${answer.answer ?? ""}`;
  }

  st.sink = null;
  st.onFinished = null;
  out.requests = sink.requests.map((r) => timed(r, answeredAt ?? Date.now()));

  if (page.url() !== before) out.url_after = page.url();

  return out;
}

// Back to the screen, usable, nothing counted — the ground a probe starts from.
async function reopen(page, st, s) {
  st.sink = null;
  await page.goto(s.url, { waitUntil: "commit" });
  await waitUsable(page, s);
  await settle(st, 300, 5000);
}

// One field, one pass: a fresh load, the field's setup, a click into it (and End — the caret after what it holds),
// then recording on, each key pressed with two animation frames after it, `typing_wait_ms` of quiet, recording off.
// Everything recorded is RAW — the keydown times, the time the last key's frames ended, the end of the quiet, and each
// commit's time and components: the windows and counts are Go's (audit_frontend_typing.go).
async function typeField(page, st, s, f, pass) {
  const out = { field: f.name, testid: f.testid, pass, keys: [], settled: [], end: 0, commits: [], hooked: false };

  try {
    await reopen(page, st, s);

    for (const step of f.setup ?? []) await runStep(page, step);
    await settle(st, 500, s.save_cap_ms);

    await page.locator(`[data-testid="${f.testid}"]`).first().click({ timeout: 10_000 });
    await page.keyboard.press("End");
    await twoFrames(page);
    await settle(st, 300, 5000);

    out.hooked = await page.evaluate(() => {
      const r = window.__auditRender;
      if (!r) return false;
      r.commits = [];
      r.keys = [];
      r.on = true;
      return r.injected > 0;
    });

    for (const key of f.keys) {
      await page.keyboard.press(key);
      out.settled.push(await twoFrames(page));
    }

    out.end = await page.evaluate((ms) => new Promise((r) => setTimeout(() => r(performance.now()), ms)), s.typing_wait_ms);
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).split("\n")[0];
  }

  const rec = await page
    .evaluate(() => {
      const r = window.__auditRender;
      if (!r) return { keys: [], commits: [] };
      r.on = false;
      return { keys: r.keys, commits: r.commits };
    })
    .catch(() => ({ keys: [], commits: [] }));

  out.keys = rec.keys;
  out.commits = rec.commits;

  return out;
}

// THE TYPING PASS — every typing field of the screen, `typing_passes` times each (Go judges a count only when it
// holds in every pass), in a browser context of its own whose init scripts are the sign-in AND the render hook — the
// context the loads were timed in never carries the hook.
async function typingPass(browser, s) {
  const out = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", serviceWorkers: "block" });

  try {
    await context.addInitScript(installHook, {
      token: s.token,
      team: s.team,
      ready: s.ready,
      cap: s.usable_cap_ms,
      quiet: s.quiet_ms,
    });
    await context.addInitScript(installRenderHook);

    const page = await context.newPage();
    const st = await recorder(context, page);

    for (const f of s.typing) {
      for (let p = 0; p < Math.max(1, s.typing_passes ?? 1); p++) {
        out.push(await typeField(page, st, s, f, p));
      }
    }
  } catch (e) {
    out.push({ field: "", pass: 0, keys: [], settled: [], end: 0, commits: [], error: String(e && e.message ? e.message : e).split("\n")[0] });
  }

  await context.close();

  return out;
}

async function measureScreen(browser, s) {
  const t0 = Date.now();
  const out = { name: s.name, url: s.url, loads: [], probes: [] };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", serviceWorkers: "block" });
  await context.addInitScript(installHook, {
    token: s.token,
    team: s.team,
    ready: s.ready,
    cap: s.usable_cap_ms,
    quiet: s.quiet_ms,
  });

  try {
    const page = await context.newPage();
    const st = await recorder(context, page);

    // What the page itself complained about — the first thing to read when a screen never became usable.
    out.page_errors = [];
    page.on("pageerror", (e) => out.page_errors.length < 20 && out.page_errors.push(String(e.message).split("\n")[0]));
    page.on("console", (m) => {
      if (m.type() === "error" && out.page_errors.length < 20) out.page_errors.push(`console: ${m.text().split("\n")[0]}`);
    });

    out.loads.push(await load(page, st, s, "cold"));

    if (out.loads[0].never) {
      const shot = join(dirname(outPath), `${s.name}-never-usable.png`);
      await page.screenshot({ path: shot }).catch(() => undefined);
      out.screenshot = shot;
    }

    for (let i = 0; i < s.warm_loads; i++) {
      out.loads.push(await load(page, st, s, "warm"));
    }

    // Which call waits on which, measured on the first warm load (the reference Go counts from).
    const ref = out.loads.find((l) => l.kind === "warm");
    if (ref) await dependencyPass(page, st, s, ref);

    // The typing pass, in a context of its own (the render hook), BEFORE the save — it types into the screen as the
    // seed left it, and writes nothing.
    if ((s.typing ?? []).length > 0) out.typing = await typingPass(browser, s);

    // The save goes on the last load (scoping §4); the probes start again from a fresh, uncounted load.
    if (s.save) out.save = await interact(page, st, s, s.save);

    for (const p of s.probes ?? []) {
      await reopen(page, st, s);
      out.probes.push(await interact(page, st, s, p));
    }
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).split("\n")[0];
  }

  await context.close();
  out.secs = Math.round((Date.now() - t0) / 100) / 10;

  return out;
}

const browser = await chromium.launch({ headless: true });
const results = { started: new Date().toISOString(), browser: `chromium ${browser.version()}`, screens: [] };

try {
  for (const [i, s] of plan.screens.entries()) {
    const r = await measureScreen(browser, s);
    results.screens.push(r);
    writeFileSync(outPath, JSON.stringify(results, null, 2));

    const warm = r.loads.filter((l) => l.kind === "warm");
    const usable = warm.map((l) => l.usable_ms).filter((x) => x !== null);
    const save = r.save ? ` · save ${r.save.sent ? `${r.save.requests.length} after` : `NOT SENT (${r.save.error})`}` : "";
    const typed = (r.typing ?? []).filter((t) => !t.error).length;
    const typeErr = (r.typing ?? []).find((t) => t.error);
    const typing = r.typing ? ` · typing ${typed}/${r.typing.length} pass(es)${typeErr ? ` (${typeErr.field}: ${typeErr.error})` : ""}` : "";
    console.log(
      `  [${i + 1}/${plan.screens.length}] ${s.name} — ${warm[0] ? warm[0].requests.length : 0} requests, usable ` +
        `${usable.length ? Math.round(usable[0]) : "never"} ms${save}${typing}${r.error ? ` · ERROR ${r.error}` : ""} (${r.secs}s)`,
    );
  }
} finally {
  await browser.close();
  writeFileSync(outPath, JSON.stringify(results, null, 2));
}
