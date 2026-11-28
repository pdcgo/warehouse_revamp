import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// warehouse owner · admin want to decide on a found report — the checks behind docs/acceptances/inventory/opname.md,
// section *found*, given 33 (when *reject found*). One test per role the given names — warehouse:owner,
// warehouse:admin — each signed in as a person of that role in a WAREHOUSE OF ITS OWN, where a warehouse STAFF of the same
// warehouse reported 2 units of product X found on rack A, with a note (staff-may-report-a-found). The role rejects it as
// an owner or admin does: Found Stock → *Reject* (the owner from the request's row, the admin from its Rincian — both
// doors) → the confirm *Reject Found Stock #N* (*Nothing is posted. <reporter>, who reported it, reads your reason.*),
// whose Reject stays off until a reason is typed → FoundRequestReject (business rules: opname.md §found,
// an-adjust-found-waits-for-the-owner-or-admin — *on reject: nothing posts*; the-reporter-may-withdraw-their-found —
// *a reason, as every reject*; found-stock-sits-after-stock-opname-with-its-count — staff see the reports they made).
//
// So that *no debt changes* is not empty, the ground has something to move: the batch's old lost of 2 on rack A, not
// found yet, so the waiting request would CLAIM it back (its row reads *Claimed back Rp 20.000*) and approving would
// lower the warehouse's debt — the rejection must post none of it.
//
//   33 (found report waiting · reason) — 5 received at Rp 10.000, 2 adjusted LOST on rack A (StockAdjust: 3 left, the
//      warehouse owes the selling team Rp 20.000), then the staff's found of 2 on rack A, waiting; the reason is the
//      role's, typed at the reject.
//     then: status rejected, the reason shown to the reporter — the answer REJECTED, decided by the role's person, with
//           the reason; the role's Found Stock: off Waiting and off the menu's count, the Rejected tab's row *Rejected*,
//           decided by them, *Why: <reason>*, no Approve or Reject left; the REPORTER (the staff, signed in on a page of
//           their own): FoundRequestList REJECTED carries the reason and the decider, and on their Found Stock the
//           Rejected tab's row reads *Rejected* (not *Withdrawn* — they did not take it back), *Why: <reason>*, its
//           Rincian *Rejected by <the role's person>* and *Why: <reason>*.
//     then: no stock or debt changes — ready 3 (ProductStockSummary), rack A 3 (RackStock and the rack page), the
//           product page's On hand 3, the one batch still 3 ready at Rp 10.000, no batch minted; the pair still −20.000
//           with exactly its entries before; no transaction in the answer.
//
// The ground (root, once): a selling team with an operational account and a category. Per role a warehouse with its
// fee, rack A, product X restocked onto it, the old lost, the role's person, the staff reporter and the report.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-reject-33";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o", door: "row" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a", door: "detail" },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

// The given names two roles: the describe carries neither token (acceptance_mark.py reads the role off the whole
// title), each test carries its own.
const GIVEN = "warehouse owner · admin wants to decide on a found report";
const WHEN = "reject found";
// The given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = "found report waiting · reason";

const RECEIVED = 5;
const UNIT = 10_000;
const LOST = 2;
const FOUND = 2;

interface Person {
  id: string;
  user: string;
  name: string;
  token: string;
}
interface Ground {
  tag: string;
  warehouse: string;
  me: Person;
  staff: Person;
  rack: { id: string; code: string };
  product: { id: string; code: string; name: string };
  batch: string;
  found: string;
}

const ground = {
  seller: "",
  account: "",
  category: "",
  g: {} as Record<Key, Ground>,
};

const num = (v: unknown) => Number(v ?? 0);

async function batchIds(token: string, warehouse: string, productId: string): Promise<string[]> {
  const res = await call(token, "inventory.v1.InventoryService/BatchList", {
    teamId: warehouse,
    filter: { productId },
    page: { page: 1, limit: 20 },
  });

  return ((res.ids ?? []) as unknown[]).map(String).sort((a, b) => Number(a) - Number(b));
}

interface Batch {
  id: string;
  unitCost?: number;
  arrived?: string;
  ready?: string;
}
async function batchOf(b: Ground, id: string): Promise<Batch> {
  return (await call(b.me.token, "inventory.v1.InventoryService/BatchDetail", { teamId: b.warehouse, batchId: id })).batch as Batch;
}

