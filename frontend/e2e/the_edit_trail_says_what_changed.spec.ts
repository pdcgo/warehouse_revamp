import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";

// edits-are-in-the-same-trail (docs/business/inventory/restock_decision.md) — a restock has ONE history: an edit is a
// row of the trail, its status unchanged, and it says WHAT changed, each thing before → after (*Kaos 10 → 12, extra
// stock*). a-line-added-after-arrival-names-its-supplier — a line added while the box is arrived names itself, its count
// and, when given, its supplier and store. the-warehouse-reads-the-box-not-the-purchase
// (docs/technical/frontend/restock_decision.md) — the warehouse's page leaves out the purchase: no price or totals, no
// supplier or store, no paying account, Order ID or shipping; a line whose only change was one of those is not drawn.
//
// The server's rules case by case (every field, the derived values that are not changes, an old row without changes) are
// pinned by inventory_v1/restock_request_update_trail_test.go. What only this file can say is that a REAL edit — through
// the real form, or the real contract — reaches both real pages, each reading its own side.
//
// ⚠ NOT PINNED: an edit written before the changes were kept (none can be seeded here), and whether the warehouse team's
// READ should carry the purchase's changes at all (the slice hides them on the screen only, as Detail already sends it
// the line totals) — the decision says what the warehouse's page shows, not what its read carries.
//
// Every test raises its restocks on a selling team of its own, owned by root, and reaches each side by switching root's
// current team — so the selling page and the warehouse page are both the ones the route picks by team type.

async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A selling team and its warehouse, one supplier with one store, four products and two operational paying accounts.
async function trailGround(page: Page, tag: string) {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  const sellerName = `E2E Trail Seller ${tag} ${SUFFIX}`;
  const warehouseName = `E2E Trail Warehouse ${tag} ${SUFFIX}`;
  const warehouse2Name = `E2E Trail Warehouse ${tag}2 ${SUFFIX}`;
  const seller = await team(sellerName, `TS${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING");
  const warehouse = await team(warehouseName, `TW${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE");
  const warehouse2 = await team(warehouse2Name, `TV${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE");

  const supplierName = `E2E Trail Supplier ${tag} ${SUFFIX}`;
  const supplier = String(
    (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: seller, name: supplierName })).supplier.id,
  );
  const storeName = `E2E Trail Store ${tag} ${SUFFIX}`;
  const store = String(
    (
      await api(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
        teamId: seller,
        supplierId: supplier,
        channelType: "MARKETPLACE_SHOPEE",
        name: storeName,
        uri: `https://shopee.example/e2e-trail-${tag.toLowerCase()}-${SUFFIX}`,
      })
    ).channel.id,
  );

  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Trail Cat ${tag} ${SUFFIX}` });
  const codes = { p: `TR${tag}P${SUFFIX}`, t: `TR${tag}T${SUFFIX}`, q: `TR${tag}Q${SUFFIX}`, r: `TR${tag}R${SUFFIX}` };
  const ids = {} as Record<keyof typeof codes, string>;
  for (const [k, productCode] of Object.entries(codes) as [keyof typeof codes, string][]) {
    ids[k] = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: seller,
          productCodePart: productCode,
          name: `E2E ${productCode}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );
  }

  const account = async (name: string, number: string) => {
    const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name,
      holderName: "E2E",
      accountNumber: number,
      openingBalance: 10_000_000,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    const id = String(created.account.id);
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: seller,
      accountId: id,
      operational: true,
    });
    return id;
  };
  const a1Name = `E2E Trail Kas ${tag} ${SUFFIX}`;
  const a2Name = `E2E Trail Bank ${tag} ${SUFFIX}`;
  const a1 = await account(a1Name, `TRL-${tag}-1-${SUFFIX}`);
  const a2 = await account(a2Name, `TRL-${tag}-2-${SUFFIX}`);

  return {
    seller,
    warehouse,
    warehouseName,
    warehouse2,
    warehouse2Name,
    supplier,
    supplierName,
    store,
    storeName,
    codes,
    ids,
    a1,
    a1Name,
    a2,
    a2Name,
  };
}

type Ground = Awaited<ReturnType<typeof trailGround>>;

// A line of the restock as the contract takes it.
function line(g: Ground, k: keyof Ground["codes"], count: number, total: number, extra: Record<string, unknown> = {}) {
  return { productId: g.ids[k], productCode: g.codes[k], name: `E2E ${g.codes[k]}`, count, total, supplierId: g.supplier, ...extra };
}

// The trail's ONE edit row on the page shown now — its test id, `restock-timeline-<logId>`.
async function theEditRow(page: Page): Promise<string> {
  const edits = page.locator("[data-testid^='restock-timeline-'][data-kind='edit']");
  await expect(edits).toHaveCount(1);
  return (await edits.getAttribute("data-testid"))!;
}

