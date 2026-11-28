import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// warehouse owner · admin want to decide on a found report — the checks behind docs/acceptances/inventory/opname.md,
// section *found*, givens 29–32 (when *approve found*). One test per role the givens name — warehouse:owner,
// warehouse:admin — each signed in as a person of that role in a WAREHOUSE OF ITS OWN, where a warehouse STAFF of the same
// warehouse reported 2 units of product X found on rack A (staff-may-report-a-found; given 32: the role reported it
// itself). The role decides as an owner or admin does: Found Stock → the request's row → its Rincian (what approving
// posts) → *Approve* → the confirm *Approve Found Stock #N* → FoundRequestApprove (business rules: opname.md §found,
// an-adjust-found-waits-for-the-owner-or-admin — approve posts a `found` transaction that claims the oldest open loss
// back into its batch at its price, else mints at the team's newest batch price here; a-surplus-claims-the-oldest-loss-first,
// a-claim-records-its-units, last-price-is-the-teams-newest-batch-here, nobody-finalizes-their-own-count).
// Every product is a selling team's; its units came in by that team's restock, all onto rack A.
//
//   29 (2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse owes the selling team)
//      — 5 received at Rp 10.000, 2 adjusted LOST on rack A (StockAdjust: 3 left, the warehouse owes Rp 20.000).
//     then: status approved — the answer APPROVED with its transaction; Waiting lists it no more (and the menu count is
//           gone); the Approved tab's row reads *Approved*, decided by the role's person; its Rincian *Approved by …* and
//           *Posted in transaction #T*; FoundRequestList APPROVED, decided by them.
//     then: ready stock of product X on rack A increases by 2 — ready 3 → 5 (ProductStockSummary), rack A 3 → 5
//           (RackStock and the rack page), the product page's On hand 5.
//     then: the units claim the old loss, back into its batch at its price — before approving, the row reads *Claimed back
//           Rp 20.000* and no new stock, the Rincian's one line *Claimed back* · *#<batch> · loss #<problem> of …* · 2 ·
//           Rp 10.000 · Rp 20.000, the confirm *claimed back Rp 20.000, new stock Rp 0*; after, still the one batch, its
//           ready 5 at Rp 10.000, its history +2 with 5 after.
//     then: the warehouse's debt to the selling team decreases — the pair −20.000 → 0, its one new entry a FOUND reversal
//           +Rp 20.000 on the approve's transaction (*Goods found again · movement #T* on the liability page).
//   30 (2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse's debt for the 2 lost
//      product X already paid) — as 29, then the warehouse paid the selling team Rp 20.000 (recorded from its own
//      account with a proof, confirmed by the selling team): the pair square.
//     then: the selling team owes the warehouse the value of the 2 units — the pair 0 → +20.000 from the warehouse's side
//           (−20.000 from the selling team's), the new entry a FOUND reversal +Rp 20.000; the warehouse's liability page
//           with the selling team reads Rp 20.000, *They owe you*.
//   31 (2 of product X found on rack A · no old loss · product X's newest batch here at Rp 10.000) — 2 at Rp 8.000,
//      then 3 at Rp 10.000.
//     then: a new batch at Rp 10.000 — before, the row reads *New stock Rp 20.000*, no claim, the Rincian's one line *New
//           stock* · *New batch* · 2 · Rp 10.000 · Rp 20.000; after, a third batch: arrived 2, ready 2, unit cost Rp 10.000
//           (BatchDetail and its page), the Rincian naming it *New batch #<id>*.
//     then: ready stock of product X increases by 2 — 5 → 7 (ProductStockSummary, rack A, the product page's On hand).
//     then: no debt between the warehouse and the selling team changes — the pair's balance and entries unchanged.
//   32 (this owner or admin reported it) — the role reported the 2 found on rack A itself (FoundRequestCreate as them).
//     then: cannot approve their own report — on Found Stock the row's Approve is disabled, *You reported it — another
//           Owner or Admin approves it.*, its other button reads Withdraw; the Rincian's Approve disabled with the same
//           words; FoundRequestList marks it OWN_REPORT for them (not for another owner of the warehouse); the server
//           refuses their FoundRequestApprove; it stays WAITING and ready stays 5.
//
// The ground (root, once): a selling team with an operational account and a category. Per (given, role) a warehouse
// with its fee, rack A, product X restocked, the role's person, the staff reporter, another owner (given 32) and the given.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-approve-29";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a" },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

