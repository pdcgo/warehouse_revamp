import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// warehouse:all wants to put found units back in stock — the checks behind docs/acceptances/inventory/opname.md, section
// *found*, given 27 (when *report found*). One test per role the given names — warehouse:owner, warehouse:admin,
// warehouse:staff — each signed in as a person of that role in a WAREHOUSE OF ITS OWN, so the waiting count on the menu
// is this report's alone. The role reports as a person at the shelf does: rack A's page → *Report Found* → product X
// picked from what the warehouse holds, 2 units, a note → *Send* → FoundRequestCreate (business rules: opname.md §found,
// staff-may-report-a-found, an-adjust-found-waits-for-the-owner-or-admin — a report posts nothing until an Owner or
// Admin who did not report it approves, found-stock-sits-after-stock-opname-with-its-count, a-warehouse-picks-only-what-
// it-has-held). found_requests.spec.ts stays the older regression (Adjust's found, the second owner's approval, the
// warehouse's Products).
//
//   27 (rack A · product X · 2 found · note) — product X, 5 units of the selling team's restock at Rp 10.000, all on
//      rack A; nothing waiting on Found Stock.
//     then: found report waiting, with its note — the answer WAITING with the note, 2 units, rack A and the reporter;
//           FoundRequestList under the role's token lists it waiting; on Found Stock (Waiting tab) the row reads
//           *Waiting*, 2 units on rack A, the reporter's name, and its Rincian reads the note.
//     then: shows on Found Stock for the owner and admin to decide — another warehouse owner and another warehouse admin
//           of the same warehouse each open Found Stock: the menu's count reads 1, the row is there with Approve
//           enabled and Reject offered. The reporter decides nothing: an owner or admin reporter's Approve is off
//           (*You reported it*, their Reject reads Withdraw); staff get no Approve at all.
//     then: ready stock of product X unchanged until approved — after the report ready stays 5 (ProductStockSummary),
//           rack A 5 (its page and RackStock), the same one batch, the product page's On hand 5 and Ready value
//           Rp 50.000; once the other admin approves it, ready is 7 and rack A 7 (the 2 minted at the team's newest
//           price here, Rp 10.000 — no old loss to claim).
//
// The ground (root, once): a selling team with an operational account and a category. Per role a warehouse with its fee,
// rack A, product X restocked onto it, the role's person and the two deciders (an owner and an admin who did not report).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-found-27";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o", decides: true },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a", decides: true },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "s", decides: false },
] as const;
type Role = (typeof ROLES)[number];
type Key = Role["key"];

const GIVEN = "warehouse:all wants to put found units back in stock";
const WHEN = "report found";
// The given's case text, verbatim from opname.md — the marking script finds the tests by it.
const CASE = "rack A · product X · 2 found · note";

interface Person {
  user: string;
  name: string;
  token: string;
}
interface Ground {
  tag: string;
  warehouse: string;
  user: string;
  userId: string;
  userName: string;
  token: string;
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
}
// The warehouse's WAITING found requests under `token` (FoundRequestList — staff are given only their own).
async function waiting(token: string, warehouse: string): Promise<Map<string, Found>> {
  const res = await call(token, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: warehouse,
    filter: { status: "FOUND_REQUEST_STATUS_WAITING" },
    page: { page: 1, limit: 20 },
  });
  const byId = new Map<string, Found>();
  for (const it of res.items ?? []) {
    for (const r of Object.values(it.request?.mapData ?? {}) as Found[]) byId.set(String(r.id), r);
  }

  return byId;
}

async function person(warehouse: string, user: string, name: string, role: string): Promise<{ id: string; p: Person }> {
  const created = await asRoot("user.v1.UserService/CreateUser", { teamId: warehouse, username: user, password: PASSWORD, name, role });

  return { id: String(created.user.id), p: { user, name, token: await login(user, PASSWORD) } };
}