// The product's READY units in this warehouse, as the role reads them (ProductStockSummary).
async function readyOf(b: Ground): Promise<number> {
  return num(
    (await call(b.me.token, "inventory.v1.InventoryService/ProductStockSummary", { teamId: b.warehouse, productId: b.product.id }))
      .readyQty,
  );
}

// The product's units on rack A, as the role reads them (RackStock).
async function onRack(b: Ground): Promise<number> {
  const res = await call(b.me.token, "inventory.v1.RackService/RackStock", {
    teamId: b.warehouse,
    filter: { rackId: b.rack.id },
    page: { page: 1, limit: 20 },
  });
  for (const it of res.items ?? []) {
    for (const l of Object.values(it.rackStock?.mapData ?? {}) as { productId: string; onHand?: string }[]) {
      if (String(l.productId) === b.product.id) return num(l.onHand);
    }
  }

  return 0;
}

interface Log {
  id: string;
  amount?: number;
  sourceType?: string;
}
// What the warehouse and the selling team owe each other, from the warehouse's side (a payable is negative), and the
// pair's entries — LiabilityLogList as the role.
async function warehousePair(b: Ground): Promise<{ balance: number; logs: Log[] }> {
  const res = await call(b.me.token, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: b.warehouse,
    filter: { counterpartyId: ground.seller },
    dataRequest: ["LIABILITY_LOG_LIST_DATA_TYPE_LOG"],
    page: { page: 1, limit: 50 },
  });
  const byId: Record<string, Log> = Object.assign({}, ...(res.items ?? []).map((it: { log?: { mapData?: object } }) => it.log?.mapData ?? {}));

  return { balance: num(res.balance), logs: ((res.ids ?? []) as unknown[]).map((id) => byId[String(id)]!).filter(Boolean) };
}

interface Found {
  id: string;
  status?: string;
  decidedById?: string;
  reportedById?: string;
  rejectReason?: string;
  transactionId?: string;
  claimedAmount?: number;
}
// The warehouse's found requests in `status` under `token` (FoundRequestList).
async function listed(token: string, warehouse: string, status = "FOUND_REQUEST_STATUS_WAITING"): Promise<Map<string, Found>> {
  const res = await call(token, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: warehouse,
    filter: { status },
    page: { page: 1, limit: 20 },
  });
  const byId = new Map<string, Found>();
  for (const it of res.items ?? []) {
    for (const r of Object.values(it.request?.mapData ?? {}) as Found[]) byId.set(String(r.id), r);
  }

  return byId;
}

async function person(warehouse: string, user: string, name: string, role: string): Promise<Person> {
  const created = await asRoot("user.v1.UserService/CreateUser", { teamId: warehouse, username: user, password: PASSWORD, name, role });

  return { id: String(created.user.id), user, name, token: await login(user, PASSWORD) };
}

async function build(r: Role): Promise<Ground> {
  const tag = r.key.toUpperCase();
  const warehouse = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Reject Found ${tag} ${SUFFIX}`,
        teamCode: `QR${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const me = await person(warehouse, `e2eqr${r.key}${SUFFIX}`, `Penolak ${r.given} ${SUFFIX}`, r.role);
  const staff = await person(warehouse, `e2eqrs${r.key}${SUFFIX}`, `Pelapor Tolak ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF");

  const code = `qr${tag.toLowerCase()}-a-${SUFFIX}`;
  const rack = { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

  const name = `Kaos X Reject ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QR${tag}X${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const product = { id: String(p.id), code: String(p.productCode), name };

  // GIVEN — 5 of X by the selling team's restock, all onto rack A.
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: warehouse,
    financeAccountId: ground.account,
    items: [{ productId: product.id, productCode: product.code, name, count: RECEIVED, total: RECEIVED * UNIT }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: RECEIVED, placements: [{ placementId: rack.id, quantity: RECEIVED }] }],
  });
  const batches = await batchIds(me.token, warehouse, product.id);
  expect(batches, `${r.key}: one batch`).toHaveLength(1);
  const batch = batches[0]!;

  // GROUND — an old lost of 2 on rack A, not found yet (the warehouse owes Rp 20.000): what an approve would claim back.
  await asRoot("inventory.v1.InventoryService/StockAdjust", {
    warehouseId: warehouse,
    productId: product.id,
    reasonType: "STOCK_ADJUST_REASON_LOST",
    batchId: batch,
    quantity: LOST,
    rackId: rack.id,
    reason: `hilang dari rak ${SUFFIX}`,
  });
  await expect
    .poll(async () => (await warehousePair({ me, warehouse } as Ground)).balance, { message: `${r.key}: the lost owed`, timeout: 30_000 })
    .toBeCloseTo(-LOST * UNIT, 3);

  // GIVEN — the found report: 2 of X on rack A, waiting, the staff's (staff-may-report-a-found), with its note.
  const found = String(
    (
      await call(staff.token, "inventory.v1.FoundRequestService/FoundRequestCreate", {
        teamId: warehouse,
        productId: product.id,
        rackId: rack.id,
        quantity: FOUND,
        note: `2 ketemu di balik kardus ${tag}${SUFFIX}`,
      })
    ).foundRequest.id,
  );

  return { tag, warehouse, me, staff, rack, product, batch, found };
}