// The givens name two roles: the describe carries neither token (acceptance_mark.py reads the role off the whole
// title), each test carries its own.
const GIVEN = "warehouse owner · admin wants to decide on a found report";
const WHEN = "approve found";
// Each given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = {
  29: "2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse owes the selling team",
  30: "2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse's debt for the 2 lost product X already paid",
  31: "2 of product X found on rack A · no old loss · product X's newest batch here at Rp 10.000",
  32: "this owner or admin reported it",
} as const;
type Given = keyof typeof CASE;
const GIVENS: Given[] = [29, 30, 31, 32];
// A team code is at most 10 characters: QY + the two-character tag + the 6-digit SUFFIX.
const TAG: Record<Given, string> = { 29: "A", 30: "B", 31: "C", 32: "D" };

// What each given's warehouse holds: the restocks (unit price, units — the later one is the newest batch), a LOST
// adjusted on rack A before the report, whether the warehouse paid that debt, and who reported the found.
interface Plan {
  restocks: { unit: number; n: number }[];
  lostBefore?: number;
  paid?: boolean;
  byRole?: boolean;
}
const PLAN: Record<Given, Plan> = {
  29: { restocks: [{ unit: 10_000, n: 5 }], lostBefore: 2 },
  30: { restocks: [{ unit: 10_000, n: 5 }], lostBefore: 2, paid: true },
  31: { restocks: [{ unit: 8_000, n: 2 }, { unit: 10_000, n: 3 }] },
  32: { restocks: [{ unit: 10_000, n: 5 }], byRole: true },
};
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
  other?: Person;
  rack: { id: string; code: string };
  product: { id: string; code: string; name: string };
  // The product's batches before the decision.
  batches: string[];
  found: string;
}

const ground = {
  seller: "",
  account: "",
  category: "",
  g: {} as Record<Given, Record<Key, Ground>>,
};

const num = (v: unknown) => Number(v ?? 0);
const RP = (n: number) => new RegExp(`^Rp\\s?${n.toLocaleString("id-ID").replace(/\./g, "\\.")}$`);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  sourceId?: string;
  reversal?: boolean;
}
// What a team and its counterparty owe each other, from `team`'s side (a payable is negative), and the pair's
// entries — LiabilityLogList under `token`.
async function pairOf(token: string, team: string, counterparty: string): Promise<{ balance: number; logs: Log[] }> {
  const res = await call(token, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: team,
    filter: { counterpartyId: counterparty },
    dataRequest: ["LIABILITY_LOG_LIST_DATA_TYPE_LOG"],
    page: { page: 1, limit: 50 },
  });
  const byId: Record<string, Log> = Object.assign({}, ...(res.items ?? []).map((it: { log?: { mapData?: object } }) => it.log?.mapData ?? {}));

  return { balance: num(res.balance), logs: ((res.ids ?? []) as unknown[]).map((id) => byId[String(id)]!).filter(Boolean) };
}
// The warehouse's side of the pair, as the role reads it.
const warehousePair = (b: Ground) => pairOf(b.me.token, b.warehouse, ground.seller);

