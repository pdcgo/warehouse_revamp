import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #195 — the /order-drafts list: incomplete orders pushed in by a third-party app.
//
// Root is a ROOT team, so the Order Drafts menu item is not offered (it is a selling-team surface),
// but root holds ROLE_ROOT and the RPCs are authorised in team 1 — so the route is reached directly,
// exactly as orders.spec.ts reaches the selling screens. The menu gate is UX only.
//
// ⚠ THERE IS NO "NEW DRAFT" BUTTON, and there never will be: every draft traces to a real scrape
// pushed by an external app. So the fixture below pushes one over the API, which is also the honest
// shape of the test — it exercises the door drafts actually come through.

const SUFFIX = Date.now().toString().slice(-6);
const EXTERNAL_ID = `SHP-${SUFFIX}`;

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// pushDraft calls OrderDraftPush the way the external app does — over Connect's JSON protocol, with
// the logged-in person's own token, because the app authenticates as a user (there is no machine
// identity in this system).
async function pushDraft(page: Page, externalId: string) {
  const status = await page.evaluate(async (id: string) => {
    const token =
      window.sessionStorage.getItem("warehouse_revamp.token") ??
      window.localStorage.getItem("warehouse_revamp.token");

    const res = await fetch(
      "http://localhost:8081/warehouse.selling.v1.OrderDraftService/OrderDraftPush",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          teamId: "1",
          source: "e2e-scraper",
          externalId: id,
          customerName: "Budi",
          shippingCost: "15000",
          items: [
            { externalSku: "MP-1", externalName: "Kaos Polos Hitam L", quantity: 2, unitPrice: "50000" },
          ],
        }),
      },
    );

    return res.status;
  }, externalId);

  expect(status).toBe(200);
}

test.describe.configure({ mode: "serial" });

test("Order drafts: a pushed draft appears, saying exactly what it still needs (#195)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/order-drafts");

  await expect(page.getByTestId("order-drafts-table")).toBeVisible();

  await pushDraft(page, EXTERNAL_ID);
  await page.reload();

  const row = page.getByText(EXTERNAL_ID);
  await expect(row).toBeVisible();

  // The scrape could not know our shop, our warehouse, or which product the title refers to — so the
  // screen names each of those rather than a bare "not ready". Somebody scanning forty drafts is
  // deciding which to open next, and "needs a warehouse" is a different job from "lines unmapped".
  await expect(page.getByText("Shop", { exact: true })).toBeVisible();
  await expect(page.getByText("Warehouse", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 1 unmapped")).toBeVisible();
});

// PRUNING IS THE OTHER HALF OF THIS SCREEN. Nothing expires, and an app pushing continuously fills
// the list faster than a person finishes one — so deleting several at once is load-bearing.
test("Order drafts: several are selected and deleted in one action (#195)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/order-drafts");

  await pushDraft(page, `${EXTERNAL_ID}-A`);
  await pushDraft(page, `${EXTERNAL_ID}-B`);
  await page.reload();

  await expect(page.getByText(`${EXTERNAL_ID}-A`)).toBeVisible();
  await expect(page.getByText(`${EXTERNAL_ID}-B`)).toBeVisible();

  // Select every draft on the page, then delete them together.
  await page.getByTestId("select-all-drafts").click();
  await page.getByTestId("delete-selected-drafts").click();

  // Destructive actions always confirm (CLAUDE.md), and the title is Title Case.
  await expect(page.getByText("Delete Order Drafts")).toBeVisible();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId("order-drafts-empty")).toBeVisible();
});

// #196 — the detail screen, where scraped text becomes a real product.
//
// Deliberately NOT a full promote-through-the-UI run: promoting deducts stock, so that path needs a
// category, a shop, a warehouse, a product AND a seeded stock level — the whole fixture chain
// orders.spec.ts already builds and exercises. The backend's promote rules have their own unit tests
// (#194). What only a browser can check is what this screen PUTS IN FRONT OF SOMEBODY: the evidence
// beside the mapping, and a Promote button that says why it is disabled.
test("Order drafts: the detail shows the scrape beside the mapping, and says why it cannot promote (#196)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/order-drafts");

  const ref = `${EXTERNAL_ID}-D`;
  await pushDraft(page, ref);
  await page.reload();

  await page.getByText(ref).click();
  await expect(page.getByTestId("draft-detail-page")).toBeVisible();

  // THE EVIDENCE OF WHAT WAS ORDERED, on screen and not replaced by the mapping. Without it nobody
  // can tell a wrong match from a right one — which is the whole reason both halves live on the line.
  await expect(page.getByTestId("draft-line-scraped-0")).toHaveText("Kaos Polos Hitam L");
  await expect(page.getByTestId("draft-line-unmapped-0")).toBeVisible();

  // Promote is refused, and the reasons are beside the button rather than behind a click.
  await expect(page.getByTestId("draft-promote")).toBeDisabled();
  await expect(page.getByTestId("draft-gaps")).toBeVisible();

  // A person's edit lands, and the app may never overwrite that field again.
  await page.getByTestId("draft-customer-name").fill("Budi Santoso");
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save")).toBeDisabled();

  await pushDraft(page, ref);
  await page.reload();
  await expect(page.getByTestId("draft-customer-name")).toHaveValue("Budi Santoso");
});