// Signed in as `who`, in the warehouse: Found Stock on `tab`.
async function foundStock(page: Page, b: Ground, who: Person, tab: "waiting" | "rejected") {
  await signInAs(page, who.user, PASSWORD, b.warehouse);
  await page.goto(tab === "waiting" ? "/inventories/found-stock" : "/inventories/found-stock?status=rejected");
  await expect(page.getByTestId("found-requests-page")).toBeVisible();
}

// The rejected request as `page` shows it on the Rejected tab — its row, then its Rincian — decided by the role's person.
async function rejectedShown(page: Page, b: Ground, reason: string) {
  const row = page.getByTestId(`found-request-${b.found}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("found-request-status-3")).toHaveText("Rejected");
  await expect(page.getByTestId(`found-request-reject-reason-${b.found}`)).toHaveText(`Why: ${reason}`);
  await expect(page.getByTestId(`found-request-decided-${b.found}`)).toContainText(b.me.name);
  await expect(page.getByTestId(`found-request-claimed-${b.found}`)).toHaveCount(0);
  await expect(page.getByTestId(`found-request-approve-${b.found}`)).toHaveCount(0);
  await expect(page.getByTestId(`found-request-reject-${b.found}`)).toHaveCount(0);
  await page.getByTestId(`found-request-reported-${b.found}`).click();
  const detail = page.getByTestId("found-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("found-request-status-3")).toHaveText("Rejected");
  await expect(detail.getByTestId("found-detail-reported")).toContainText(`Reported by ${b.staff.name}`);
  await expect(detail.getByTestId("found-detail-decided")).toContainText(`Rejected by ${b.me.name}`);
  await expect(detail.getByTestId("found-detail-reject-reason")).toHaveText(`Why: ${reason}`);
  await expect(detail.getByTestId("found-detail-approve")).toHaveCount(0);
  await expect(detail.getByTestId("found-detail-reject")).toHaveCount(0);
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  ground.seller = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Reject Found Seller ${SUFFIX}`,
        // not QR + O/A — those are the warehouses
        teamCode: `QRT${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E reject found ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QR-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id,
  );
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.account,
    operational: true,
  });
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Reject Found ${SUFFIX}` })).category.id);

  for (const r of ROLES) ground.g[r.key] = await build(r);
});

