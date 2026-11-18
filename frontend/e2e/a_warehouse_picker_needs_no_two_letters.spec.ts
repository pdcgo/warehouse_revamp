import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// A WAREHOUSE'S PRODUCT PICKER NEEDS NO TWO LETTERS — a-product-picker-needs-no-two-letters
// (docs/technical/frontend/context_decision.md; owner: *"harusnya tidak perlu minimal 2 huruf"*), on the real server and
// Postgres. Opened with nothing typed, the picker lists the first page of what THIS warehouse has held, by name; ONE
// letter is a search. It never offers a product the warehouse never held (a-warehouse-picks-only-what-it-has-held), and
// the old *Ketik minimal 2 huruf* hint is gone.
//
// The picker is reached the way the warehouse reaches it — Report Found on a rack's page. A warehouse of the test's own,
// so "what it has held" is exactly the two products it counted in: Apel and Jeruk; Jambu is in the catalogue, never here.
//
// ⚠ The names are chosen for the one-letter searches: only Jeruk and Jambu carry a "j", and no name, code or team code
// here carries an "x".

async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

test("Warehouse picker: opened with nothing typed it lists what the warehouse has held, by name — one letter is a search", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const warehouse = await team(`E2E Picker Gudang ${SUFFIX}`, `PG${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const seller = await team(`E2E Picker Seller ${SUFFIX}`, `PS${SUFFIX}`, "TEAM_TYPE_SELLING");
  const rack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `pk-${SUFFIX}`, name: "E2E picker shelf" })).rack.id);

  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Picker Cat ${SUFFIX}` })).category.id;
  const product = async (part: string, name: string) => {
    const p = (await api(page, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: part, name, categoryId: category })).product;
    return { id: String(p.id), code: String(p.productCode || part), name };
  };
  const apel = await product(`PKA${SUFFIX}`, `Apel Merah ${SUFFIX}`);
  const jeruk = await product(`PKB${SUFFIX}`, `Jeruk Nipis ${SUFFIX}`);
  // In the seller's catalogue, never counted into this warehouse.
  const jambu = await product(`PKC${SUFFIX}`, `Jambu Air ${SUFFIX}`);

  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Picker Kas ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `PICK-${SUFFIX}`,
        openingBalance: 1_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: seller, accountId: account, operational: true });

  // GIVEN — the warehouse has held Apel and Jeruk: a restock of one each, counted in whole onto the rack.
  const raised = (
    await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: seller,
      warehouseId: warehouse,
      financeAccountId: account,
      receipt: `E2E-PICK-${SUFFIX}`,
      items: [apel, jeruk].map((p) => ({ productId: p.id, productCode: p.code, name: p.name, count: 1, total: 10_000 })),
    })
  ).request;
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: raised.id,
    lines: (raised.items as { id: string }[]).map((item) => ({
      itemId: item.id,
      receivedCount: 1,
      placements: [{ placementId: rack, quantity: 1 }],
    })),
  });

  // WHEN — the warehouse opens Report Found on its rack, and clicks the product field with nothing typed.
  await asTeam(page, warehouse);
  await page.goto(`/inventories/racks/${rack}`);
  await page.getByTestId("rack-action-report-found").click();
  const dialog = page.getByTestId("report-found-dialog");
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("combobox");
  await field.click();

  // THEN — the first page of what it has held, by name: Apel, then Jeruk. Never Jambu, and no two-letter hint.
  const options = dialog.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute("data-testid", `product-select-option-${apel.code}`);
  await expect(options.nth(1)).toHaveAttribute("data-testid", `product-select-option-${jeruk.code}`);
  await expect(dialog.getByTestId(`product-select-option-${jambu.code}`)).toHaveCount(0);
  await expect(page.getByTestId("product-select-type-two")).toHaveCount(0);
  await expect(dialog.getByTestId("product-select-none")).toBeHidden();

  // WHEN — one letter. THEN — it searches: Jeruk alone (Jambu carries a "j" too, but was never held here).
  await field.pressSequentially("j", { delay: 30 });
  await expect(options).toHaveCount(1);
  await expect(dialog.getByTestId(`product-select-option-${jeruk.code}`)).toBeVisible();
  await expect(dialog.getByTestId(`product-select-option-${jambu.code}`)).toHaveCount(0);

  // WHEN — a letter nothing held carries. THEN — "no products found", never a hint to type more.
  await field.press("Backspace");
  await field.pressSequentially("x", { delay: 30 });
  await expect(dialog.getByTestId("product-select-none")).toBeVisible();
  await expect(options).toHaveCount(0);
  await expect(page.getByTestId("product-select-type-two")).toHaveCount(0);

  // …and one letter again is enough to pick from.
  await field.press("Backspace");
  await field.pressSequentially("j", { delay: 30 });
  await expect(options).toHaveCount(1);
  await dialog.getByTestId(`product-select-option-${jeruk.code}`).click();
  await expect(field).toHaveValue(new RegExp(jeruk.name));
});
