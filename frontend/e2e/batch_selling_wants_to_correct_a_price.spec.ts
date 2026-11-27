import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// selling owner/admin wants to correct a batch's price — the checks behind docs/acceptances/inventory/batch.md, section
// *correct price*, when *correct batch price* (givens 13–16). One test per role a given names, each signed in as a
// person of that role. The owning team reaches its batches on its product's page (/products/:id › Batch, a row's
// *Correct Price*); the warehouse holding them reaches the batch's own page (/inventories/batches/:id).
// Rules: the-owning-team-revalues-with-a-reason, the-correct-price-prototype-is-accepted, a-corrected-price-is-above-zero
// (docs/business/inventory/context_decision.md); batch.md §Change Price Flow (value change = delta × units left).
//
//  13 (7 ready at Rp 10.000 · new price Rp 11.000 · reason) — selling owner · admin, each on a batch of its own
//     then: unit cost Rp 11.000 — the batch row, the page's BatchRevalue answer and OwnerBatchList (the role's token)
//     then: ready value up by Rp 7.000 — the row's value and the section's total Rp 70.000 → Rp 77.000, the form's
//           effect and confirm (+Rp 7.000 for the 7 left), the answer's value change
//     then: correction in the batch's history with its reason — the product page's Stock history row naming the batch
//           (#id), from → to, the reason and who; and the warehouse's own batch page (its owner) reads the same in Riwayat
//  14 (… · no reason) — the form will not save without a reason (spaces are none), and the server refuses the same
//     call sent anyway (invalid_argument); then: cannot correct — the price stays Rp 10.000, no correction in history
//  15 (batch with nothing left) — the batch's 7 shipped on an order; the form says there is nothing to correct and will
//     not save, the server refuses (failed_precondition); then: cannot correct — the price stays Rp 10.000
//  16 (7 ready at Rp 10.000) — selling cs · warehouse owner · admin · staff: no Correct Price on the screen they reach
//     (the product page for cs, the batch page for the warehouse), and BatchRevalue under their token is
//     permission_denied; then: cannot correct price — the price stays Rp 10.000
//
// The ground (root, once): a selling team S with an operational account, a shop and its return warehouse W; a person of
// every selling and warehouse role; one restock of seven products × 7 at Rp 70.000 (Rp 10.000 each) accepted onto a
// rack of W — one batch per (given, role), so no correction can be read as another's.

const PASSWORD = "e2e-batch-price-pass-1";
const OWNERS = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
] as const;
const REFUSED = [
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs", side: "selling" },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
] as const;

// Each given's case text, verbatim from batch.md — the marking script finds the tests by it.
const C13 = "7 ready at Rp 10.000 · new price Rp 11.000 · reason";
const C14 = "7 ready at Rp 10.000 · new price Rp 11.000 · no reason";
const C15 = "batch with nothing left";
const C16 = "7 ready at Rp 10.000";

