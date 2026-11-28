import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// warehouse owner · admin want to put found units back in stock — the checks behind docs/acceptances/inventory/opname.md,
// section *found*, given 28 (when *adjust found*). One test per role the given names — warehouse:owner, warehouse:admin —
// each signed in as a person of that role in a WAREHOUSE OF ITS OWN, so the waiting count on the menu is this report's
// alone. The role sends the found as an owner or admin does at a product: product X's warehouse page → *Adjust* → rack A,
// reason *Found*, 2 units, a note → *Send for Approval* → FoundRequestCreate (business rules: opname.md §found,
// an-adjust-found-waits-for-the-owner-or-admin — an Adjust found is a request that posts nothing until an Owner or Admin
// who did not send it approves; nobody-finalizes-their-own-count; found-stock-sits-after-stock-opname-with-its-count).
// found_requests.spec.ts stays the older regression (the batch page's Adjust, a second owner's approval, staff's report);
// opname_warehouse_wants_to_report_found.spec.ts is given 27, the rack page's door.
//
//   28 (product X · rack A · 2 found · note) — product X, 5 units of the selling team's restock at Rp 10.000, all on
//      rack A; nothing waiting on Found Stock; besides the role's person, another warehouse owner and another warehouse
//      admin of the same warehouse.
//     then: waits to be approved by another owner or admin, not the one who sent it — the sender's own Found Stock offers
//           no Approve (*You reported it*, their Reject reads Withdraw), FoundRequestList marks it OWN_REPORT for them,
//           and the server refuses their FoundRequestApprove; the other owner and the other admin each see it on Found
//           Stock with the menu's count 1 and Approve enabled, and FoundRequestList lists it for them unblocked.
//     then: the found units are sent for approval, and ready stock of product X stays the same until they are approved —
//           the dialog says the stock changes only on another's approval and draws no batch and no before → after;
//           the answer is WAITING with 2 units on rack A, the note and the sender; on Found Stock the row reads
//           *Waiting*; ready stays 5 (ProductStockSummary), rack A 5, the same one batch, the product page's On hand 5
//           and Ready value Rp 50.000. Once the other decider approves it on their Found Stock, ready is 7 and rack A 7
//           (the 2 minted at Rp 10.000, the team's newest price here — no old loss to claim).
//
// The ground (root, once): a selling team with an operational account and a category. Per role a warehouse with its fee,
// rack A, product X restocked onto it, the role's person and the two deciders.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-adjust-28";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o", approver: "admin" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a", approver: "owner" },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

// The given names two roles: the describe carries neither token (acceptance_mark.py reads the role off the whole
// title), each test carries its own.
const GIVEN = "warehouse owner · admin wants to put found units back in stock";
const WHEN = "adjust found";
// The given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = "product X · rack A · 2 found · note";

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
  owner: Person;
  admin: Person;
  rack: { id: string; code: string };
  product: { id: string; code: string; name: string };
  batches: string[];
}

const ground = {
  seller: "",
  account: "",
  category: "",
  g: {} as Record<Key, Ground>,
};

const num = (v: unknown) => Number(v ?? 0);

async function batchIds(warehouse: string, productId: string): Promise<string[]> {
  const res = await asRoot("inventory.v1.InventoryService/BatchList", {
    teamId: warehouse,
    filter: { productId },
    page: { page: 1, limit: 20 },
  });

  return ((res.ids ?? []) as unknown[]).map(String).sort((a, b) => Number(a) - Number(b));
}

// The product's READY units in this warehouse (ProductStockSummary).
async function readyOf(b: Ground): Promise<number> {
  return num(
    (await asRoot("inventory.v1.InventoryService/ProductStockSummary", { teamId: b.warehouse, productId: b.product.id })).readyQty,
  );
}

