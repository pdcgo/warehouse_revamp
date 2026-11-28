import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// warehouse:all wants to take back a found report — the checks behind docs/acceptances/inventory/opname.md, section
// *found*, given 34 (when *cancel own found report*). One test per role the given names — warehouse:owner,
// warehouse:admin, warehouse:staff — each signed in as a person of that role in a WAREHOUSE OF ITS OWN, where that person
// reported 2 units of product X found on rack A themselves, with a note. They take it back as the reporter does: Found
// Stock → *Withdraw* (the owner and the staff from the request's row, the admin from its Rincian — both doors) → the
// confirm *Withdraw Found Stock #N* (*You reported it. Nothing is posted; say why you take it back.*), whose Withdraw
// stays off until a reason is typed → FoundRequestReject (business rules: opname.md §found,
// the-reporter-may-withdraw-their-found — *the reporter, while the request waits — staff, Admin or Owner*, *a reason, as
// every reject*, *rejected, decided by the reporter — shown as withdrawn by*; staff-may-report-a-found;
// an-adjust-found-waits-for-the-owner-or-admin — *on reject: nothing posts*).
//
// So that *no debt changes* is not empty, the ground has something to move: the batch's old lost of 2 on rack A, not
// found yet, so the waiting request would CLAIM it back (*Claimed back Rp 20.000*) and an approve would lower the
// warehouse's debt — the withdrawal must post none of it.
//
//   34 (own found report waiting · reason) — 5 received at Rp 10.000, 2 adjusted LOST on rack A (StockAdjust: 3 left, the
//      warehouse owes the selling team Rp 20.000), then the role's own found of 2 on rack A, waiting; the reason is typed
//      at the withdrawal. Beside them in the warehouse, another warehouse OWNER (the *watcher*): one who could decide it.
//     then: status withdrawn, cancelled by the reporter — the answer REJECTED with the reason, decided by the role's person,
//           who is also its reporter; the role's Found Stock: off Waiting, and on the Rejected tab the row reads
//           *Withdrawn*, decided by them (*Withdrawn by <them> · …*), *Why: <reason>*, no Approve or Withdraw left, its
//           Rincian *Reported by <them>* and *Withdrawn by <them>*; the WATCHER (before: Waiting, Approve on, the menu's
//           count 1) reads it the same — FoundRequestList REJECTED decided by the reporter with the reason, the menu's
//           count gone, the Rejected tab's row *Withdrawn* and its Rincian *Withdrawn by <the reporter>*, never
//           *Rejected by*.
//     then: no stock or debt changes — no transaction in the answer; ready 3 (ProductStockSummary), rack A 3 (RackStock
//           and the rack page), the product page's On hand 3, the one batch still 3 ready at Rp 10.000, no batch minted;
//           the pair still −Rp 20.000 with exactly its entries before. Read by the watcher (warehouse staff read no
//           liability), on its own page.
//
// The ground (root, once): a selling team with an operational account and a category. Per role a warehouse with its
// fee, rack A, product X restocked onto it, the old lost, the role's person, the watcher and the role's own report.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-withdraw-34";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o", door: "row", decides: true },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a", door: "detail", decides: true },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "s", door: "row", decides: false },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

const GIVEN = "warehouse:all wants to take back a found report";
const WHEN = "cancel own found report";
// The given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = "own found report waiting · reason";

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
  watcher: Person;
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
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  ready?: string;
}
async function batchOf(b: Ground, id: string): Promise<Batch> {
  return (await call(b.watcher.token, "inventory.v1.InventoryService/BatchDetail", { teamId: b.warehouse, batchId: id })).batch as Batch;
}

// The product's READY units in this warehouse, as the watcher reads them (ProductStockSummary).
async function readyOf(b: Ground): Promise<number> {
  return num(
    (await call(b.watcher.token, "inventory.v1.InventoryService/ProductStockSummary", { teamId: b.warehouse, productId: b.product.id }))
      .readyQty,
  );
}