const REASON = "Nota pemasok Rp 11.000 — salah ketik saat diterima";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2ebprc${key}${SUFFIX}`;
const personName = (given: string) => `Batch Harga ${given} ${SUFFIX}`;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// (given, role key) → its product and batch; "16" is the one batch the refused roles share.
const ground = {
  seller: "",
  w: "",
  product: {} as Record<string, string>,
  batch: {} as Record<string, string>,
};
const slot = (g: string, key = "") => (key ? `${g}${key}` : g);

type Answer = { status: number; json: Record<string, unknown> };

// A call that may be refused — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<Answer> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// Signed in as `user`, working in `teamId`: the active team is per tab, in sessionStorage (TeamContext).
async function asUser(page: Page, user: string, teamId: string) {
  await login(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A person on a page of their own (a fresh context: the form sign-in), working in `teamId`.
async function pageAs(browser: Browser, user: string, teamId: string): Promise<Page> {
  const p = await browser.newPage();
  await asUser(p, user, teamId);
  return p;
}

type Row = { unitCost?: number; readyValue?: number; ready?: string };

// The owning team's batch as the signed-in person reads it — OwnerBatchList, as the product page reads it.
async function ownerBatch(page: Page, g: string, key = ""): Promise<Row> {
  const res = await send(page, "inventory.v1.InventoryService/OwnerBatchList", {
    teamId: ground.seller,
    filter: { productId: ground.product[slot(g, key)] },
    dataRequest: ["OWNER_BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 10 },
  });
  expect(res.status, `OwnerBatchList: ${JSON.stringify(res.json)}`).toBe(200);
  const rows = Object.assign(
    {},
    ...((res.json.items ?? []) as { batch?: { mapData?: Record<string, Row> } }[]).map((i) => i.batch?.mapData ?? {}),
  ) as Record<string, Row>;
  return rows[ground.batch[slot(g, key)]!] ?? {};
}

// BatchRevalue under the signed-in person's token: from Rp 10.000 to Rp 11.000, with `reason`, scoped to `teamId`.
const revalue = (page: Page, batchId: string, reason: string, teamId = ground.seller) =>
  send(page, "inventory.v1.InventoryService/BatchRevalue", {
    teamId,
    batchId,
    expectedPriceUnit: 10000,
    newPriceUnit: 11000,
    reason,
  });

// WHEN — correct batch price, on the owning team's door: the product's page, its Batch row's Correct Price. Returns the
// row and the form.
async function openForm(page: Page, g: string, key: string): Promise<{ row: Locator; form: Locator }> {
  const batch = ground.batch[slot(g, key)]!;
  await page.goto(`/products/${ground.product[slot(g, key)]}`);
  const row = page.getByTestId(`pd-batch-row-${batch}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Rp 10.000");
  await page.getByTestId(`pd-batch-correct-${batch}`).click();
  const form = page.getByTestId("correct-price-dialog");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("correct-price-current")).toHaveText("Rp 10.000");
  return { row, form };
}