interface Line {
  type?: string;
  batchId?: string;
  stockCount?: string;
  priceUnit?: number;
  amount?: number;
  problemId?: string;
}
interface Found {
  id: string;
  status?: string;
  stockCount?: string;
  decidedById?: string;
  reportedById?: string;
  claimedAmount?: number;
  mintedAmount?: number;
  transactionId?: string;
  block?: string;
  lines?: Line[];
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

// The payer's proof, uploaded and shared with the creditor (a-payment-must-carry-proof).
async function proof(ownerTeam: string, shareWith: string): Promise<string> {
  const bytes = Buffer.from(PNG, "base64");
  const requested = await asRoot("document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename: "transfer.png",
    contentType: "image/png",
    sizeBytes: String(bytes.length),
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });
  const put = await fetch(requested.uploadUrl, { method: requested.method, headers: requested.headers ?? {}, body: bytes });
  expect(put.status).toBeLessThan(300);
  const confirmed = await asRoot("document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await asRoot("document.v1.DocumentService/ShareDocument", { teamId: ownerTeam, documentId: confirmed.document.id, withTeamId: shareWith });

  return String(confirmed.document.id);
}

async function build(g: Given, r: Role): Promise<Ground> {
  const plan = PLAN[g];
  const tag = `${TAG[g]}${r.key.toUpperCase()}`;
  const warehouse = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Approve Found ${tag} ${SUFFIX}`,
        teamCode: `QY${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const me = await person(warehouse, `e2eqy${g}${r.key}${SUFFIX}`, `Pemutus ${r.given} ${g} ${SUFFIX}`, r.role);
  const staff = await person(warehouse, `e2eqys${g}${r.key}${SUFFIX}`, `Pelapor ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF");
  const other = plan.byRole
    ? await person(warehouse, `e2eqyd${g}${r.key}${SUFFIX}`, `Pemilik Lain ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_OWNER")
    : undefined;

  const code = `qy${tag.toLowerCase()}-a-${SUFFIX}`;
  const rack = { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

  const name = `Kaos X Approve ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QY${tag}X${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const product = { id: String(p.id), code: String(p.productCode), name };

  // GIVEN — the units, by the selling team's restocks, one after the other (the later one is the newest batch).
  for (const rs of plan.restocks) {
    const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: warehouse,
      financeAccountId: ground.account,
      items: [{ productId: product.id, productCode: product.code, name, count: rs.n, total: rs.n * rs.unit }],
    });
    await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: restock.request.id,
      lines: [{ itemId: restock.request.items[0].id, receivedCount: rs.n, placements: [{ placementId: rack.id, quantity: rs.n }] }],
    });
  }
  const batches = await batchIds(me.token, warehouse, product.id);
  expect(batches, `${g}${r.key}: one batch a restock`).toHaveLength(plan.restocks.length);

  if (plan.lostBefore) {
    // GIVEN — an old lost, not found yet: the batch's units adjusted LOST on rack A (the warehouse owes for them).
    await asRoot("inventory.v1.InventoryService/StockAdjust", {
      warehouseId: warehouse,
      productId: product.id,
      reasonType: "STOCK_ADJUST_REASON_LOST",
      batchId: batches[0],
      quantity: plan.lostBefore,
      rackId: rack.id,
      reason: `hilang dari rak ${SUFFIX}`,
    });
    const owed = -plan.lostBefore * plan.restocks[0]!.unit;
    await expect
      .poll(async () => (await pairOf(me.token, warehouse, ground.seller)).balance, { message: `${g}${r.key}: the lost owed`, timeout: 30_000 })
      .toBeCloseTo(owed, 3);

    if (plan.paid) {
      // GIVEN — the warehouse paid that debt: recorded from its own account with a proof, confirmed by the selling team.
      const from = String(
        (
          await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId: warehouse,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E approve found paid ${tag} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `E2E-QY-${tag}-${SUFFIX}`,
            openingBalance: 50_000,
            openingOn: today(),
          })
        ).account.id,
      );
      const recorded = await asRoot("liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
        teamId: warehouse,
        creditorTeamId: ground.seller,
        amount: String(-owed),
        note: `ganti 2 Kaos X yang hilang ${SUFFIX}`,
        documentIds: [await proof(warehouse, ground.seller)],
        fromAccountId: from,
      });
      const confirmed = await asRoot("liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
        teamId: ground.seller,
        paymentId: recorded.payment.id,
        toAccountId: ground.account,
      });
      expect(confirmed.payment.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
      await expect
        .poll(async () => (await pairOf(me.token, warehouse, ground.seller)).balance, { message: `${g}${r.key}: the debt paid`, timeout: 30_000 })
        .toBeCloseTo(0, 3);
    }
  }

  // GIVEN — the found report: 2 of X on rack A, waiting — the staff's (staff-may-report-a-found), or the role's own.
  const reporter = plan.byRole ? me : staff;
  const found = String(
    (
      await call(reporter.token, "inventory.v1.FoundRequestService/FoundRequestCreate", {
        teamId: warehouse,
        productId: product.id,
        rackId: rack.id,
        quantity: FOUND,
        note: `2 ketemu di balik kardus ${tag}${SUFFIX}`,
      })
    ).foundRequest.id,
  );

  return { tag, warehouse, me, staff, other, rack, product, batches, found };
}

// Signed in as the role, in its warehouse: Found Stock, the request waiting on it, and the menu's count.
async function openFoundStock(page: Page, b: Ground) {
  await signInAs(page, b.me.user, PASSWORD, b.warehouse);
  await page.goto("/inventories/found-stock");
  await expect(page.getByTestId("found-requests-page")).toBeVisible();
  const row = page.getByTestId(`found-request-${b.found}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
  await expect(page.getByTestId(`found-request-units-${b.found}`)).toContainText(`${FOUND} units`);
  await expect(page.getByTestId(`found-request-units-${b.found}`)).toContainText(b.rack.code);
  await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");

  return row;
}

// The request's Rincian, opened from its row: its posting lines, each its cells Posts · Batch · Units · Price · Amount.
async function openDetail(page: Page, b: Ground): Promise<{ dialog: Locator; cells: string[][] }> {
  await page.getByTestId(`found-request-reported-${b.found}`).click();
  const dialog = page.getByTestId("found-detail");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("found-detail-lines")).toBeVisible();
  const rows = dialog.getByTestId("found-detail-lines").locator("tbody tr");
  const cells: string[][] = [];
  for (let i = 0; i < (await rows.count()); i++) cells.push((await rows.nth(i).locator("td").allInnerTexts()).map((s) => s.trim()));

  return { dialog, cells };
}

interface Approved {
  foundRequest?: Found;
  transactionId?: string;
}
// WHEN — Approve in the Rincian → the confirm naming what posts → Approve: FoundRequestApprove. Returns the answer.
async function approve(page: Page, b: Ground, dialog: Locator, claimed: number, minted: number): Promise<Approved> {
  await expect(dialog.getByTestId("found-detail-approve")).toBeEnabled();
  await dialog.getByTestId("found-detail-approve").click();
  const confirm = page.getByRole("alertdialog", { name: `Approve Found Stock #${b.found}` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`${FOUND} × ${b.product.name} on ${b.rack.code} posts now`);
  await expect(confirm).toContainText(new RegExp(`claimed back Rp\\s?${claimed.toLocaleString("id-ID").replace(/\./g, "\\.")}, new stock Rp\\s?${minted.toLocaleString("id-ID").replace(/\./g, "\\.")}\\.`));
  const answer = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestApprove"));
  await confirm.getByTestId("confirm-action").click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as Approved;
  expect(res.ok(), JSON.stringify(json)).toBe(true);

  return json;
}

// The pair's ledger on the warehouse's liability page with the selling team: the entry naming `cause`.
async function ledgerEntry(page: Page, cause: string): Promise<Locator> {
  await page.goto(`/liability/${ground.seller}`);
  const entry = page.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]').filter({ hasText: cause });
  await expect(entry).toHaveCount(1);

  return entry;
}

// The batch page's History rows as text, each keyed by its column header.
async function historyRows(page: Page): Promise<Record<string, string>[]> {
  const table = page.getByTestId("batch-detail-history-table");
  if ((await table.count()) === 0) return [];

  return table.evaluate((t) => {
    const heads = Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    return Array.from(t.querySelectorAll("tbody tr")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
      return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? ""]));
    });
  });
}

