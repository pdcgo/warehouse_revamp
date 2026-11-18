import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, login, api, restockGround, seed, tick } from "./restock_helpers";
import { pickTeam } from "./pickers";

// a-reference-in-use-stops-the-restock-form (docs/technical/frontend/restock_decision.md) — a resi or an Order ID that
// another restock of the SAME team already holds (any status but cancelled; letter case and the spaces around it aside;
// an empty value holds nothing; the restock being edited is not its own duplicate) is danger under its field, with the
// holder's number and status, and holds Buat/Simpan back. Both halves are built: the screen asks the list's search as
// typing pauses, and the server refuses the save (AlreadyExists + RestockReferenceInUse) — so a restock saved with the
// same value AFTER the screen asked still cannot pass.
//
// The server's rules case by case (every status, the migration's guard, two saves at the same second) are pinned by
// inventory_v1/restock_reference_in_use*_test.go. What only this file can say is that the real server's answer reaches
// the real form: the wire carries the detail the form decodes, and the form shows it where the person typed.
//
// ⚠ NOT PINNED: a resi on ANOTHER team's restock. The decision checks this team's only; whether another team's should
// stop the form is undefined (restock-form/pending.ts keeps it marked), so no test here says either way.
//
// Every restock is raised on team 1 (root), and every reference carries SUFFIX — team 1 is shared by every spec in a
// run, and a fixed value would be "in use" the second time anything raised it.

const RECEIPT = "RESTOCK_REFERENCE_RECEIPT";
const INVOICE_REF = "RESTOCK_REFERENCE_INVOICE_REF";
const ONGOING = "RESTOCK_REQUEST_STATUS_ONGOING";

// The contract called RAW — `api` throws on any non-2xx, and a refusal is what these tests are about.
async function raw(page: Page, method: string, body: unknown): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json().catch(() => null) };
    },
    [method, body, API_URL] as const,
  );
}

type Ground = Awaited<ReturnType<typeof restockGround>>;

// One restock of team 1, raised through the API, carrying the given references.
function raise(page: Page, g: Ground, refs: { receipt?: string; invoiceRefId?: string }) {
  return raw(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: g.warehouseId,
    financeAccountId: g.accountId,
    ...refs,
    items: [{ productId: g.productId, productCode: g.skuA, name: `E2E ${g.skuA}`, count: 2, total: 20000 }],
  });
}

// The refusal as the wire carries it: AlreadyExists (409) and ONE RestockReferenceInUse detail, whose held entries are
// what the form reads to put the danger under the right field.
function heldIn(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body.code).toBe("already_exists");

  const details = (res.body.details ?? []).filter((d: any) => d.type === "warehouse.inventory.v1.RestockReferenceInUse");
  expect(details, JSON.stringify(res.body)).toHaveLength(1);

  return details[0].debug.held as { reference: string; holderId: string; holderStatus: string }[];
}

// The create form filled in full but for its references — one product, its supplier, the warehouse, the paying
// account and the courier — so the ready line waits on the resi alone.
async function fillAllButReferences(page: Page, s: Awaited<ReturnType<typeof seed>>) {
  await page.goto("/inventories/restock/new");

  await page.getByTestId("restock-pick-products").click();
  await tick(page, s.skuA);
  await page.getByTestId("product-picker-confirm").click();
  await expect(page.getByTestId("restock-line-0")).toBeVisible();
  await page.getByTestId("restock-qty-0").fill("3");
  await page.getByTestId("restock-total-price-0").fill("30000");

  await pickTeam(page, page.getByTestId("restock-warehouse"), s.whCode);

  await page.getByTestId("restock-finance-account").click();
  await page.getByTestId(`restock-finance-account-option-${s.accountId}`).click();

  await page.getByTestId("restock-all-supplier-picker-trigger").click();
  await page.getByTestId("restock-all-supplier-picker-search").fill(s.supplierName);
  await page.getByTestId(`restock-all-supplier-picker-supplier-${s.supplierId}`).click();
  await page.getByTestId("restock-all-supplier-picker-confirm").click();
  await expect(page.getByTestId("restock-line-0-supplier-shown")).toContainText(s.supplierName);

  await page.getByTestId("restock-courier").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();

  await expect(page.getByTestId("restock-form-missing-receipt")).toBeVisible();
}