// The product page's Stock history panel, opened, with its rows drawn.
async function historyPanel(page: Page): Promise<Locator> {
  await page.getByTestId("pd-tab-history").click();
  const panel = page.getByTestId("pd-panel-history");
  await expect(panel.locator('tr[data-testid^="pd-history-row-"]').first()).toBeVisible();
  return panel;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(`E2E Batch Harga Seller ${SUFFIX}`, `BPS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.w = await team(`E2E Batch Harga Gudang ${SUFFIX}`, `BPW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  // Every role's person: owner, admin and cs in S; owner, admin and staff in W.
  for (const r of [...OWNERS, ...REFUSED]) {
    const teamId = r.role.startsWith("ROLE_WAREHOUSE") ? ground.w : ground.seller;
    await api(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: username(r.key),
      password: PASSWORD,
      name: personName(r.given),
      role: r.role,
    });
  }

  // The goods' owner pays from an operational account; W ships its orders and takes its returns back.
  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Batch Harga ${SUFFIX}` })).category.id;
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E batch harga restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-BPRC-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: account,
    operational: true,
  });
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: ground.seller, warehouseId: ground.w });
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.w, feePercent: 1, minFee: 0 });
  const shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Batch Harga Shop ${SUFFIX}`,
        shopCode: `BPP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: ROOT_USER_ID });
  const rack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.w, code: `bpr-${SUFFIX}` })).rack.id);

  // One product per (given, role): 13/14/15 × owner/admin, and 16 for the refused roles.
  const slots = ["13own", "13adm", "14own", "14adm", "15own", "15adm", "16"];
  const products: Record<string, { id: string; code: string; name: string }> = {};
  for (const s of slots) {
    const name = `Barang Batch Harga ${s} ${SUFFIX}`;
    const p = (
      await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: ground.seller,
        productCodePart: `BP${s}${SUFFIX}`,
        name,
        categoryId: category,
      })
    ).product;
    products[s] = { id: String(p.id), code: String(p.productCode), name };
    ground.product[s] = String(p.id);
  }

  // One restock: 7 of each at Rp 70.000 — Rp 10.000 a unit — all accepted onto the rack.
  const raised = (
    await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.w,
      financeAccountId: account,
      items: slots.map((s) => ({ productId: products[s]!.id, productCode: products[s]!.code, name: products[s]!.name, count: 7, total: 70000 })),
    })
  ).request;
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.w,
    requestId: raised.id,
    lines: (raised.items as { id: string }[]).map((it) => ({ itemId: it.id, receivedCount: 7, placements: [{ placementId: rack, quantity: 7 }] })),
  });

  for (const s of slots) {
    const listed = await api(page, "inventory.v1.InventoryService/BatchList", {
      teamId: ground.w,
      filter: { productId: products[s]!.id },
      dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
      page: { page: 1, limit: 10 },
    });
    expect(listed.ids, `one batch of ${s}'s product`).toHaveLength(1);
    ground.batch[s] = String(listed.ids[0]);
  }

  // Given 15: each role's batch leaves whole — an order of all 7, walked to the courier by W.
  const move = async (teamId: string, orderId: string, to: string) => {
    const res = await api(page, "selling.v1.OrderService/OrderStatusChange", { teamId, orderIds: [orderId], to: `ORDER_STATUS_${to}` });
    expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
  };
  for (const s of ["15own", "15adm"]) {
    const p = products[s]!;
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-batch-price-${s}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.seller,
      shopId: shop,
      warehouseId: ground.w,
      customerName: `E2E Batch Harga Buyer ${s} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `BP${SUFFIX}O${s}`,
      receiptCode: `JBP${SUFFIX}R${s}`,
      items: [{ productId: p.id, productCode: p.code, name: p.name, quantity: 7 }],
    });
    for (const st of ["PROCESSED", "PICKED", "SHIPPING"]) await move(ground.w, String(placed.order.id), st);
  }

  await page.close();
});

test.describe(`selling owner · admin wants to correct a batch's price (${C13})`, () => {
  for (const r of OWNERS) {
    test(`${r.given} correct batch price (${C13})`, async ({ page, browser }) => {
      await asUser(page, username(r.key), ground.seller);
      const batch = ground.batch[slot("13", r.key)]!;
      const { row, form } = await openForm(page, "13", r.key);
      const total = page.getByTestId("pd-batch-total");
      await expect(row).toContainText("Rp 70.000");
      await expect(total).toContainText("Rp 70.000");

      await form.getByTestId("correct-price-new").pressSequentially("11000");
      await form.getByTestId("correct-price-reason").fill(REASON);
      await expect(form.getByTestId("correct-price-effect-delta")).toHaveText("+Rp 7.000");
      await page.getByTestId("correct-price-save").click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Rp 10.000 → Rp 11.000 for the 7 pcs left");
      await expect(confirm).toContainText("+Rp 7.000");
      const answered: Promise<Response> = page.waitForResponse((res) =>
        res.url().endsWith("/warehouse.inventory.v1.InventoryService/BatchRevalue"),
      );
      await confirm.getByTestId("confirm-action").click();
      const res = await answered;
      expect(res.status(), "BatchRevalue").toBe(200);
      const answer = (await res.json()) as { priceUnitBefore?: number; priceUnitAfter?: number; valueChange?: number; units?: string };
      await expect(form).toBeHidden();

      await test.step("then: unit cost Rp 11.000", async () => {
        await expect.soft(row).toContainText("Rp 11.000");
        expect.soft(answer.priceUnitBefore).toBe(10000);
        expect.soft(answer.priceUnitAfter).toBe(11000);
        expect.soft((await ownerBatch(page, "13", r.key)).unitCost).toBe(11000);
      });

      await test.step("then: ready value up by Rp 7.000", async () => {
        await expect.soft(row).toContainText("Rp 77.000");
        await expect.soft(total).toContainText("Rp 77.000");
        expect.soft(answer.valueChange).toBe(7000);
        expect.soft(String(answer.units ?? "0")).toBe("7");
        const b = await ownerBatch(page, "13", r.key);
        expect.soft(b.readyValue).toBe(77000);
        expect.soft(String(b.ready ?? "0")).toBe("7");
      });

      await test.step("then: correction in the batch's history with its reason", async () => {
        // The owning team's Stock history: the correction's row names the batch, from → to, the value, why and who.
        const panel = await historyPanel(page);
        const corrected = panel.locator('tr[data-testid^="pd-history-row-"]').filter({ has: page.locator('[data-testid$="-price"]') });
        await expect.soft(corrected).toHaveCount(1);
        await expect.soft(corrected).toContainText("Price corrected");
        await expect.soft(corrected).toContainText(`#${batch}`);
        await expect.soft(corrected.locator('[data-testid$="-price"]')).toHaveText("Rp 10.000 → Rp 11.000");
        await expect.soft(corrected.locator('[data-testid$="-value"]')).toHaveText("+Rp 7.000");
        await expect.soft(corrected.locator('[data-testid$="-reason"]')).toContainText(REASON);
        await expect.soft(corrected.locator('[data-testid$="-actor"]')).toContainText(personName(r.given));

        // The warehouse holding the batch reads it in the batch's own Riwayat (its owner, on a page of their own).
        const wh = await pageAs(browser, username("wown"), ground.w);
        await wh.goto(`/inventories/batches/${batch}`);
        await expect(wh.getByTestId("batch-detail-page")).toBeVisible();
        await expect.soft(wh.getByTestId("batch-detail-unit-cost")).toHaveText("Rp 11.000");
        await expect.soft(wh.getByTestId("batch-detail-unit-cost-corrected")).toHaveText("corrected from Rp 10.000");
        const history = wh.getByTestId("batch-history-panel");
        await expect.soft(history.locator('[data-testid$="-price"]')).toHaveText(["Rp 10.000 → Rp 11.000"]);
        await expect.soft(history.locator('[data-testid$="-reason"]').first()).toContainText(REASON);
        await expect.soft(history.locator('[data-testid$="-actor"]').first()).toContainText(personName(r.given));
        await wh.close();
      });
    });
  }
});

