import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #34 — the curated shared-components showcase: a navigable gallery, plus the two new shared
// pickers it must include (ShippingSelect and the nested CategorySelect).

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

test("the showcase loads, is navigable, and includes the shipping and nested-category pickers", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // It is a dev page — reached by URL, not the main menu.
  await page.goto("/components");
  await expect(page.getByTestId("components-page")).toBeVisible();

  // The navigation requirement: a sidebar links to every component, including the two this
  // issue adds.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "ShippingSelect" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "CategorySelect" })).toBeVisible();

  // Both required pickers render in the gallery (their triggers exist regardless of whether the
  // backing catalogue has data yet). The CategorySelect card now shows two instances — the default
  // and the leafOnly variant (#63) — so assert the first.
  await expect(page.getByTestId("shipping-select")).toBeVisible();
  await expect(page.getByTestId("category-select").first()).toBeVisible();

  // The nav anchor jumps to the component's card.
  await nav.getByRole("link", { name: "CategorySelect" }).click();
  await expect(page).toHaveURL(/#category-select$/);
});

// #146 — ShippingSelect is a searchable Combobox, and it can be CLEARED back to no courier.
//
// The clear is the part worth pinning. No courier is a legitimate value — neither a restock nor an
// order requires one — and a picker that swallows the empty case is WRITE-ONCE: a courier chosen by
// mistake can never be removed, though the contract allows it. That exact bug was found in #131, and
// the combobox conversion is a fresh chance to reintroduce it.
test("ShippingSelect: search picks a courier, and clearing returns to none (#146)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/components");

  const select = page.getByTestId("shipping-select");
  await expect(select).toBeVisible();

  // Searchable: typing narrows the list. "sicepat" is one of the seeded couriers.
  await select.locator("input").fill("sicepat");
  await page.getByTestId("shipping-select-option-sicepat").click();

  // The gallery demo echoes the emitted CODE — a stable key, not the display name.
  await expect(page.getByText("Selected code: sicepat")).toBeVisible();

  // And back to none. This is the assertion the write-once bug would fail.
  await select.locator("input").clear();
  await select.getByRole("button", { name: /clear/i }).click();

  await expect(page.getByText("Selected code: (none)")).toBeVisible();
});

// #109/#131 — SupplierSelect is a searchable Combobox, and it can be CLEARED back to no supplier.
//
// The clear is the part worth pinning, for the same reason as ShippingSelect: no supplier is a
// legitimate value (a restock need not name one), and a picker that swallows the empty case is
// WRITE-ONCE — a supplier recorded by mistake could never be removed. That exact bug was found in
// #131, and converting to a combobox is a fresh chance to reintroduce it.
test("SupplierSelect: search picks a supplier, and clearing returns to none (#109)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A supplier for the ROOT team, which is the team the gallery demo runs as.
  const supplier = await page.evaluate(async () => {
    const token =
      window.sessionStorage.getItem("warehouse_revamp.token") ??
      window.localStorage.getItem("warehouse_revamp.token");

    const res = await fetch(
      "http://localhost:8081/warehouse.inventory.v1.SupplierService/SupplierCreate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId: "1", name: "E2E Combobox Supplier", code: "ECS1" }),
      },
    );
    if (!res.ok) throw new Error(`SupplierCreate: ${res.status} ${await res.text()}`);

    return (await res.json()).supplier;
  });

  await page.goto("/components");

  const select = page.getByTestId("supplier-select");
  await expect(select).toBeVisible();

  // Searchable, and matching on the CODE rather than the name — people type either.
  await select.locator("input").fill("ECS1");
  await page.getByTestId(`supplier-select-option-${supplier.id}`).click();

  await expect(page.getByText(`Selected supplier id: ${supplier.id}`)).toBeVisible();

  // And back to none. This is the assertion the write-once bug would fail.
  await select.locator("input").clear();
  await select.getByRole("button", { name: /clear/i }).click();

  await expect(page.getByText("Selected supplier id: 0")).toBeVisible();
});