// Ready and rack A as the role reads them, on the server and on its screens.
async function stockShown(page: Page, b: Ground, ready: number) {
  expect(await readyOf(b)).toBe(ready);
  expect(await onRack(b)).toBe(ready);
  await page.goto(`/inventories/racks/${b.rack.id}`);
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText(String(ready));
  await page.goto(`/inventories/products/${b.product.id}`);
  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
  await expect(page.getByTestId("warehouse-product-onhand")).toContainText(String(ready));
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  test.setTimeout(420_000);
  ground.seller = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Approve Found Seller ${SUFFIX}`,
        // not QY + a given letter — the warehouses are QY + A–D + O/A
        teamCode: `QYT${SUFFIX}`,
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
        name: `E2E approve found ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QY-${SUFFIX}`,
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
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Approve Found ${SUFFIX}` })).category.id);

  for (const g of GIVENS) {
    ground.g[g] = {} as Record<Key, Ground>;
    for (const r of ROLES) ground.g[g][r.key] = await build(g, r);
  }
});

// ── 29 (2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse owes the selling team) ─

test.describe(`${GIVEN} (${CASE[29]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[29]})`, async ({ page }) => {
      const b = ground.g[29][r.key];
      const batch = b.batches[0]!;
      // GIVEN — 3 left of the batch on rack A after the old lost, and the warehouse owes Rp 20.000 for it.
      expect(await readyOf(b)).toBe(3);
      expect(await onRack(b)).toBe(3);
      expect(num((await batchOf(b, batch)).ready)).toBe(3);
      const pairBefore = await warehousePair(b);
      expect(pairBefore.balance).toBeCloseTo(-20000, 3);
      expect(pairBefore.logs.filter((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_LOST_GOOD").map((l) => num(l.amount))).toEqual([-20000]);

      const row = await openFoundStock(page, b);
      // What approving would post, on the row and in the Rincian, before it is approved.
      await expect(row.getByTestId(`found-request-claimed-${b.found}`)).toHaveText(/^Claimed back Rp\s?20\.000$/);
      await expect(row.getByTestId(`found-request-minted-${b.found}`)).toHaveCount(0);
      const waiting = (await listed(b.me.token, b.warehouse)).get(b.found);
      const { dialog, cells } = await openDetail(page, b);
      let done: Approved = {};

      await test.step("then: the units claim the old loss, back into its batch at its price", async () => {
        const lines = waiting?.lines ?? [];
        expect(lines.map((l) => [l.type, String(l.batchId), num(l.stockCount), num(l.priceUnit), num(l.amount)])).toEqual([
          ["FOUND_REQUEST_POST_TYPE_CLAIM", batch, 2, 10000, 20000],
        ]);
        const problemId = String(lines[0]?.problemId ?? "");
        expect(problemId).not.toBe("");
        expect([num(waiting?.claimedAmount), num(waiting?.mintedAmount)]).toEqual([20000, 0]);
        await expect(dialog).toContainText("If approved");
        expect(cells).toHaveLength(1);
        expect(cells[0]![0]).toBe("Claimed back");
        expect(cells[0]![1]).toMatch(new RegExp(`^#${batch} · loss #${problemId} of `));
        expect(cells[0]![2]).toBe("2");
        expect(cells[0]![3]).toMatch(RP(10000));
        expect(cells[0]![4]).toMatch(RP(20000));

        done = await approve(page, b, dialog, 20000, 0);
        // back into ITS batch, at its price: still the one batch, 5 ready at Rp 10.000, the +2 on its own history
        expect(await batchIds(b.me.token, b.warehouse, b.product.id)).toEqual([batch]);
        const after = await batchOf(b, batch);
        expect([num(after.ready), num(after.unitCost)]).toEqual([5, 10000]);
        await page.goto(`/inventories/batches/${batch}`);
        await expect(page.getByTestId("batch-detail-ready")).toHaveText("5");
        await expect
          .poll(async () => (await historyRows(page)).some((x) => x["Change"] === "+2" && x["Ready after"] === "5"))
          .toBe(true);
      });

      await test.step("then: status approved", async () => {
        const tx = String(done.transactionId ?? "");
        expect(tx).not.toBe("");
        expect(done.foundRequest?.status).toBe("FOUND_REQUEST_STATUS_APPROVED");
        expect(String(done.foundRequest?.decidedById)).toBe(b.me.id);
        const decided = (await listed(b.me.token, b.warehouse, "FOUND_REQUEST_STATUS_APPROVED")).get(b.found);
        expect([decided?.status, String(decided?.decidedById), String(decided?.transactionId)]).toEqual([
          "FOUND_REQUEST_STATUS_APPROVED",
          b.me.id,
          tx,
        ]);
        expect((await listed(b.me.token, b.warehouse)).has(b.found)).toBe(false);
        // On Found Stock: off Waiting and off the menu's count; the Approved tab names who approved it.
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        await expect(page.getByTestId(`found-request-${b.found}`)).toHaveCount(0);
        await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveCount(0);
        await page.getByTestId("found-requests-tab-approved").click();
        const row = page.getByTestId(`found-request-${b.found}`);
        await expect(row).toBeVisible();
        await expect(row.getByTestId("found-request-status-2")).toHaveText("Approved");
        await expect(page.getByTestId(`found-request-decided-${b.found}`)).toContainText(b.me.name);
        await expect(page.getByTestId(`found-request-approve-${b.found}`)).toHaveCount(0);
        await page.getByTestId(`found-request-reported-${b.found}`).click();
        const detail = page.getByTestId("found-detail");
        await expect(detail.getByTestId("found-detail-decided")).toContainText(`Approved by ${b.me.name}`);
        await expect(detail).toContainText(`Posted in transaction #${tx}`);
        await expect(detail.getByTestId("found-detail-approve")).toHaveCount(0);
      });

      await test.step("then: ready stock of product X on rack A increases by 2", async () => {
        await stockShown(page, b, 5);
      });

      await test.step("then: the warehouse's debt to the selling team decreases", async () => {
        const tx = String(done.transactionId ?? "");
        const after = await warehousePair(b);
        expect(after.balance - pairBefore.balance).toBeCloseTo(20000, 3);
        expect(after.balance).toBeCloseTo(0, 3);
        const added = after.logs.filter((l) => !pairBefore.logs.some((x) => x.id === l.id));
        expect(added.map((l) => [l.sourceType, String(l.sourceId), num(l.amount), l.reversal ?? false])).toEqual([
          ["LIABILITY_SOURCE_TYPE_FOUND", tx, 20000, true],
        ]);
        const entry = await ledgerEntry(page, `Goods found again · movement #${tx}`);
        await expect(entry).toContainText(/\+\s?Rp\s?20\.000/);
        await expect(entry.locator('[data-testid^="liability-detail-reversal-"]')).toHaveCount(1);
      });
    });
  }
});