// ── 33 (found report waiting · reason) ─────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE})`, async ({ page, browser }) => {
      const b = ground.g[r.key];
      const reason = `bukan barang rak ini, kardus gudang sebelah ${b.tag}${SUFFIX}`;

      // GIVEN — 3 left on rack A after the old lost, the warehouse owes Rp 20.000, and the staff's found waits on it.
      expect(await readyOf(b)).toBe(RECEIVED - LOST);
      expect(await onRack(b)).toBe(RECEIVED - LOST);
      const batchBefore = await batchOf(b, b.batch);
      expect([num(batchBefore.ready), num(batchBefore.unitCost)]).toEqual([RECEIVED - LOST, UNIT]);
      const pairBefore = await warehousePair(b);
      expect(pairBefore.balance).toBeCloseTo(-LOST * UNIT, 3);
      const waiting = (await listed(b.me.token, b.warehouse)).get(b.found);
      expect([waiting?.status, String(waiting?.reportedById), num(waiting?.claimedAmount)]).toEqual([
        "FOUND_REQUEST_STATUS_WAITING",
        b.staff.id,
        LOST * UNIT,
      ]);

      await foundStock(page, b, b.me, "waiting");
      const row = page.getByTestId(`found-request-${b.found}`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
      await expect(page.getByTestId(`found-request-reported-${b.found}`)).toContainText(b.staff.name);
      // what approving WOULD post — the claim this rejection must not make
      await expect(row.getByTestId(`found-request-claimed-${b.found}`)).toHaveText(/^Claimed back Rp\s?20\.000$/);
      await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");

      // WHEN — Reject (the owner from the row, the admin from the Rincian) → the confirm, a reason → Reject.
      let reject: Locator;
      if (r.door === "row") {
        reject = page.getByTestId(`found-request-reject-${b.found}`);
      } else {
        await page.getByTestId(`found-request-reported-${b.found}`).click();
        const detail = page.getByTestId("found-detail");
        await expect(detail).toBeVisible();
        reject = detail.getByTestId("found-detail-reject");
      }
      await expect(reject).toHaveText("Reject");
      await reject.click();
      const confirm = page.getByRole("alertdialog", { name: `Reject Found Stock #${b.found}` });
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText(`Nothing is posted. ${b.staff.name}, who reported it, reads your reason.`);
      // a reason is required: the confirm's Reject stays off until one is typed
      await expect(confirm.getByTestId("confirm-action")).toBeDisabled();
      await confirm.getByTestId("found-request-reject-reason").fill(reason);
      await expect(confirm.getByTestId("confirm-action")).toBeEnabled();
      const answer = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestReject"));
      await confirm.getByTestId("confirm-action").click();
      const res = await answer;
      const done = (await res.json().catch(() => ({}))) as { foundRequest?: Found };
      expect(res.ok(), JSON.stringify(done)).toBe(true);
      expect(JSON.parse(res.request().postData() ?? "{}").reason).toBe(reason);

      await test.step("then: status rejected, the reason shown to the reporter", async () => {
        // the answer: rejected, by the role's person, with the reason
        expect([done.foundRequest?.status, String(done.foundRequest?.decidedById), done.foundRequest?.rejectReason]).toEqual([
          "FOUND_REQUEST_STATUS_REJECTED",
          b.me.id,
          reason,
        ]);
        // the role's Found Stock: off Waiting and off the menu's count; on the Rejected tab, decided by them, with why
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        await expect(page.getByTestId(`found-request-${b.found}`)).toHaveCount(0);
        await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveCount(0);
        await page.getByTestId("found-requests-tab-rejected").click();
        await rejectedShown(page, b, reason);

        // the REPORTER — the staff who reported it — reads it rejected, by whom, and why
        const seen = (await listed(b.staff.token, b.warehouse, "FOUND_REQUEST_STATUS_REJECTED")).get(b.found);
        expect([seen?.status, String(seen?.reportedById), String(seen?.decidedById), seen?.rejectReason]).toEqual([
          "FOUND_REQUEST_STATUS_REJECTED",
          b.staff.id,
          b.me.id,
          reason,
        ]);
        expect((await listed(b.staff.token, b.warehouse)).has(b.found)).toBe(false);
        const reporter: Page = await browser.newPage();
        try {
          await foundStock(reporter, b, b.staff, "rejected");
          await rejectedShown(reporter, b, reason);
          // rejected by someone else — not their withdrawal
          await expect(reporter.getByTestId("found-detail")).not.toContainText("Withdrawn");
        } finally {
          await reporter.close();
        }
      });

      await test.step("then: no stock or debt changes", async () => {
        // no transaction posted
        expect(done.foundRequest?.transactionId ?? "0").toBe("0");
        // stock: ready and rack A still 3, the one batch still 3 ready at its price, nothing minted
        expect(await readyOf(b)).toBe(RECEIVED - LOST);
        expect(await onRack(b)).toBe(RECEIVED - LOST);
        expect(await batchIds(b.me.token, b.warehouse, b.product.id)).toEqual([b.batch]);
        const batchAfter = await batchOf(b, b.batch);
        expect([num(batchAfter.ready), num(batchAfter.unitCost)]).toEqual([RECEIVED - LOST, UNIT]);
        await page.goto(`/inventories/racks/${b.rack.id}`);
        await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText(String(RECEIVED - LOST));
        await page.goto(`/inventories/products/${b.product.id}`);
        await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
        await expect(page.getByTestId("warehouse-product-onhand")).toContainText(String(RECEIVED - LOST));
        // debt: the pair still −20.000, its entries exactly those before — the old loss not claimed back
        const pairAfter = await warehousePair(b);
        expect(pairAfter.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(pairAfter.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
      });
    });
  }
});
