import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { API_URL, UI_URL, signInStatePath } from "./env";

// The ground of an Analytic acceptance spec, seeded from the TEST RUNNER (Node fetch, no root page) and signed in with
// the role's own Login token (no form) — the pattern of expense_metric_shows_each_type.spec.ts, shared by
// order_metric_shows_each_move.spec.ts and inventory_metric_shows_the_restock_before_the_accept.spec.ts.

const TOKEN_KEY = "warehouse_revamp.token";
const TEAM_KEY = "warehouse_revamp.team";

/** An RPC through the API, as `token` (none for Login) — its JSON body; anything but 200 throws with the answer. */
export async function call<T = any>(token: string | null, method: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

export const login = async (who: string, password: string) =>
  (await call<{ token: string }>(null, "user.v1.AuthService/Login", { username: who, password })).token;

let rootToken: Promise<string> | undefined;
/** Root's token — the one the setup saved (e2e/session.ts), or a fresh Login. */
export function root(): Promise<string> {
  rootToken ??= (async () => {
    const saved = signInStatePath(ROOT_USERNAME);
    if (existsSync(saved)) {
      const state = JSON.parse(readFileSync(saved, "utf8")) as { origins: { localStorage: { name: string; value: string }[] }[] };
      const token = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === TOKEN_KEY)?.value;
      if (token) return token;
    }

    return login(ROOT_USERNAME, ROOT_PASSWORD);
  })();

  return rootToken;
}

export const asRoot = async <T = any>(method: string, body: unknown) => call<T>(await root(), method, body);

/** Signed in as `username`: its own token in the fresh page's storage, `team` planted as the tab's active team. */
export async function signInAs(page: Page, username: string, password: string, team: string) {
  const token = await login(username, password);
  await page.context().setStorageState({
    cookies: [],
    origins: [{ origin: UI_URL, localStorage: [{ name: TOKEN_KEY, value: token }] }],
  });
  await page.addInitScript(
    ([key, id]) => {
      try {
        window.sessionStorage.setItem(key, id);
      } catch {
        // a document with no storage of its own (about:blank): nothing to plant there
      }
    },
    [TEAM_KEY, team] as const,
  );
}

/** Today, the business's day (Jakarta) — a daily row's key. */
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/** A rupiah figure as Analytic writes it. */
export const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** A metric id as its test ids carry it: metrics/orders/moves → metrics-orders-moves. */
export const slugOf = (metricId: string) => metricId.replaceAll("/", "-");

/**
 * THE WHEN — add analytic metric, as the person does it: Add Metric, the category, the metric ticked (its chip lands on
 * the bar), Done. The page must already be on Analytic (its group, range and filter in the address).
 */
export async function addMetric(page: Page, category: string, metricId: string) {
  const slug = slugOf(metricId);
  await page.getByTestId("analytic-add-metric").click();
  const menu = page.getByTestId("analytic-metric-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId(`analytic-category-${category}`).click();
  const item = menu.getByTestId(`analytic-category-${category}-metrics`).getByTestId(`analytic-metric-${slug}`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId(`analytic-chip-${slug}`)).toBeVisible();
  await menu.getByTestId("analytic-metric-done").click();
  await expect(menu).toBeHidden();
}