async function build(r: Role): Promise<Ground> {
  const tag = r.key.toUpperCase();
  const warehouse = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Report Found ${tag} ${SUFFIX}`,
        teamCode: `QJ${tag}${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });

  const reporter = await person(warehouse, `e2eqj${r.key}${SUFFIX}`, `Pelapor ${r.given} ${SUFFIX}`, r.role);
  const owner = await person(warehouse, `e2eqjdo${r.key}${SUFFIX}`, `Pemilik Penentu ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_OWNER");
  const admin = await person(warehouse, `e2eqjda${r.key}${SUFFIX}`, `Admin Penentu ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_ADMIN");

  const code = `qj${r.key}-a-${SUFFIX}`;
  const rack = { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

  const name = `Kaos X Temuan ${tag} ${SUFFIX}`;
  const p = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `QJ${tag}X${SUFFIX}`,
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

  return {
    tag,
    warehouse,
    user: reporter.p.user,
    userId: reporter.id,
    userName: reporter.p.name,
    token: reporter.p.token,
    owner: owner.p,
    admin: admin.p,
    rack,
    product,
    batches,
  };
}

// A decider's own Found Stock, on a page of its own: the menu's count, the row, and what they may do with it.
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
    await expect(p.getByTestId(`found-request-reported-${id}`)).toContainText(b.userName);
    await expect(p.getByTestId(`found-request-approve-${id}`)).toBeEnabled();
    await expect(p.getByTestId(`found-request-block-${id}`)).toHaveCount(0);
    await expect(p.getByTestId(`found-request-reject-${id}`)).toHaveText("Reject");
    // …and the server lists it for them too.
    expect((await waiting(who.token, b.warehouse)).has(id), `${who.name} reads it waiting`).toBe(true);
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
        name: `E2E Report Found Seller ${SUFFIX}`,
        // not QJS — staff's warehouse is QJ + S
        teamCode: `QJT${SUFFIX}`,
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
        name: `E2E report found ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QJ-${SUFFIX}`,
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
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Report Found ${SUFFIX}` })).category.id);

  for (const r of ROLES) ground.g[r.key] = await build(r);
});

// ── 27 (rack A · product X · 2 found · note) ────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${CASE})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${CASE})`, async ({ page, browser }) => {
      const b = ground.g[r.key];
      const note = `ketemu 2 di balik kardus, rak bawah ${r.key}${SUFFIX}`;

      // GIVEN — rack A holds 5 of X, and nothing waits on Found Stock.
      expect(await readyOf(b)).toBe(5);
      expect(await onRack(b)).toBe(5);
      expect((await waiting(b.token, b.warehouse)).size).toBe(0);

      // WHEN — rack A's page → Report Found → product X, 2 units, the note → Send → FoundRequestCreate.
      await signInAs(page, b.user, PASSWORD, b.warehouse);
      await page.goto(`/inventories/racks/${b.rack.id}`);
      await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText("5");
      await page.getByTestId("rack-action-report-found").click();
      const dialog = page.getByTestId("report-found-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(b.rack.code);
      const box = dialog.getByRole("combobox");
      await box.click();
      await box.pressSequentially(`Temuan ${b.tag} ${SUFFIX}`, { delay: 30 });
      const option = dialog.getByTestId(`product-select-option-${b.product.code}`);
      await expect(option).toBeVisible();
      await option.click();
      await dialog.getByTestId("report-found-amount").fill("2");
      await dialog.getByTestId("report-found-note").fill(note);
      const answer = page.waitForResponse((res) => res.url().includes("FoundRequestService/FoundRequestCreate"));
      await dialog.getByTestId("report-found-submit").click();
      const res = await answer;
      const created = (await res.json().catch(() => ({}))) as { foundRequest?: Found };
      expect(res.ok(), JSON.stringify(created)).toBe(true);
      await expect(dialog).toBeHidden();
      const id = String(created.foundRequest?.id ?? "");
      expect(id).not.toBe("");

      await test.step("then: found report waiting, with its note", async () => {
        const f = created.foundRequest!;
        expect(f.status).toBe("FOUND_REQUEST_STATUS_WAITING");
        expect(f.note).toBe(note);
        expect(num(f.stockCount)).toBe(2);
        expect(String(f.rackId)).toBe(b.rack.id);
        expect(String(f.productId)).toBe(b.product.id);
        expect(String(f.reportedById)).toBe(b.userId);

        // The server lists it waiting for the reporter, with the note.
        const listed = await waiting(b.token, b.warehouse);
        expect([...listed.keys()]).toEqual([id]);
        expect(listed.get(id)?.note).toBe(note);

        // On Found Stock — the Waiting tab it opens on — and its Rincian reads the note.
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId("found-requests-page")).toBeVisible();
        await expect(page.getByTestId("found-requests-tab-waiting")).toHaveAttribute("aria-selected", "true");
        const row = page.getByTestId(`found-request-${id}`);
        await expect(row).toBeVisible();
        await expect(row.getByTestId("found-request-status-1")).toHaveText("Waiting");
        await expect(page.getByTestId(`found-request-units-${id}`)).toContainText("2 units");
        await expect(page.getByTestId(`found-request-units-${id}`)).toContainText(b.rack.code);
        await expect(page.getByTestId(`found-request-reported-${id}`)).toContainText(b.userName);
        await page.getByTestId(`found-request-reported-${id}`).click();
        const detail = page.getByTestId("found-detail");
        await expect(detail).toBeVisible();
        await expect(detail.getByTestId("found-detail-note")).toContainText(note);
        await page.keyboard.press("Escape");
        await expect(detail).toBeHidden();
      });

      await test.step("then: shows on Found Stock for the owner and admin to decide", async () => {
        // Another owner and another admin of this warehouse each see it, to approve or reject.
        await deciderSees(browser, b, b.owner, id);
        await deciderSees(browser, b, b.admin, id);

        // The reporter decides nothing on their own report.
        await page.goto("/inventories/found-stock");
        await expect(page.getByTestId(`found-request-${id}`)).toBeVisible();
        if (r.decides) {
          await expect(page.getByTestId(`found-request-approve-${id}`)).toBeDisabled();
          await expect(page.getByTestId(`found-request-block-${id}`)).toContainText("You reported it");
          await expect(page.getByTestId(`found-request-reject-${id}`)).toHaveText("Withdraw");
        } else {
          await expect(page.getByTestId(`found-request-approve-${id}`)).toHaveCount(0);
          await expect(page.getByTestId(`found-request-reject-${id}`)).toHaveText("Withdraw");
        }
      });

      await test.step("then: ready stock of product X unchanged until approved", async () => {
        // Nothing posted by the report: ready 5, rack A 5, the same one batch.
        expect(await readyOf(b)).toBe(5);
        expect(await onRack(b)).toBe(5);
        expect(await batchIds(b.warehouse, b.product.id)).toEqual(b.batches);

        // …on the role's own screens too: the rack's page and the product's page.
        await page.goto(`/inventories/racks/${b.rack.id}`);
        await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${b.product.id}`)).toHaveText("5");
        await page.goto(`/inventories/products/${b.product.id}`);
        await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
        await expect(page.getByTestId("warehouse-product-onhand")).toContainText("5");
        await expect(page.getByTestId("warehouse-product-ready-value")).toContainText("Rp 50.000");
        expect((await waiting(b.token, b.warehouse)).get(id)?.status).toBe("FOUND_REQUEST_STATUS_WAITING");

        // Until approved: the other admin approves, and only then are the 2 on rack A — minted at Rp 10.000, the
        // team's newest price here (no old loss to claim back).
        const approved = await call(b.admin.token, "inventory.v1.FoundRequestService/FoundRequestApprove", {
          teamId: b.warehouse,
          foundRequestId: id,
        });
        expect(approved.foundRequest?.status).toBe("FOUND_REQUEST_STATUS_APPROVED");
        await expect.poll(() => readyOf(b)).toBe(7);
        expect(await onRack(b)).toBe(7);
        expect(await batchIds(b.warehouse, b.product.id)).toHaveLength(2);
        await page.goto(`/inventories/products/${b.product.id}`);
        await expect(page.getByTestId("warehouse-product-onhand")).toContainText("7");
        await expect(page.getByTestId("warehouse-product-ready-value")).toContainText("Rp 70.000");
      });
    });
  }
});
