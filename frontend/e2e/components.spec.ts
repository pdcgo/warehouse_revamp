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

// #166 — CurrencyInput formats as you type and refuses what is not a price.
//
// The leading-zero rule is the whole reason this is not a plain number input: every money field in
// this app starts at "0", so typing into one used to produce "020000". A person who types 20000 and
// sees 020000 stops trusting the field.
test("CurrencyInput: formats as you type, drops leading zeros, emits raw digits (#166)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/components");

  const field = page.getByTestId("components-page").locator("#currency-input input");
  await expect(field).toBeVisible();

  // Grouped the way Indonesian money is written.
  await field.fill("20000");
  await expect(field).toHaveValue("20.000");

  // The CALLER still sees raw digits — the grouping is display only, so nothing downstream has to
  // strip a separator back off.
  await expect(page.getByText("Raw value sent to the caller: 20000")).toBeVisible();

  // No leading zero. Typing 0 then 5000 gives 5.000, not 05.000.
  await field.fill("0");
  await field.fill("05000");
  await expect(field).toHaveValue("5.000");

  // Anything that is not a digit is refused outright — a "-" or an "e" is not a price, and a plain
  // number input would have silently accepted both.
  await field.fill("12ab-3e4");
  await expect(field).toHaveValue("1.234");

  // Emptied is EMPTY, not 0: a person who cleared the field has not typed yet, and filling it with a
  // zero on their behalf answers a question they were still thinking about.
  await field.fill("");
  await expect(field).toHaveValue("");
  await expect(page.getByText("Raw value sent to the caller: (empty)")).toBeVisible();
});

// #165 — PaymentTypeSelect is a Chakra Select now, and "not recorded" is still SELECTABLE.
//
// That last part is the #131 lesson in a third costume: no payment type is a real answer, so a person
// who records one by mistake must be able to go back to having recorded none. A picker you cannot
// un-set is write-once.
test("PaymentTypeSelect: pick a type, then go back to not recorded (#165)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/components");

  const trigger = page.getByTestId("restock-payment-type");
  await expect(trigger).toBeVisible();

  // Starts unrecorded.
  await expect(page.getByText("Selected: (not recorded)")).toBeVisible();

  await trigger.click();
  await page.getByTestId(`payment-type-${1}`).click(); // SHOPEE_PAY
  await expect(page.getByText("Selected: Shopee Pay")).toBeVisible();

  // And back to none — the assertion a write-once picker would fail.
  await trigger.click();
  await page.getByTestId("payment-type-none").click();
  await expect(page.getByText("Selected: (not recorded)")).toBeVisible();
});