test.describe(`selling owner · admin wants to correct a batch's price (${C14})`, () => {
  for (const r of OWNERS) {
    test(`${r.given} correct batch price (${C14})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.seller);
      const batch = ground.batch[slot("14", r.key)]!;
      const { form } = await openForm(page, "14", r.key);

      await test.step("then: cannot correct", async () => {
        // The form: a new price and no reason — Save stays off; touched, the reason says why; spaces are no reason.
        await form.getByTestId("correct-price-new").pressSequentially("11000");
        await expect.soft(form.getByTestId("correct-price-effect-delta")).toHaveText("+Rp 7.000");
        const save = page.getByTestId("correct-price-save");
        await expect.soft(save).toBeDisabled();
        const reason = form.getByTestId("correct-price-reason");
        await reason.focus();
        await reason.blur();
        await expect.soft(form.getByTestId("correct-price-reason-error")).toContainText("Say why");
        await reason.fill("   ");
        await expect.soft(save).toBeDisabled();
        await page.getByTestId("correct-price-cancel").click();
        await expect(form).toBeHidden();

        // The same call sent anyway, under the role's token: refused, empty and spaces alike.
        for (const why of ["", "   "]) {
          const refused = await revalue(page, batch, why);
          expect.soft(refused.status, `reason ${JSON.stringify(why)}: ${JSON.stringify(refused.json)}`).not.toBe(200);
          expect.soft(refused.json.code, `reason ${JSON.stringify(why)}`).toBe("invalid_argument");
        }

        // Nothing changed: Rp 10.000 and Rp 70.000 on the row after a reload, the same read, no correction in history.
        await page.reload();
        const row = page.getByTestId(`pd-batch-row-${batch}`);
        await expect.soft(row).toContainText("Rp 10.000");
        await expect.soft(row).toContainText("Rp 70.000");
        const b = await ownerBatch(page, "14", r.key);
        expect.soft(b.unitCost).toBe(10000);
        expect.soft(b.readyValue).toBe(70000);
        const panel = await historyPanel(page);
        await expect.soft(panel.locator('[data-testid$="-price"]')).toHaveCount(0);
      });
    });
  }
});

test.describe(`selling owner · admin wants to correct a batch's price (${C15})`, () => {
  for (const r of OWNERS) {
    test(`${r.given} correct batch price (${C15})`, async ({ page }) => {
      await asUser(page, username(r.key), ground.seller);
      const batch = ground.batch[slot("15", r.key)]!;
      // The given: the batch's 7 all left on an order — nothing ready.
      expect(String((await ownerBatch(page, "15", r.key)).ready ?? "0"), "the batch has nothing left").toBe("0");
      const { form } = await openForm(page, "15", r.key);

      await test.step("then: cannot correct", async () => {
        // The form says there is nothing to correct and will not save.
        await expect.soft(form.getByTestId("correct-price-no-units")).toContainText("no units left");
        await expect.soft(page.getByTestId("correct-price-save")).toBeDisabled();
        await page.getByTestId("correct-price-cancel").click();
        await expect(form).toBeHidden();

        // The same call sent anyway, with a reason, under the role's token: refused.
        const refused = await revalue(page, batch, REASON);
        expect.soft(refused.status, JSON.stringify(refused.json)).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");

        // Nothing changed: still Rp 10.000, no correction in history.
        await page.reload();
        await expect.soft(page.getByTestId(`pd-batch-row-${batch}`)).toContainText("Rp 10.000");
        expect.soft((await ownerBatch(page, "15", r.key)).unitCost).toBe(10000);
        const panel = await historyPanel(page);
        await expect.soft(panel.locator('[data-testid$="-price"]')).toHaveCount(0);
      });
    });
  }
});

test.describe(`selling cs · warehouse all wants to correct a batch's price (${C16})`, () => {
  for (const r of REFUSED) {
    test(`${r.given} correct batch price (${C16})`, async ({ page }) => {
      const batch = ground.batch["16"]!;
      const own = r.side === "selling" ? ground.seller : ground.w;
      await asUser(page, username(r.key), own);

      await test.step("then: cannot correct price", async () => {
        if (r.side === "selling") {
          // A cs reads the product's batch rows, with no Correct Price on them.
          await page.goto(`/products/${ground.product["16"]}`);
          const row = page.getByTestId(`pd-batch-row-${batch}`);
          await expect(row).toBeVisible();
          await expect.soft(row).toContainText("Rp 10.000");
          await expect.soft(page.getByTestId(`pd-batch-correct-${batch}`)).toHaveCount(0);
          await expect.soft(page.getByTestId("pd-batch-table").getByRole("button", { name: "Correct Price" })).toHaveCount(0);
        } else {
          // The warehouse's door is the batch's own page: the price, and no Correct Price.
          await page.goto(`/inventories/batches/${batch}`);
          await expect(page.getByTestId("batch-detail-page")).toBeVisible();
          await expect.soft(page.getByTestId("batch-detail-unit-cost")).toHaveText("Rp 10.000");
          await expect.soft(page.locator('[data-testid^="batch-detail-correct-price"]')).toHaveCount(0);
          await expect.soft(page.getByRole("button", { name: "Correct Price" })).toHaveCount(0);
        }

        // BatchRevalue under the role's token: permission_denied — on the owning team, and (warehouse) on its own.
        const scopes = r.side === "selling" ? [ground.seller] : [ground.seller, ground.w];
        for (const teamId of scopes) {
          const refused = await revalue(page, batch, REASON, teamId);
          expect.soft(refused.status, `team ${teamId}: ${JSON.stringify(refused.json)}`).not.toBe(200);
          expect.soft(refused.json.code, `team ${teamId}`).toBe("permission_denied");
        }

        // Nothing changed: still Rp 10.000, read as the role reads it.
        if (r.side === "selling") {
          expect.soft((await ownerBatch(page, "16")).unitCost).toBe(10000);
        } else {
          const d = await send(page, "inventory.v1.InventoryService/BatchDetail", { teamId: ground.w, batchId: batch });
          expect.soft(d.status, `BatchDetail: ${JSON.stringify(d.json)}`).toBe(200);
          expect.soft((d.json.batch as { unitCost?: number } | undefined)?.unitCost).toBe(10000);
        }
      });
    });
  }
});