// ── 30 (… · the warehouse's debt for the 2 lost product X already paid) ─────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[30]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[30]})`, async ({ page }) => {
      const b = ground.g[30][r.key];
      // GIVEN — the old lost of 2 (3 left), and its debt paid: the pair square, the lost and the payment on it.
      expect(await readyOf(b)).toBe(3);
      const pairBefore = await warehousePair(b);
      expect(pairBefore.balance).toBeCloseTo(0, 3);
      expect(pairBefore.logs.filter((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_LOST_GOOD").map((l) => num(l.amount))).toEqual([-20000]);

      const row = await openFoundStock(page, b);
      await expect(row.getByTestId(`found-request-claimed-${b.found}`)).toHaveText(/^Claimed back Rp\s?20\.000$/);
      const { dialog } = await openDetail(page, b);
      const done = await approve(page, b, dialog, 20000, 0);
      expect(done.foundRequest?.status).toBe("FOUND_REQUEST_STATUS_APPROVED");

      await test.step("then: the selling team owes the warehouse the value of the 2 units", async () => {
        const tx = String(done.transactionId ?? "");
        // the warehouse's side: 0 → +20.000 (owed to it), by the found's one reversal
        const after = await warehousePair(b);
        expect(after.balance).toBeCloseTo(20000, 3);
        const added = after.logs.filter((l) => !pairBefore.logs.some((x) => x.id === l.id));
        expect(added.map((l) => [l.sourceType, String(l.sourceId), num(l.amount), l.reversal ?? false])).toEqual([
          ["LIABILITY_SOURCE_TYPE_FOUND", tx, 20000, true],
        ]);
        // …and the selling team's side of the same pair: it owes Rp 20.000
        const sellerSide = await asRoot("liability.v1.LiabilityService/LiabilityLogList", {
          teamId: ground.seller,
          filter: { counterpartyId: b.warehouse },
          dataRequest: ["LIABILITY_LOG_LIST_DATA_TYPE_LOG"],
          page: { page: 1, limit: 50 },
        });
        expect(num(sellerSide.balance)).toBeCloseTo(-20000, 3);
        // on the warehouse's liability page with the selling team
        const entry = await ledgerEntry(page, `Goods found again · movement #${tx}`);
        await expect(entry).toContainText(/\+\s?Rp\s?20\.000/);
        await expect(page.getByTestId("liability-detail-balance")).toHaveText(RP(20000));
        await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");
      });
    });
  }
});