// The product's units on rack A (RackStock).
async function onRack(b: Ground): Promise<number> {
  const res = await asRoot("inventory.v1.RackService/RackStock", {
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

interface Found {
  id: string;
  status?: string;
  note?: string;
  stockCount?: string;
  rackId?: string;
  productId?: string;
  reportedById?: string;
  decidedById?: string;
  block?: string;
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
        name: `E2E Adjust Found ${tag} ${SUFFIX}`,
        teamCode: `QL${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const me = await person(warehouse, `e2eql${r.key}${SUFFIX}`, `Pengirim ${r.given} ${SUFFIX}`, r.role);
  const owner = await person(warehouse, `e2eqldo${r.key}${SUFFIX}`, `Pemilik Lain ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_OWNER");
  const admin = await person(warehouse, `e2eqlda${r.key}${SUFFIX}`, `Admin Lain ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_ADMIN");

  const code = `ql${r.key}-a-${SUFFIX}`;
  const rack = { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

  const name = `Kaos X Adjust ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QL${tag}X${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const product = { id: String(p.id), code: String(p.productCode), name };

  // GIVEN — 5 units by the selling team's restock at Rp 10.000, all on rack A.
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: warehouse,
    financeAccountId: ground.account,
    items: [{ productId: product.id, productCode: product.code, name, count: 5, total: 50_000 }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 5, placements: [{ placementId: rack.id, quantity: 5 }] }],
  });
  const batches = await batchIds(warehouse, product.id);
  expect(batches, `${r.key}: one batch`).toHaveLength(1);

  return { tag, warehouse, me, owner, admin, rack, product, batches };
}

// Another owner's or admin's own Found Stock, on a page of its own: the menu's count, the row, and Approve open to them.
async function deciderSees(browser: Browser, b: Ground, who: Person, id: string) {
  const p: Page = await browser.newPage();
  try {
    await signInAs(p, who.user, PASSWORD, b.warehouse);
    await p.goto("/inventories/found-stock");
    await expect(p.getByTestId("found-requests-page")).toBeVisible();
    await expect(p.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");
    const row = p.getByTestId(`found-request-${id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
    await expect(row).toContainText(b.product.name);
    await expect(p.getByTestId(`found-request-reported-${id}`)).toContainText(b.me.name);
    await expect(p.getByTestId(`found-request-approve-${id}`)).toBeEnabled();
    await expect(p.getByTestId(`found-request-block-${id}`)).toHaveCount(0);
    await expect(p.getByTestId(`found-request-reject-${id}`)).toHaveText("Reject");
    // …and the server lists it for them, nothing blocking their approval.
    const f = (await listed(who.token, b.warehouse)).get(id);
    expect(f, `${who.name} reads it waiting`).toBeDefined();
    expect(f?.block ?? "FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED").toBe("FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED");
  } finally {
    await p.close();
  }
}

// The other decider approves it on their own Found Stock, as a person does: Approve → the confirm.
async function approveOnScreen(browser: Browser, b: Ground, who: Person, id: string) {
  const p: Page = await browser.newPage();
  try {
    await signInAs(p, who.user, PASSWORD, b.warehouse);
    await p.goto("/inventories/found-stock");
    const approve = p.getByTestId(`found-request-approve-${id}`);
    await expect(approve).toBeEnabled();
    await expect(p.getByTestId(`found-request-minted-${id}`)).toContainText("Rp 20.000");
    const answer = p.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestApprove"));
    await approve.click();
    await p.getByRole("alertdialog").getByTestId("confirm-action").click();
    expect((await answer).ok()).toBe(true);
    // Off the waiting list, and off the menu's count — a 0 is never drawn.
    await expect(p.getByTestId(`found-request-${id}`)).toHaveCount(0);
    await expect(p.getByTestId("nav-count-/inventories/found-stock")).toHaveCount(0);
  } finally {
    await p.close();
  }
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  ground.seller = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Adjust Found Seller ${SUFFIX}`,
        // not QLO / QLA — the roles' warehouses are QL + O / A
        teamCode: `QLT${SUFFIX}`,
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
        name: `E2E adjust found ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QL-${SUFFIX}`,
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
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Adjust Found ${SUFFIX}` })).category.id);

  for (const r of ROLES) ground.g[r.key] = await build(r);
});

// ── 28 (product X · rack A · 2 found · note) ────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE})`, async ({ page, browser }) => {
      const b = ground.g[r.key];
      const note = `2 ketemu di balik kardus waktu rapikan rak ${r.key}${SUFFIX}`;

      // GIVEN — rack A holds 5 of X, and nothing waits on Found Stock.
      expect(await readyOf(b)).toBe(5);
      expect(await onRack(b)).toBe(5);
      expect((await listed(b.me.token, b.warehouse)).size).toBe(0);

      // WHEN — product X's page → Adjust → rack A, Found, 2 units, the note → Send for Approval → FoundRequestCreate.
      await signInAs(page, b.me.user, PASSWORD, b.warehouse);
      await page.goto(`/inventories/products/${b.product.id}`);
      await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
      await expect(page.getByTestId("warehouse-product-onhand")).toContainText("5");
      await page.getByTestId("wp-action-adjust").click();
      const dialog = page.getByTestId("adjust-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("rack-select").click();
      await dialog.getByTestId(`rack-select-option-${b.rack.id}`).click();
      await dialog.getByTestId("adjust-reason-option-found").click();
      await dialog.getByTestId("adjust-amount").fill("2");
      await dialog.getByTestId("adjust-reason").fill(note);
      const submit = dialog.getByTestId("submit-adjust");

      // What the dialog says before it is sent: it waits for another, names no batch, shows no before → after.
      await expect(dialog.getByTestId("adjust-found-waits")).toContainText("Stock changes once another Owner or Admin");
      await expect(dialog.getByTestId("adjust-batch")).toHaveCount(0);
      await expect(dialog.getByTestId("adjust-delta")).toHaveCount(0);
      await expect(submit).toHaveText("Send for Approval");
      await expect(submit).toBeEnabled();

      const answer = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestCreate"));
      await submit.click();
      const res = await answer;
      const created = (await res.json().catch(() => ({}))) as { foundRequest?: Found };
      expect(res.ok(), JSON.stringify(created)).toBe(true);
      await expect(dialog).toBeHidden();
      const id = String(created.foundRequest?.id ?? "");
      expect(id).not.toBe("");

      await test.step("then: waits to be approved by another owner or admin, not the one who sent it", async () => {
        // The sender decides nothing on what they sent: no Approve for them, on screen or on the server.
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        await expect(page.getByTestId(`found-request-${id}`)).toBeVisible();
        await expect(page.getByTestId(`found-request-approve-${id}`)).toBeDisabled();
        await expect(page.getByTestId(`found-request-block-${id}`)).toContainText("You reported it");
        await expect(page.getByTestId(`found-request-reject-${id}`)).toHaveText("Withdraw");
        expect((await listed(b.me.token, b.warehouse)).get(id)?.block).toBe("FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT");
        const refused = await call(b.me.token, "inventory.v1.FoundRequestService/FoundRequestApprove", {
          teamId: b.warehouse,
          foundRequestId: id,
        }).then(
          () => "",
          (err) => String(err),
        );
        expect(refused).toContain("you reported this found");
        expect((await listed(b.me.token, b.warehouse)).get(id)?.status).toBe("FOUND_REQUEST_STATUS_WAITING");

        // Another owner and another admin of this warehouse each have it to decide.
        await deciderSees(browser, b, b.owner, id);
        await deciderSees(browser, b, b.admin, id);
      });

      await test.step(
        "then: the found units are sent for approval, and ready stock of product X stays the same until they are approved",
        async () => {
          // Sent for approval: the request waits with what the sender gave it.
          const f = created.foundRequest!;
          expect(f.status).toBe("FOUND_REQUEST_STATUS_WAITING");
          expect(num(f.stockCount)).toBe(2);
          expect(String(f.rackId)).toBe(b.rack.id);
          expect(String(f.productId)).toBe(b.product.id);
          expect(f.note).toBe(note);
          expect(String(f.reportedById)).toBe(b.me.id);
          const mine = await listed(b.me.token, b.warehouse);
          expect([...mine.keys()]).toEqual([id]);
          expect(mine.get(id)?.note).toBe(note);
          await page.goto("/inventories/found-stock");
          const row = page.getByTestId(`found-request-${id}`);
          await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
          await expect(page.getByTestId(`found-request-units-${id}`)).toContainText("2 units");
          await expect(page.getByTestId(`found-request-units-${id}`)).toContainText(b.rack.code);

          // Ready stock the same: 5 ready, rack A 5, the one batch — and on the sender's own screens.
          expect(await readyOf(b)).toBe(5);
          expect(await onRack(b)).toBe(5);
          expect(await batchIds(b.warehouse, b.product.id)).toEqual(b.batches);
          await page.goto(`/inventories/racks/${b.rack.id}`);
          await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText("5");
          await page.goto(`/inventories/products/${b.product.id}`);
          await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
          await expect(page.getByTestId("warehouse-product-onhand")).toContainText("5");
          await expect(page.getByTestId("warehouse-product-ready-value")).toContainText("Rp 50.000");

          // Until approved: the other decider approves it on their Found Stock, and only then are the 2 on rack A —
          // minted at Rp 10.000, the team's newest price here (no old loss to claim back).
          const approver = b[r.approver];
          await approveOnScreen(browser, b, approver, id);
          const decided = (await listed(approver.token, b.warehouse, "FOUND_REQUEST_STATUS_APPROVED")).get(id);
          expect(decided?.status).toBe("FOUND_REQUEST_STATUS_APPROVED");
          expect(String(decided?.decidedById)).toBe(approver.id);
          await expect.poll(() => readyOf(b)).toBe(7);
          expect(await onRack(b)).toBe(7);
          expect(await batchIds(b.warehouse, b.product.id)).toHaveLength(2);
          await page.goto(`/inventories/products/${b.product.id}`);
          await expect(page.getByTestId("warehouse-product-onhand")).toContainText("7");
          await expect(page.getByTestId("warehouse-product-ready-value")).toContainText("Rp 70.000");
        },
      );
    });
  }
});