// The product's units on rack A, as the watcher reads them (RackStock).
async function onRack(b: Ground): Promise<number> {
  const res = await call(b.watcher.token, "inventory.v1.RackService/RackStock", {
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
// pair's entries — LiabilityLogList under `token` (an owner's: warehouse staff read no liability).
async function warehousePair(token: string, warehouse: string): Promise<{ balance: number; logs: Log[] }> {
  const res = await call(token, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: warehouse,
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
  block?: string;
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
        name: `E2E Withdraw Found ${tag} ${SUFFIX}`,
        teamCode: `QW${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const me = await person(warehouse, `e2eqw${r.key}${SUFFIX}`, `Penarik ${r.given} ${SUFFIX}`, r.role);
  const watcher = await person(warehouse, `e2eqwv${r.key}${SUFFIX}`, `Pengamat Tarik ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_OWNER");

  const code = `qw${tag.toLowerCase()}-a-${SUFFIX}`;
  const rack = { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

  const name = `Kaos X Withdraw ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QW${tag}X${SUFFIX}`,
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
  const batches = await batchIds(watcher.token, warehouse, product.id);
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
    .poll(async () => (await warehousePair(watcher.token, warehouse)).balance, { message: `${r.key}: the lost owed`, timeout: 30_000 })
    .toBeCloseTo(-LOST * UNIT, 3);

  // GIVEN — the role's OWN found report: 2 of X on rack A, waiting, with its note (staff-may-report-a-found).
  const found = String(
    (
      await call(me.token, "inventory.v1.FoundRequestService/FoundRequestCreate", {
        teamId: warehouse,
        productId: product.id,
        rackId: rack.id,
        quantity: FOUND,
        note: `2 ketemu di bawah rak ${tag}${SUFFIX}`,
      })
    ).foundRequest.id,
  );

  return { tag, warehouse, me, watcher, rack, product, batch, found };
}

// Signed in as `who`, in the warehouse: Found Stock on `tab`.
async function foundStock(page: Page, b: Ground, who: Person, tab: "waiting" | "rejected") {
  await signInAs(page, who.user, PASSWORD, b.warehouse);
  await page.goto(tab === "waiting" ? "/inventories/found-stock" : "/inventories/found-stock?status=rejected");
  await expect(page.getByTestId("found-requests-page")).toBeVisible();
}

// The withdrawn request as `page` shows it on the Rejected tab — its row, then its Rincian — decided by its reporter.
async function withdrawnShown(page: Page, b: Ground, reason: string) {
  const row = page.getByTestId(`found-request-${b.found}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("found-request-status-3")).toHaveText("Withdrawn");
  await expect(page.getByTestId(`found-request-reject-reason-${b.found}`)).toHaveText(`Why: ${reason}`);
  const decided = page.getByTestId(`found-request-decided-${b.found}`);
  await expect(decided).toContainText(b.me.name);
  await expect(decided.locator("span[title]").first()).toHaveAttribute("title", new RegExp(`^Withdrawn by ${esc(b.me.name)} · `));
  await expect(page.getByTestId(`found-request-claimed-${b.found}`)).toHaveCount(0);
  await expect(page.getByTestId(`found-request-approve-${b.found}`)).toHaveCount(0);
  await expect(page.getByTestId(`found-request-reject-${b.found}`)).toHaveCount(0);
  await page.getByTestId(`found-request-reported-${b.found}`).click();
  const detail = page.getByTestId("found-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("found-request-status-3")).toHaveText("Withdrawn");
  await expect(detail.getByTestId("found-detail-reported")).toContainText(`Reported by ${b.me.name}`);
  await expect(detail.getByTestId("found-detail-decided")).toContainText(`Withdrawn by ${b.me.name}`);
  await expect(detail.getByTestId("found-detail-decided")).not.toContainText("Rejected by");
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
        name: `E2E Withdraw Found Seller ${SUFFIX}`,
        // not QW + O/A/S — those are the warehouses
        teamCode: `QWT${SUFFIX}`,
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
        name: `E2E withdraw found ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QW-${SUFFIX}`,
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
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Withdraw Found ${SUFFIX}` })).category.id);

  for (const r of ROLES) ground.g[r.key] = await build(r);
});

// ── 34 (own found report waiting · reason) ─────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE})`, async ({ page, browser }) => {
      const b = ground.g[r.key];
      const reason = `salah rak, kardus ini punya gudang sebelah ${b.tag}${SUFFIX}`;

      // GIVEN — 3 left on rack A after the old lost, the warehouse owes Rp 20.000, and the role's own found waits on it.
      expect(await readyOf(b)).toBe(RECEIVED - LOST);
      expect(await onRack(b)).toBe(RECEIVED - LOST);
      const batchBefore = await batchOf(b, b.batch);
      expect([num(batchBefore.ready), num(batchBefore.unitCost)]).toEqual([RECEIVED - LOST, UNIT]);
      const pairBefore = await warehousePair(b.watcher.token, b.warehouse);
      expect(pairBefore.balance).toBeCloseTo(-LOST * UNIT, 3);
      // the role's own — they may not approve it (an-adjust-found-waits-for-the-owner-or-admin), only take it back
      const mine = (await listed(b.me.token, b.warehouse)).get(b.found);
      expect([mine?.status, String(mine?.reportedById), mine?.block]).toEqual([
        "FOUND_REQUEST_STATUS_WAITING",
        b.me.id,
        "FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT",
      ]);
      // what approving WOULD post — the claim this withdrawal must not make — as the watcher reads it
      const theirs = (await listed(b.watcher.token, b.warehouse)).get(b.found);
      expect([theirs?.status, num(theirs?.claimedAmount)]).toEqual(["FOUND_REQUEST_STATUS_WAITING", LOST * UNIT]);

      // The watcher — another owner, who could decide it — sees it waiting, Approve on, the menu's count 1.
      const watcher: Page = await browser.newPage();
      try {
        await foundStock(watcher, b, b.watcher, "waiting");
        const theirRow = watcher.getByTestId(`found-request-${b.found}`);
        await expect(theirRow).toBeVisible();
        await expect(theirRow.getByTestId("found-request-status-1")).toHaveText("Waiting");
        await expect(watcher.getByTestId(`found-request-approve-${b.found}`)).toBeEnabled();
        await expect(watcher.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");

        // The role's Found Stock: their own report, waiting; theirs to take back, not to approve.
        await foundStock(page, b, b.me, "waiting");
        const row = page.getByTestId(`found-request-${b.found}`);
        await expect(row).toBeVisible();
        await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
        await expect(page.getByTestId(`found-request-reported-${b.found}`)).toContainText(b.me.name);
        if (r.decides) {
          await expect(row.getByTestId(`found-request-claimed-${b.found}`)).toHaveText(/^Claimed back Rp\s?20\.000$/);
          await expect(page.getByTestId(`found-request-approve-${b.found}`)).toBeDisabled();
          await expect(page.getByTestId(`found-request-block-${b.found}`)).toHaveText("You reported it — another Owner or Admin approves it.");
        } else {
          await expect(page.getByTestId(`found-request-approve-${b.found}`)).toHaveCount(0);
        }

        // WHEN — Withdraw (the owner and staff from the row, the admin from the Rincian) → the confirm, a reason → Withdraw.
        let withdraw: Locator;
        if (r.door === "row") {
          withdraw = page.getByTestId(`found-request-reject-${b.found}`);
        } else {
          await page.getByTestId(`found-request-reported-${b.found}`).click();
          const detail = page.getByTestId("found-detail");
          await expect(detail).toBeVisible();
          withdraw = detail.getByTestId("found-detail-reject");
          // an admin reporter's Approve is off at the Rincian's foot too
          await expect(detail.getByTestId("found-detail-approve")).toBeDisabled();
        }
        await expect(withdraw).toHaveText("Withdraw");
        await withdraw.click();
        const confirm = page.getByRole("alertdialog", { name: `Withdraw Found Stock #${b.found}` });
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText("You reported it. Nothing is posted; say why you take it back.");
        // a reason is required: the confirm's Withdraw stays off until one is typed
        await expect(confirm.getByTestId("confirm-action")).toBeDisabled();
        await expect(confirm.getByTestId("confirm-action")).toContainText("Withdraw");
        await confirm.getByTestId("found-request-reject-reason").fill(reason);
        await expect(confirm.getByTestId("confirm-action")).toBeEnabled();
        const answer = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestReject"));
        await confirm.getByTestId("confirm-action").click();
        const res = await answer;
        const done = (await res.json().catch(() => ({}))) as { foundRequest?: Found };
        expect(res.ok(), JSON.stringify(done)).toBe(true);
        expect(JSON.parse(res.request().postData() ?? "{}").reason).toBe(reason);

        await test.step("then: status withdrawn, cancelled by the reporter", async () => {
          // the answer: rejected with the reason, decided by the role's person — who reported it (shown as withdrawn)
          expect([
            done.foundRequest?.status,
            String(done.foundRequest?.decidedById),
            String(done.foundRequest?.reportedById),
            done.foundRequest?.rejectReason,
          ]).toEqual(["FOUND_REQUEST_STATUS_REJECTED", b.me.id, b.me.id, reason]);
          // the role's Found Stock: off Waiting; on the Rejected tab, withdrawn by them, with why
          await page.goto("/inventories/found-stock");
          await expect(page.getByTestId("found-requests-page")).toBeVisible();
          await expect(page.getByTestId(`found-request-${b.found}`)).toHaveCount(0);
          await page.getByTestId("found-requests-tab-rejected").click();
          await withdrawnShown(page, b, reason);
          expect((await listed(b.me.token, b.warehouse)).has(b.found)).toBe(false);

          // the watcher reads it the same: withdrawn by its reporter, with the reason — never a rejection of theirs
          const seen = (await listed(b.watcher.token, b.warehouse, "FOUND_REQUEST_STATUS_REJECTED")).get(b.found);
          expect([seen?.status, String(seen?.reportedById), String(seen?.decidedById), seen?.rejectReason]).toEqual([
            "FOUND_REQUEST_STATUS_REJECTED",
            b.me.id,
            b.me.id,
            reason,
          ]);
          expect((await listed(b.watcher.token, b.warehouse)).has(b.found)).toBe(false);
          await watcher.goto("/inventories/found-stock");
          await expect(watcher.getByTestId("found-requests-page")).toBeVisible();
          await expect(watcher.getByTestId(`found-request-${b.found}`)).toHaveCount(0);
          await expect(watcher.getByTestId("nav-count-/inventories/found-stock")).toHaveCount(0);
          await watcher.getByTestId("found-requests-tab-rejected").click();
          await withdrawnShown(watcher, b, reason);
        });

        await test.step("then: no stock or debt changes", async () => {
          // no transaction posted
          expect(done.foundRequest?.transactionId ?? "0").toBe("0");
          // stock: ready and rack A still 3, the one batch still 3 ready at its price, nothing minted
          expect(await readyOf(b)).toBe(RECEIVED - LOST);
          expect(await onRack(b)).toBe(RECEIVED - LOST);
          expect(await batchIds(b.watcher.token, b.warehouse, b.product.id)).toEqual([b.batch]);
          const batchAfter = await batchOf(b, b.batch);
          expect([num(batchAfter.ready), num(batchAfter.unitCost)]).toEqual([RECEIVED - LOST, UNIT]);
          await watcher.goto(`/inventories/racks/${b.rack.id}`);
          await expect(watcher.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText(
            String(RECEIVED - LOST),
          );
          await watcher.goto(`/inventories/products/${b.product.id}`);
          await expect(watcher.getByTestId("warehouse-product-page")).toBeVisible();
          await expect(watcher.getByTestId("warehouse-product-onhand")).toContainText(String(RECEIVED - LOST));
          // debt: the pair still −20.000, its entries exactly those before — the old loss not claimed back
          const pairAfter = await warehousePair(b.watcher.token, b.warehouse);
          expect(pairAfter.balance).toBeCloseTo(pairBefore.balance, 3);
          expect(pairAfter.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
        });
      } finally {
        await watcher.close();
      }
    });
  }
});
