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
async function pushDraft(page: Page, externalId: string, address?: Record<string, string>) {
  const status = await page.evaluate(async ({ id, address }: { id: string; address?: Record<string, string> }) => {
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
          // The address as a marketplace writes it — plain names (an-address-is-plain-names); none by default.
          address,
          // No `platformTotal` on purpose — the list below names the missing sell price. (A draft carries no
          // shipping money since selling 00027; the app's old `shippingCost` is gone from the payload.)
          items: [
            { externalSku: "MP-1", externalName: "Kaos Polos Hitam L", quantity: 2, unitPrice: "50000" },
          ],
        }),
      },
    );

    return res.status;
  }, { id: externalId, address });

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

  // The scrape could not know our shop or our warehouse, read no address and no courier — so the row names what is
  // left rather than a bare "not ready". Under the reference, where the order list puts the stage: the first gap by name
  // and the rest counted, every one of them on the badge's title (`the-draft-list-is-the-drafts-tab`). This push also
  // read no order date and no sell price, which Create refuses too. NO mapping gap and no "unmapped" count: a draft stores
  // no mapping (the-drafts-list-counts-no-mapping) — Baris is the line count.
  const draftRow = page.getByTestId(/^draft-row-/).filter({ hasText: EXTERNAL_ID });
  const gaps = draftRow.getByTestId(/^draft-gaps-/);
  await expect(gaps).toHaveText("Shop +5");
  await expect(gaps).toHaveAttribute("title", "Shop · Warehouse · Address · Courier · Order date · Sell price");
  await expect(draftRow.getByTestId(/^draft-lines-/)).toHaveText("1");
  await expect(draftRow).not.toContainText(/unmapped/i);

  // #16 — the Ready card is the server's set-wide ready_count, out of the same total as the Drafts card: no ⚠ and no
  // "on this page". This draft is not ready, so it does not count.
  const total = (await page.getByTestId("draft-summary-total-value").textContent())?.trim();
  await expect(page.getByTestId("draft-summary-ready-value")).toHaveText(`0 of ${total}`);
  await expect(page.getByTestId("draft-summary-ready")).not.toContainText("on this page");
  await expect(page.locator('[data-testid^="not-implemented-"]')).toHaveCount(0);
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

// A DRAFT OPENS IN THE ORDER FORM (the-draft-opens-in-the-order-form) — the draft's own page, with its row mapping,
// Save and Promote (#196), was folded into /orders/new?draft=ID, which it seeds. A draft SAVED FROM THE FORM reopening
// there is orders.spec.ts's; what only a PUSHED draft brings is checked here: the scrape as text above the products,
// the buyer it carried, and the way to drop it.
//
// Deliberately NOT a Create through the form: that needs a category, a shop, a warehouse, a product AND a seeded stock
// level — the whole fixture chain orders.spec.ts already builds and exercises.
test("Order drafts: a pushed draft opens in the order form, its scrape as text, and is deleted from there", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/order-drafts");

  const ref = `${EXTERNAL_ID}-D`;
  await pushDraft(page, ref);
  await page.reload();

  // The ROW opens the draft — clicked on its date, because the reference itself is a copy button and
  // copying must not navigate.
  await page.getByTestId(/^draft-row-/).filter({ hasText: ref }).getByTestId(/^draft-updated-/).click();
  await expect(page).toHaveURL(/\/orders\/new\?draft=\d+$/);
  await expect(page.getByTestId("order-create-draft-ref")).toHaveText(`Draft ${ref}`);

  // THE EVIDENCE OF WHAT WAS ORDERED — the marketplace's own words, verbatim, above the products, and which app sent
  // them. Nothing in it is copied into a line: a scraped title names no product of ours.
  await expect(page.getByTestId("draft-product-hints-source")).toContainText("e2e-scraper");
  await expect(page.getByTestId("draft-product-hint-0")).toHaveText(/^2 × Kaos Polos Hitam L · Rp\s?50\.000$/);

  // Seeded once from the draft; after that the form is the person's.
  await expect(page.getByTestId("order-create-customer-name")).toHaveValue("Budi");

  // A draft is finished here or left on the list as it is — no Save as Draft on it.
  await expect(page.getByTestId("order-create-save-draft")).toHaveCount(0);

  // Dropping it confirms (destructive actions always confirm), then lands back on the list without it.
  await page.getByTestId("order-create-delete-draft").click();
  await expect(page.getByText(`Delete draft ${ref}?`)).toBeVisible();
  await page.getByTestId("confirm-action").click();

  await expect(page).toHaveURL(/\/order-drafts$/);
  await expect(page.getByTestId(/^draft-row-/).filter({ hasText: ref })).toHaveCount(0);
});

// THE DRAFT'S ADDRESS IN THE FORM, through the real server (the-cs-edits-the-whole-address-before-create): the draft keeps
// names only, and OrderDraftDetail asks region_service's RegionMatch in-process. "Kab. Aceh Selatan" names the e2e region
// fixture's one place, so the dropdowns open PRE-FILLED in the region list's spelling; "Kota Aceh Selatan" (the place is
// a Kabupaten) names none, so they open EMPTY. Either way the marketplace's text is shown beside them, and the street
// line is seeded.
test("Order drafts: a draft's address pre-fills the form when its names match one place, and stays empty otherwise", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const level = (name: string) => page.getByTestId(`address-${name}`).getByRole("combobox");

  const certain = `${EXTERNAL_ID}-ADDR`;
  await pushDraft(page, certain, {
    provinsiName: "ACEH",
    kabupatenName: "Kab. Aceh Selatan",
    kecamatanName: "Bakongan",
    desaName: "Keude Bakongan",
    kodePos: "23773",
    addressLine: "Jl. Merdeka 1",
  });
  await page.goto("/order-drafts");
  await page.getByTestId(/^draft-row-/).filter({ hasText: certain }).getByTestId(/^draft-updated-/).click();

  await expect(level("desa")).toHaveValue("Keude Bakongan");
  await expect(level("provinsi")).toHaveValue("Aceh");
  await expect(level("kabupaten")).toHaveValue("Kabupaten Aceh Selatan");
  await expect(level("kecamatan")).toHaveValue("Bakongan");
  await expect(page.getByTestId("address-line")).toHaveValue("Jl. Merdeka 1");
  await expect(page.getByTestId("draft-address-text-place")).toHaveText(
    "Keude Bakongan, Bakongan, Kab. Aceh Selatan, ACEH 23773",
  );

  const unsure = `${EXTERNAL_ID}-NOADDR`;
  await pushDraft(page, unsure, {
    provinsiName: "Aceh",
    kabupatenName: "Kota Aceh Selatan",
    kecamatanName: "Bakongan",
    desaName: "Keude Bakongan",
    addressLine: "Jl. Merdeka 2",
  });
  await page.goto("/order-drafts");
  await page.getByTestId(/^draft-row-/).filter({ hasText: unsure }).getByTestId(/^draft-updated-/).click();

  await expect(page.getByTestId("draft-address-text-street")).toHaveText("Jl. Merdeka 2");
  await expect(page.getByTestId("address-line")).toHaveValue("Jl. Merdeka 2");
  for (const name of ["provinsi", "kabupaten", "kecamatan", "desa"]) {
    await expect(level(name)).toHaveValue("");
  }

  // Root's drafts are left as this spec found them — none.
  await page.goto("/order-drafts");
  await page.getByTestId("select-all-drafts").click();
  await page.getByTestId("delete-selected-drafts").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("order-drafts-empty")).toBeVisible();
});