// ── 31 (2 of product X found on rack A · no old loss · product X's newest batch here at Rp 10.000) ─────────────────────

test.describe(`${GIVEN} (${CASE[31]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[31]})`, async ({ page }) => {
      const b = ground.g[31][r.key];
      // GIVEN — two batches here: the older at Rp 8.000, the newest at Rp 10.000; 5 ready, nothing lost.
      expect((await Promise.all(b.batches.map((id) => batchOf(b, id)))).map((x) => num(x.unitCost))).toEqual([8000, 10000]);
      expect(await readyOf(b)).toBe(5);
      const pairBefore = await warehousePair(b);

      const row = await openFoundStock(page, b);
      await expect(row.getByTestId(`found-request-minted-${b.found}`)).toHaveText(/^New stock Rp\s?20\.000$/);
      await expect(row.getByTestId(`found-request-claimed-${b.found}`)).toHaveCount(0);
      const waiting = (await listed(b.me.token, b.warehouse)).get(b.found);
      const { dialog, cells } = await openDetail(page, b);
      let done: Approved = {};

      await test.step("then: a new batch at Rp 10.000", async () => {
        expect((waiting?.lines ?? []).map((l) => [l.type, num(l.stockCount), num(l.priceUnit), num(l.amount)])).toEqual([
          ["FOUND_REQUEST_POST_TYPE_MINT", 2, 10000, 20000],
        ]);
        expect([num(waiting?.claimedAmount), num(waiting?.mintedAmount)]).toEqual([0, 20000]);
        expect(cells).toHaveLength(1);
        expect(cells[0]!.slice(0, 3)).toEqual(["New stock", "New batch", "2"]);
        expect(cells[0]![3]).toMatch(RP(10000));
        expect(cells[0]![4]).toMatch(RP(20000));

        done = await approve(page, b, dialog, 0, 20000);
        const ids = await batchIds(b.me.token, b.warehouse, b.product.id);
        const minted = ids.filter((id) => !b.batches.includes(id));
        expect(minted).toHaveLength(1);
        const m = await batchOf(b, minted[0]!);
        expect([num(m.arrived), num(m.ready), num(m.unitCost)]).toEqual([2, 2, 10000]);
        // the Rincian of the approved request names the new batch
        await page.goto("/inventories/found-stock?status=approved");
        await page.getByTestId(`found-request-reported-${b.found}`).click();
        await expect(page.getByTestId("found-detail").getByTestId("found-detail-lines")).toContainText(`New batch #${minted[0]}`);
        await page.goto(`/inventories/batches/${minted[0]}`);
        await expect(page.getByTestId("batch-detail-unit-cost")).toContainText("Rp 10.000");
        await expect(page.getByTestId("batch-detail-arrived")).toHaveText("2");
      });

      await test.step("then: ready stock of product X increases by 2", async () => {
        await stockShown(page, b, 7);
      });

      await test.step("then: no debt between the warehouse and the selling team changes", async () => {
        expect(done.foundRequest?.status).toBe("FOUND_REQUEST_STATUS_APPROVED");
        const after = await warehousePair(b);
        expect(after.balance).toBeCloseTo(pairBefore.balance, 3);
        expect(after.logs.map((l) => l.id)).toEqual(pairBefore.logs.map((l) => l.id));
      });
    });
  }
});