// Every drawn change under a row, in the order shown — the restock's fields and the products, by their test ids.
async function drawn(page: Page, row: string) {
  return page
    .getByTestId(`${row}-changes`)
    .locator(`[data-testid^='${row}-change-']`)
    .evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}|${e.getAttribute("data-field")}`));
}

test.describe("an edit's trail row says what changed", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Restock trail: an ongoing edit through the form lists each change before → after — the warehouse's page only the box's side", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const g = await trailGround(page, "O");
    const { p, t, q, r } = g.codes;

    const R1 = `E2E-TRL-R1-${SUFFIX}`;
    const R2 = `E2E-TRL-R2-${SUFFIX}`;
    const O1 = `E2E-TRL-O1-${SUFFIX}`;
    const O2 = `E2E-TRL-O2-${SUFFIX}`;
    const N1 = "for the sale";
    const N2 = "for the 12.12 sale";
    const LINE_NOTE = "extra stock";

    // GIVEN — an ongoing restock of P 10 for Rp 100.000, T 2 for Rp 20.000 and Q 4 for Rp 40.000, paid from the first
    // account, with a resi, an Order ID and a note; no courier yet.
    const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.a1,
      receipt: R1,
      invoiceRefId: O1,
      note: N1,
      items: [line(g, "p", 10, 100_000), line(g, "t", 2, 20_000), line(g, "q", 4, 40_000)],
    });
    const id = String(created.request.id);

    // WHEN — Edit on its own page: a new resi, Order ID, paying account, note and courier; P becomes 12 for Rp 120.000
    // with a note, T's total Rp 25.000, Q is taken off and R 3 for Rp 30.000 is added.
    await asTeam(page, g.seller);
    await page.goto(`/inventories/restock/${id}`);
    await page.getByTestId(`restock-action-edit-${id}`).click();
    await expect(page.getByTestId("restock-edit-page")).toBeVisible();
    await expect(page.getByTestId("restock-line-0")).toContainText(p);
    await expect(page.getByTestId("restock-line-1")).toContainText(t);

    await page.getByTestId("restock-receipt").fill(R2);
    await page.getByTestId("restock-invoice-ref").fill(O2);
    await page.getByTestId("restock-finance-account").click();
    await page.getByTestId(`restock-finance-account-option-${g.a2}`).click();
    await page.getByTestId("restock-note").fill(N2);
    await page.getByTestId("restock-courier").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();

    await page.getByTestId("restock-qty-0").fill("12");
    await page.getByTestId("restock-total-price-0").fill("120000");
    await page.getByTestId("restock-line-0-note").fill(LINE_NOTE);
    await page.getByTestId("restock-total-price-1").fill("25000");

    await page.getByTestId("restock-pick-products").click();
    await tick(page, q, false);
    await tick(page, r);
    await page.getByTestId("product-picker-confirm").click();
    await expect(page.getByTestId("restock-line-2")).toContainText(r);
    await page.getByTestId("restock-qty-2").fill("3");
    await page.getByTestId("restock-total-price-2").fill("30000");

    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("submit-restock").click();
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

    // THEN — the selling team's page: ONE edit row, every change under it, the restock's own fields first (in the
    // trail's order), then the lines as sent, the removed line last.
    const row = await theEditRow(page);
    await expect(page.getByTestId(`${row}-changes`)).toBeVisible();
    // The server's bare "edited" is not shown — the row says what changed instead.
    await expect(page.getByTestId(`${row}-description`)).toHaveCount(0);

    await test.step("then: the restock's fields, before → after", async () => {
      await expect.soft(page.getByTestId(`${row}-change-receipt`)).toHaveText(`Tracking no. ${R1} → ${R2}`);
      await expect.soft(page.getByTestId(`${row}-change-shipment`)).toHaveText("Courier — → JNE");
      await expect.soft(page.getByTestId(`${row}-change-invoice_ref`)).toHaveText(`Order ID ${O1} → ${O2}`);
      await expect.soft(page.getByTestId(`${row}-change-finance_account`)).toHaveText(`Paid from ${g.a1Name} → ${g.a2Name}`);
      await expect.soft(page.getByTestId(`${row}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);
    });

    await test.step("then: each line — changed, added, removed", async () => {
      const changed = page.getByTestId(`${row}-change-line-${g.ids.p}`);
      await expect.soft(changed).toHaveAttribute("data-field", "line");
      await expect.soft(changed).toHaveText(`E2E ${p} · 10 → 12 pcs · total Rp 100.000 → Rp 120.000 · “${LINE_NOTE}”`);

      await expect
        .soft(page.getByTestId(`${row}-change-line-${g.ids.t}`))
        .toHaveText(`E2E ${t} · total Rp 20.000 → Rp 25.000`);

      const added = page.getByTestId(`${row}-change-line-${g.ids.r}`);
      await expect.soft(added).toHaveAttribute("data-field", "line_added");
      await expect.soft(added).toHaveText(`Added E2E ${r} × 3 · Rp 30.000 · supplier ${g.supplierName}`);

      const removed = page.getByTestId(`${row}-change-line-${g.ids.q}`);
      await expect.soft(removed).toHaveAttribute("data-field", "line_removed");
      await expect.soft(removed).toHaveText(`Removed E2E ${q} × 4`);
    });

    await test.step("then: in the trail's order — the restock's fields, the lines as sent, the removed last", async () => {
      expect
        .soft(await drawn(page, row))
        .toEqual([
          `${row}-change-receipt|receipt`,
          `${row}-change-shipment|shipment`,
          `${row}-change-invoice_ref|invoice_ref`,
          `${row}-change-finance_account|finance_account`,
          `${row}-change-note|note`,
          `${row}-change-line-${g.ids.p}|line`,
          `${row}-change-line-${g.ids.t}|line`,
          `${row}-change-line-${g.ids.r}|line_added`,
          `${row}-change-line-${g.ids.q}|line_removed`,
        ]);
    });

    // THEN — the warehouse's page: the same row, the box's side only.
    await asTeam(page, g.warehouse);
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId(row)).toHaveAttribute("data-kind", "edit");
    const changes = page.getByTestId(`${row}-changes`);
    await expect(changes).toBeVisible();

    await test.step("then: the warehouse reads the box's changes", async () => {
      await expect.soft(page.getByTestId(`${row}-change-receipt`)).toHaveText(`Tracking no. ${R1} → ${R2}`);
      await expect.soft(page.getByTestId(`${row}-change-shipment`)).toHaveText("Courier — → JNE");
      await expect.soft(page.getByTestId(`${row}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.p}`)).toHaveText(`E2E ${p} · 10 → 12 pcs · “${LINE_NOTE}”`);
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.r}`)).toHaveText(`Added E2E ${r} × 3`);
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.q}`)).toHaveText(`Removed E2E ${q} × 4`);
    });

    await test.step("then: not the purchase — no Order ID, account, price, total or supplier; a total-only line is not drawn", async () => {
      await expect.soft(page.getByTestId(`${row}-change-invoice_ref`)).toHaveCount(0);
      await expect.soft(page.getByTestId(`${row}-change-finance_account`)).toHaveCount(0);
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.t}`)).toHaveCount(0);
      await expect.soft(changes).not.toContainText("Rp");
      await expect.soft(changes).not.toContainText(g.supplierName);
      await expect.soft(changes).not.toContainText(O1);
      await expect.soft(changes).not.toContainText(g.a1Name);
    });
  });

  test("Restock trail: a line added after arrival names its supplier and store — the warehouse's page leaves them out", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const g = await trailGround(page, "A");
    const { p, q } = g.codes;
    const LINE_NOTE = "turned up unordered";

    // GIVEN — a restock of P 10 for Rp 100.000, signed for at the warehouse (arrived).
    const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.a1,
      receipt: `E2E-TRL-AR-${SUFFIX}`,
      items: [line(g, "p", 10, 100_000)],
    });
    const id = String(created.request.id);
    await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: g.warehouse, requestId: id });

    // WHEN — Edit Lines: P becomes 12 for Rp 120.000, and Q 5 for Rp 50.000 is added, naming its supplier and store.
    await asTeam(page, g.seller);
    await page.goto(`/inventories/restock/${id}`);
    await page.getByTestId(`restock-action-edit-lines-${id}`).click();
    await expect(page.getByTestId("restock-edit-page")).toBeVisible();
    await page.getByTestId("restock-qty-0").fill("12");
    await page.getByTestId("restock-total-price-0").fill("120000");

    await page.getByTestId("restock-pick-products").click();
    await tick(page, q);
    await page.getByTestId("product-picker-confirm").click();
    await expect(page.getByTestId("restock-line-1")).toContainText(q);
    await page.getByTestId("restock-line-1-picker-trigger").click();
    const dialog = page.getByTestId("restock-line-1-picker-dialog");
    await dialog.getByTestId("restock-line-1-picker-search").fill(g.supplierName);
    await dialog.getByTestId(`restock-line-1-picker-supplier-${g.supplier}`).click();
    await dialog.getByTestId(`restock-line-1-picker-store-${g.store}`).click();
    await dialog.getByTestId("restock-line-1-picker-confirm").click();
    await page.getByTestId("restock-qty-1").fill("5");
    await page.getByTestId("restock-total-price-1").fill("50000");
    await page.getByTestId("restock-line-1-note").fill(LINE_NOTE);

    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("submit-restock").click();
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

    // THEN — the selling team's page: the lines only (nothing else can change once arrived); the added line names itself,
    // its count, its total, its supplier and store, and its note.
    const row = await theEditRow(page);
    await test.step("then: the selling page names the added line's supplier and store", async () => {
      expect.soft(await drawn(page, row)).toEqual([`${row}-change-line-${g.ids.p}|line`, `${row}-change-line-${g.ids.q}|line_added`]);
      await expect
        .soft(page.getByTestId(`${row}-change-line-${g.ids.p}`))
        .toHaveText(`E2E ${p} · 10 → 12 pcs · total Rp 100.000 → Rp 120.000`);
      await expect
        .soft(page.getByTestId(`${row}-change-line-${g.ids.q}`))
        .toHaveText(`Added E2E ${q} × 5 · Rp 50.000 · supplier ${g.supplierName} · store ${g.storeName} · “${LINE_NOTE}”`);
    });

    // THEN — the warehouse's page: the counts and the note, never the price, supplier or store.
    await asTeam(page, g.warehouse);
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId(`${row}-changes`)).toBeVisible();
    await test.step("then: the warehouse page reads the box — counts and the note only", async () => {
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.p}`)).toHaveText(`E2E ${p} · 10 → 12 pcs`);
      await expect.soft(page.getByTestId(`${row}-change-line-${g.ids.q}`)).toHaveText(`Added E2E ${q} × 5 · “${LINE_NOTE}”`);
      await expect.soft(page.getByTestId(`${row}-changes`)).not.toContainText(g.storeName);
    });
  });

  test("Restock trail: every edit is a row — one that changes nothing has none under it, a refused one writes nothing", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const g = await trailGround(page, "N");

    const base = {
      teamId: g.seller,
      financeAccountId: g.a1,
      receipt: `E2E-TRL-N-${SUFFIX}`,
      items: [line(g, "p", 10, 100_000)],
    };
    const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", { ...base, warehouseId: g.warehouse });
    const id = String(created.request.id);
    const update = (body: Record<string, unknown>) =>
      api(page, "inventory.v1.RestockRequestService/RestockRequestUpdate", { ...base, requestId: id, warehouseId: g.warehouse, ...body });

    // A second restock holding another resi — an edit to it is refused (a-reference-in-use-stops-the-restock-form).
    const held = `E2E-TRL-NH-${SUFFIX}`;
    await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      ...base,
      warehouseId: g.warehouse,
      receipt: held,
      items: [line(g, "t", 1, 10_000)],
    });

    // WHEN — an edit that changes nothing; an edit refused; an edit moving it to another warehouse with a shipping cost.
    await update({});
    await expect(update({ receipt: held })).rejects.toThrow(/409/);
    await update({ warehouseId: g.warehouse2, shipmentCost: 15_000 });

    // THEN — the read: two edit rows (the refused one is not there), the first with no changes, the second with the
    // warehouse and the shipping, before and after.
    const detail = await api(page, "inventory.v1.RestockRequestService/RestockRequestDetail", { teamId: g.seller, requestId: id });
    const edits = (detail.request.logs as { id: string; description: string; changes?: any[] }[]).filter(
      (l) => l.description === "edited",
    );
    expect(edits, JSON.stringify(detail.request.logs)).toHaveLength(2);
    expect(edits[0].changes ?? []).toEqual([]);
    expect(
      (edits[1].changes ?? []).map((c) => ({ field: c.field, before: c.before ?? "", after: c.after ?? "" })),
    ).toEqual([
      { field: "RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE", before: g.warehouse, after: g.warehouse2 },
      { field: "RESTOCK_LOG_CHANGE_FIELD_SHIPMENT_COST", before: "0", after: "15000" },
    ]);

    const nothing = `restock-timeline-${edits[0].id}`;
    const moved = `restock-timeline-${edits[1].id}`;

    // THEN — the selling team's page: both rows; the empty edit shows who and when, nothing under it.
    await asTeam(page, g.seller);
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.locator("[data-testid^='restock-timeline-'][data-kind='edit']")).toHaveCount(2);
    await expect(page.getByTestId(nothing)).toBeVisible();
    await expect(page.getByTestId(`${nothing}-changes`)).toHaveCount(0);
    await expect(page.getByTestId(`${moved}-change-warehouse`)).toHaveText(`Warehouse ${g.warehouseName} → ${g.warehouse2Name}`);
    await expect(page.getByTestId(`${moved}-change-shipment_cost`)).toContainText("Rp 15.000");

    // THEN — the new warehouse's page: the move, not the shipping.
    await asTeam(page, g.warehouse2);
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId(`${moved}-change-warehouse`)).toBeVisible();
    await expect(page.getByTestId(`${moved}-change-shipment_cost`)).toHaveCount(0);
    await expect(page.getByTestId(`${nothing}-changes`)).toHaveCount(0);
  });
});