// The restock the list shows for a product only this test raised.
async function restockIdOf(page: Page, productCode: string) {
  await expect(page).toHaveURL(/\/inventories\/restock$/);
  const row = page.getByTestId("restock-requests-table").locator("tbody tr").filter({ hasText: productCode });
  await expect(row).toHaveCount(1);

  return (await row.getAttribute("data-testid"))!.replace("restock-row-", "");
}

test.describe("a reference in use stops the restock", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Restock API: a held resi or Order ID is AlreadyExists naming its holder — re-cased, an edit too, a cancelled one frees it", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const g = await restockGround(page, "RA");

    const R = `E2E-API-R-${SUFFIX}`;
    const O = `E2E-API-O-${SUFFIX}`;
    const held = await raise(page, g, { receipt: R, invoiceRefId: O });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    const holderId = String(held.body.request.id);

    // The resi, in other letters and with spaces round it, is the same resi.
    expect(heldIn(await raise(page, g, { receipt: `  ${R.toLowerCase()} `, invoiceRefId: `E2E-API-O2-${SUFFIX}` }))).toEqual([
      { reference: RECEIPT, holderId, holderStatus: ONGOING },
    ]);

    // The Order ID on its own, the same way.
    expect(heldIn(await raise(page, g, { receipt: `E2E-API-R2-${SUFFIX}`, invoiceRefId: ` ${O.toLowerCase()}` }))).toEqual([
      { reference: INVOICE_REF, holderId, holderStatus: ONGOING },
    ]);

    // Both at once: one entry per reference held.
    const both = heldIn(await raise(page, g, { receipt: R, invoiceRefId: O }));
    expect(both).toHaveLength(2);
    expect(both).toEqual(
      expect.arrayContaining([
        { reference: RECEIPT, holderId, holderStatus: ONGOING },
        { reference: INVOICE_REF, holderId, holderStatus: ONGOING },
      ]),
    );

    // An empty reference holds nothing: two restocks with neither both pass.
    for (let i = 0; i < 2; i++) {
      const none = await raise(page, g, {});
      expect(none.status, JSON.stringify(none.body)).toBe(200);
    }

    // AN ONGOING EDIT is held to the same rule — and is never its own duplicate.
    const mineR = `E2E-API-M-${SUFFIX}`;
    const mine = await raise(page, g, { receipt: mineR });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const item = mine.body.request.items[0];
    const edit = (receipt: string) =>
      raw(page, "inventory.v1.RestockRequestService/RestockRequestUpdate", {
        teamId: "1",
        requestId: mine.body.request.id,
        warehouseId: g.warehouseId,
        financeAccountId: g.accountId,
        receipt,
        items: [{ id: item.id, productId: g.productId, productCode: g.skuA, name: `E2E ${g.skuA}`, count: 2, total: 20000 }],
      });

    expect(heldIn(await edit(R))).toEqual([{ reference: RECEIPT, holderId, holderStatus: ONGOING }]);

    const own = await edit(` ${mineR.toLowerCase()} `);
    expect(own.status, `re-saving its own resi: ${JSON.stringify(own.body)}`).toBe(200);

    // A CANCELLED restock holds nothing — a cancelled parcel never came — so its resi is free to take.
    await api(page, "inventory.v1.RestockRequestService/RestockRequestCancel", {
      teamId: "1",
      requestId: holderId,
      moneyReturned: false,
    });
    const taken = await raise(page, g, { receipt: R, invoiceRefId: O });
    expect(taken.status, `a cancelled restock's references: ${JSON.stringify(taken.body)}`).toBe(200);
  });

  test("Restock form: a resi or Order ID another restock holds is danger under its field and holds Buat and Simpan back", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const s = await seed(page, "RU");
    const g = await restockGround(page, "RH");

    const R = `E2E-HELD-R-${SUFFIX}`;
    const O = `E2E-HELD-O-${SUFFIX}`;
    const held = await raise(page, g, { receipt: R, invoiceRefId: O });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    const holderId = String(held.body.request.id);

    await fillAllButReferences(page, s);

    // THE RESI — re-cased and padded, it is still the held one: danger under the field, the holder's number and its
    // status, and the line by Buat names it.
    const receiptTaken = page.getByTestId("restock-receipt-check-taken");
    await page.getByTestId("restock-receipt").fill(`  ${R.toLowerCase()} `);
    await expect(receiptTaken).toContainText(`#${holderId}`);
    await expect(receiptTaken.getByTestId("restock-status-1")).toBeVisible();
    await expect(page.getByTestId("restock-form-missing-receiptTaken")).toBeVisible();
    await expect(page.getByTestId("submit-restock")).toBeDisabled();

    // THE ORDER ID, on its own field, the same way.
    const invoiceTaken = page.getByTestId("restock-invoice-ref-check-taken");
    await page.getByTestId("restock-invoice-ref").fill(O.toLowerCase());
    await expect(invoiceTaken).toContainText(`#${holderId}`);
    await expect(page.getByTestId("restock-form-missing-invoiceRefTaken")).toBeVisible();
    await expect(page.getByTestId("submit-restock")).toBeDisabled();

    // Free values: the danger lets go, the form is ready, and it saves.
    const mineR = `E2E-FREE-R-${SUFFIX}`;
    await page.getByTestId("restock-receipt").fill(mineR);
    await page.getByTestId("restock-invoice-ref").fill(`E2E-FREE-O-${SUFFIX}`);
    await expect(receiptTaken).toHaveCount(0);
    await expect(invoiceTaken).toHaveCount(0);
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("submit-restock").click();

    const mineId = await restockIdOf(page, s.skuA);

    // THE EDIT FORM — the restock is not its own duplicate: opened on its own resi, it is ready, no danger.
    await page.goto(`/inventories/restock/${mineId}/edit`);
    await expect(page.getByTestId("restock-receipt")).toHaveValue(mineR);
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await expect(receiptTaken).toHaveCount(0);

    // …and another restock's resi stops Simpan.
    await page.getByTestId("restock-receipt").fill(R);
    await expect(receiptTaken).toContainText(`#${holderId}`);
    await expect(page.getByTestId("submit-restock")).toBeDisabled();

    // A CANCELLED restock holds nothing: once the holder is called off, the same resi is free on the screen, and the
    // server takes the save.
    await api(page, "inventory.v1.RestockRequestService/RestockRequestCancel", {
      teamId: "1",
      requestId: holderId,
      moneyReturned: false,
    });
    // The check is keyed on the value, so the field leaves it and comes back for it to be asked again — a value
    // re-typed with a space is the same value and the same question.
    await page.getByTestId("restock-receipt").fill(mineR);
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("restock-receipt").fill(R);
    await expect(page.getByTestId("restock-form-ready")).toBeHidden();
    // Ready shows only once the check for R has answered free — "checking" and "taken" both keep it hidden.
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await expect(receiptTaken).toHaveCount(0);

    const saved = page.waitForResponse((r) => r.url().includes("RestockRequestService/RestockRequestUpdate"));
    await page.getByTestId("submit-restock").click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(/\/inventories\/restock$/);

    const detail = await api(page, "inventory.v1.RestockRequestService/RestockRequestDetail", {
      teamId: "1",
      requestId: mineId,
    });
    expect(detail.request.receipt).toBe(R);
  });

  test("Restock form: a resi another restock took while the form was open is refused by the server, under its field", async ({
    page,
  }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const s = await seed(page, "RS");
    const g = await restockGround(page, "RT");

    // The form is filled and its check has answered: the resi is free.
    const R = `E2E-LATE-R-${SUFFIX}`;
    await fillAllButReferences(page, s);
    await page.getByTestId("restock-receipt").fill(R);
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await expect(page.getByTestId("submit-restock")).toBeEnabled();

    // …and then the person beside you saves a restock with the same resi.
    const other = await raise(page, g, { receipt: R });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    const otherId = String(other.body.request.id);

    // Buat: the SERVER refuses it (the screen's answer came before the other restock existed), and the refusal is the
    // field's own danger — the holder's number and status — with Buat held back and the form still open.
    const refused = page.waitForResponse((r) => r.url().includes("RestockRequestService/RestockRequestCreate"));
    await page.getByTestId("submit-restock").click();
    const res = await refused;
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("already_exists");

    const receiptTaken = page.getByTestId("restock-receipt-check-taken");
    await expect(receiptTaken).toContainText(`#${otherId}`);
    await expect(receiptTaken.getByTestId("restock-status-1")).toBeVisible();
    await expect(page.getByTestId("restock-form-missing-receiptTaken")).toBeVisible();
    await expect(page.getByTestId("submit-restock")).toBeDisabled();
    await expect(page).toHaveURL(/\/inventories\/restock\/new$/);

    // The refusal sticks to THAT value: another resi lets it go, and the restock saves.
    await page.getByTestId("restock-receipt").fill(`E2E-LATE-R2-${SUFFIX}`);
    await expect(receiptTaken).toHaveCount(0);
    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("submit-restock").click();
    await restockIdOf(page, s.skuA);
  });
});