// ── 32 (this owner or admin reported it) ───────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE[32]})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE[32]})`, async ({ page }) => {
      const b = ground.g[32][r.key];
      expect(await readyOf(b)).toBe(5);

      await test.step("then: cannot approve their own report", async () => {
        const own = "You reported it — another Owner or Admin approves it.";
        await signInAs(page, b.me.user, PASSWORD, b.warehouse);
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        const row = page.getByTestId(`found-request-${b.found}`);
        await expect(row).toBeVisible();
        await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
        await expect(page.getByTestId(`found-request-reported-${b.found}`)).toContainText(b.me.name);
        await expect(page.getByTestId(`found-request-approve-${b.found}`)).toBeDisabled();
        await expect(page.getByTestId(`found-request-block-${b.found}`)).toHaveText(own);
        await expect(page.getByTestId(`found-request-reject-${b.found}`)).toHaveText("Withdraw");
        // the Rincian says the same, its Approve off
        await page.getByTestId(`found-request-reported-${b.found}`).click();
        const detail = page.getByTestId("found-detail");
        await expect(detail).toBeVisible();
        await expect(detail.getByTestId("found-detail-approve")).toBeDisabled();
        await expect(detail.getByTestId("found-detail-block")).toContainText(own);
        // a click on the disabled Approve opens no confirm
        await detail.getByTestId("found-detail-approve").click({ force: true });
        await expect(page.getByRole("alertdialog", { name: `Approve Found Stock #${b.found}` })).toHaveCount(0);

        // On the server: blocked for them as their own report — not for another owner of this warehouse — and refused.
        expect((await listed(b.me.token, b.warehouse)).get(b.found)?.block).toBe("FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT");
        expect((await listed(b.other!.token, b.warehouse)).get(b.found)?.block ?? "FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED").toBe(
          "FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED",
        );
        const refused = await call(b.me.token, "inventory.v1.FoundRequestService/FoundRequestApprove", {
          teamId: b.warehouse,
          foundRequestId: b.found,
        }).then(
          () => "",
          (err) => String(err),
        );
        expect(refused).toContain("you reported this found");
        const still = (await listed(b.me.token, b.warehouse)).get(b.found);
        expect([still?.status, String(still?.reportedById)]).toEqual(["FOUND_REQUEST_STATUS_WAITING", b.me.id]);
        expect(await readyOf(b)).toBe(5);
        expect(await batchIds(b.me.token, b.warehouse, b.product.id)).toEqual(b.batches);
      });
    });
  }
});
