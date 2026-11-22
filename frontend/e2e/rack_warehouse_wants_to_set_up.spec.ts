import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// warehouse:owner · warehouse:admin wants to set up the racks, and warehouse:staff may not — the checks behind
// docs/acceptances/inventory/placement.md, section *racks*, when *create rack*: givens 1, 2 and 7. One test per role the
// given names, each signed in as a person of that role, in a warehouse of its own (so "A-01-1" is free in each, run after
// run, and no rack another test made can stand in for this one's).
//
//   1 (code "A-01-1" · no name) → create rack, through the list's own dialog (open-create-rack → rack-code → submit-rack)
//      then: rack listed as "a-01-1" — the row is the code as SAVED, trimmed and lowercase
//            (rack-codes-are-saved-lowercase), on the screen and in RackCreate's answer; no name on it;
//      then: "empty" on its row — the row's KOSONG badge (an-empty-rack-says-so), 0 products · 0 pieces.
//   2 (code already used in this warehouse — "A-02-1", made by root before) → create rack "A-02-1"
//      then: cannot create rack — the dialog stays open, the list still holds ONE a-02-1, and RackCreate under the role's
//            own token answers already_exists;
//      then: message says the code already exists — the form's error line names the code.
//   7 (warehouse:staff · code "A-01-2") → create rack
//      then: cannot create rack — RackCreate's policy is owner/admin (rack.proto); the staff's attempt (the dialog when the
//            page offers it, and RackCreate under the staff's own token) answers permission_denied, and the list, read
//            again, holds no a-01-2.
//   3 (rack a-01-1 · name changed) → edit rack, through the row's own pencil (edit-rack-a-01-1 → rack-name → submit-rack)
//      then: rack shows the new name — on its row in the list (read again too, the old name gone), in RackUpdate's
//            answer, and on the rack's own page (the header under the code, and its Info section); the code stays a-01-1.
//   4 (empty rack — d-04-1) → delete rack, through the row's own bin (delete-rack-d-04-1 → the "Delete Rack" confirm)
//      then: rack gone from the list — RackDelete 200, the row gone, also when the list is read again;
//      then: its code can be used again — "D-04-1" created anew through the dialog: RackCreate 200 with code d-04-1 and
//            a NEW id (not the deleted rack back), listed, empty (codes are unique among UNDELETED racks,
//            one-shelf-row-per-product-per-placement; the delete is soft, a-placement-deletes-at-zero-stock).
//   5 (rack holds 5 units — d-05-1) → delete rack
//      then: delete refused, message says to move the stock off first — RackDelete under the role's token answers
//            failed_precondition with that message, the screen's error toast says it, and the rack, read again, is still
//            listed with its 5 units (a-placement-deletes-at-zero-stock).
//   6 (rack in a running opname — d-06-1) → delete rack
//      then: delete refused — failed_precondition, the error toast, the rack still listed (a-rack-a-count-holds-cannot-be-
//            deleted). The rack itself is EMPTY, so nothing but the count stands in the way: the warehouse's count is
//            plan `all`, which visits every rack (an-all-count-visits-every-rack); regression: the refusal names it.
//
// The ground (root, once): per role a warehouse and a person of that role in it; in the owner's and the admin's, rack
// A-02-1 (given 2's "already used"). Given 3 gets a second warehouse per setter (and a person of that role in it) holding
// rack a-01-1 under an old name, so it never leans on given 1's rack having been made first. Givens 4 and 5 share a third
// warehouse per setter (empty d-04-1; d-05-1 holding 5 units of a product of its own — a restock from the spec's selling
// team, accepted onto it); given 6 a fourth (empty d-06-1, d-06-2 holding 2 units, and an `all` count root started), so
// the count locks nothing another given reads.

const PASSWORD = "e2e-rack-setup-pass-1";
const SETTERS = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
] as const;
const STAFF = { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" } as const;
const ALL = [...SETTERS, STAFF];
// Given 3's people: the same two roles, each in a warehouse of its own (key "owne" / "adme").
const EDITORS = SETTERS.map((r) => ({ ...r, key: `${r.key}e` }));
// Givens 4 and 5's people (one warehouse each, "ownd" / "admd"), and given 6's (a warehouse with a running count each,
// "ownc" / "admc").
const DELETERS = SETTERS.map((r) => ({ ...r, key: `${r.key}d` }));
const COUNTED = SETTERS.map((r) => ({ ...r, key: `${r.key}c` }));
type Key = string;

// Each given's case text, verbatim from placement.md — the marking script finds the tests by it.
const C1 = 'code "A-01-1" · no name';
const C2 = "code already used in this warehouse";
const C7 = 'code "A-01-2"';
const C3 = "rack a-01-1 · name changed";
const C4 = "empty rack";
const C5 = "rack holds 5 units";
const C6 = "rack in a running opname";

const USED = "A-02-1";
const OLD_NAME = "Rak lama dekat tangga";
const NEW_NAME = "Rak baru dekat pintu";

// A username is lowercase letters and digits only.
const username = (key: Key) => `e2erksetup${key}${SUFFIX}`;

const ground = {
  warehouses: {} as Record<Key, string>,
  // Given 4's rack, as root made it — the id a re-created d-04-1 must NOT have.
  emptyRack: {} as Record<Key, string>,
  // Given 6's running count, per warehouse.
  counts: {} as Record<Key, string>,
};

// A rack delete through the row's own bin and its confirm; the RackDelete answer it sent (status and body).
async function deleteOnRow(page: Page, code: string) {
  await page.getByTestId(`delete-rack-${code}`).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete Rack" });
  await expect(confirm).toBeVisible();
  const answer = page.waitForResponse((r) => r.url().includes("/warehouse.inventory.v1.RackService/RackDelete"));
  await confirm.getByTestId("confirm-action").click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  return { status: res.status(), json };
}

const errorToast = (page: Page) => page.locator('[data-scope="toast"][data-part="root"][data-type="error"]');

// Work in the role's warehouse: the active team is per tab, in sessionStorage (TeamContext).
async function asRole(page: Page, key: Key) {
  await login(page, username(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.warehouses[key]);
}

async function gotoRacks(page: Page) {
  await page.goto("/inventories/racks");
  await expect(page.getByTestId("racks-table").or(page.getByTestId("racks-empty"))).toBeVisible();
}

// A call that may be refused — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// Fill the dialog with a code (no name, no description) and press Create; the RackCreate answer it sent.
async function createInDialog(page: Page, code: string) {
  await page.getByTestId("open-create-rack").click();
  await expect(page.getByTestId("rack-form")).toBeVisible();
  await page.getByTestId("rack-code").fill(code);
  const answer = page.waitForResponse((r) => r.url().includes("/warehouse.inventory.v1.RackService/RackCreate"));
  await page.getByTestId("submit-rack").click();
  return answer;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of ALL) {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Rak Setup ${r.key} ${SUFFIX}`,
      teamCode: `RSU${r.key[0]!.toUpperCase()}${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    ground.warehouses[r.key] = String(team.team.id);

    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouses[r.key],
      username: username(r.key),
      password: PASSWORD,
      name: `Rak Setup ${r.given} ${SUFFIX}`,
      role: r.role,
    });
  }

  // GIVEN (2) — the code already used, in each setter's warehouse.
  for (const r of SETTERS) {
    await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouses[r.key], code: USED });
  }

  // GIVEN (3) — rack a-01-1 under its old name, in a warehouse of each setter's own.
  for (const r of EDITORS) {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Rak Edit ${r.key} ${SUFFIX}`,
      teamCode: `RSE${r.key[0]!.toUpperCase()}${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    ground.warehouses[r.key] = String(team.team.id);

    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouses[r.key],
      username: username(r.key),
      password: PASSWORD,
      name: `Rak Edit ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    await api(page, "inventory.v1.RackService/RackCreate", {
      teamId: ground.warehouses[r.key],
      code: "A-01-1",
      name: OLD_NAME,
    });
  }

  // GIVENS 4–6 — the goods' owner: a selling team, a category, and the operational account its restocks are paid from
  // (a-restock-names-its-paying-account).
  const seller = String(
    (
      await api(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Rak Delete Seller ${SUFFIX}`,
        teamCode: `RSDV${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rak Delete ${SUFFIX}` });
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E rak delete restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RKDEL-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });

  // A warehouse of the given's own, a person of the role in it, and its racks by code → id.
  const warehouseFor = async (r: { given: string; role: string; key: Key }, prefix: string, label: string) => {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Rak ${label} ${r.key} ${SUFFIX}`,
      teamCode: `${prefix}${r.key[0]!.toUpperCase()}${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    ground.warehouses[r.key] = String(team.team.id);
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouses[r.key],
      username: username(r.key),
      password: PASSWORD,
      name: `Rak ${label} ${r.given} ${SUFFIX}`,
      role: r.role,
    });
  };
  const rack = async (key: Key, code: string) =>
    String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouses[key], code })).rack.id);
  // `count` units of a product of its own on the rack: a restock from the seller, accepted onto it.
  const putOn = async (key: Key, rackId: string, tag: string, count: number) => {
    const created = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: seller,
      productCodePart: `RSD${tag}${SUFFIX}`,
      name: `Barang Rak ${tag} ${SUFFIX}`,
      categoryId: category.category.id,
    });
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: seller,
      warehouseId: ground.warehouses[key],
      financeAccountId: account,
      items: [
        {
          productId: created.product.id,
          productCode: created.product.productCode,
          name: `Barang Rak ${tag} ${SUFFIX}`,
          count,
          total: count * 10_000,
        },
      ],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouses[key],
      requestId: restock.request.id,
      lines: [
        {
          itemId: (restock.request.items as { id: string }[])[0]!.id,
          receivedCount: count,
          placements: [{ placementId: rackId, quantity: count }],
        },
      ],
    });
  };

  // GIVENS 4 and 5 — an empty rack, and a rack holding 5 units.
  for (const r of DELETERS) {
    await warehouseFor(r, "RSD", "Delete");
    ground.emptyRack[r.key] = await rack(r.key, "D-04-1");
    await putOn(r.key, await rack(r.key, "D-05-1"), `${r.key[0]!.toUpperCase()}5`, 5);
  }

  // GIVEN 6 — an empty rack in a running opname: 2 units on its neighbour (a count needs something to count), then a
  // count of the whole warehouse, which visits every rack.
  for (const r of COUNTED) {
    await warehouseFor(r, "RSC", "Count");
    await rack(r.key, "D-06-1");
    await putOn(r.key, await rack(r.key, "D-06-2"), `${r.key[0]!.toUpperCase()}6`, 2);
    const session = await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", {
      teamId: ground.warehouses[r.key],
      plan: "OPNAME_PLAN_ALL",
    });
    ground.counts[r.key] = String(session.session.id);
  }

  await page.close();
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C1})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} create rack (${C1})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);

      // WHEN — create rack: code "A-01-1", nothing else.
      const answer = await createInDialog(page, "A-01-1");
      expect(answer.status()).toBe(200);
      const created = (await answer.json()) as { rack?: { code?: string; name?: string } };
      await expect(page.getByTestId("rack-form")).toBeHidden();

      const row = page.getByTestId("rack-row-a-01-1");

      await test.step('then: rack listed as "a-01-1"', async () => {
        await expect.soft(row).toBeVisible();
        // The code cell reads the code as saved — never as typed.
        await expect.soft(row.getByRole("cell").first()).toContainText("a-01-1");
        await expect.soft(row).not.toContainText("A-01-1");
        await expect.soft(page.getByTestId("rack-row-A-01-1")).toHaveCount(0);
        expect.soft(created.rack?.code).toBe("a-01-1");
        // No name: the name cell is blank.
        await expect.soft(row.getByRole("cell").nth(1)).toHaveText("");
        expect.soft(created.rack?.name ?? "").toBe("");

        // And it stays listed when the list is read again.
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-a-01-1")).toBeVisible();
      });

      await test.step('then: "empty" on its row', async () => {
        await expect.soft(row.getByTestId("rack-empty-a-01-1")).toBeVisible();
        await expect.soft(row.getByTestId("rack-empty-a-01-1")).toHaveText(/^empty$/i);
        await expect.soft(row.getByTestId("rack-products-a-01-1")).toHaveText("0");
        await expect.soft(row.getByTestId("rack-stock-a-01-1")).toHaveText("0");
      });
    });
  }
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C2})`, () => {
  for (const r of SETTERS) {
    test(`${r.given} create rack (${C2})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);
      // GIVEN — the code is already on a rack here.
      await expect(page.getByTestId("rack-row-a-02-1")).toBeVisible();

      // WHEN — create rack with that code.
      const answer = await createInDialog(page, USED);

      await test.step("then: cannot create rack", async () => {
        expect.soft(answer.status()).not.toBe(200);
        // The dialog stays, with what was typed — nothing was made.
        await expect.soft(page.getByTestId("rack-form")).toBeVisible();
        await expect.soft(page.getByTestId("rack-code")).toHaveValue(USED);

        // The contract, under the role's own token: refused as a duplicate.
        const again = await send(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouses[r.key], code: USED });
        expect.soft(again.status).not.toBe(200);
        expect.soft(again.json.code).toBe("already_exists");
      });

      await test.step("then: message says the code already exists", async () => {
        const error = page.getByTestId("rack-form-error");
        await expect.soft(error).toBeVisible();
        await expect.soft(error).toContainText(/already exists/i);
        await expect.soft(error).toContainText(USED);
      });

      await test.step("regression: the list still holds the one a-02-1", async () => {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("rack-form")).toBeHidden();
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-a-02-1")).toHaveCount(1);
      });
    });
  }
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C3})`, () => {
  for (const r of EDITORS) {
    test(`${r.given} edit rack (${C3})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);

      // GIVEN — rack a-01-1, under its old name.
      const row = page.getByTestId("rack-row-a-01-1");
      await expect(row).toBeVisible();
      await expect(row.getByRole("cell").nth(1)).toHaveText(OLD_NAME);

      // WHEN — edit rack: the row's pencil, the name changed, Save.
      await page.getByTestId("edit-rack-a-01-1").click();
      await expect(page.getByTestId("rack-form")).toBeVisible();
      await expect(page.getByTestId("rack-name")).toHaveValue(OLD_NAME);
      await expect(page.getByTestId("rack-code")).toHaveValue("a-01-1");
      await page.getByTestId("rack-name").fill(NEW_NAME);
      const answer = page.waitForResponse((res) => res.url().includes("/warehouse.inventory.v1.RackService/RackUpdate"));
      await page.getByTestId("submit-rack").click();
      const updated = await answer;
      expect(updated.status()).toBe(200);
      const saved = (await updated.json()) as { rack?: { id?: string; code?: string; name?: string } };
      await expect(page.getByTestId("rack-form")).toBeHidden();

      await test.step("then: rack shows the new name", async () => {
        // On its row in the list — the new name, never the old.
        await expect.soft(row.getByRole("cell").nth(1)).toHaveText(NEW_NAME);
        await expect.soft(row).not.toContainText(OLD_NAME);
        expect.soft(saved.rack?.name).toBe(NEW_NAME);

        // Still so when the list is read again.
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-a-01-1").getByRole("cell").nth(1)).toHaveText(NEW_NAME);
        await expect.soft(page.getByTestId("rack-row-a-01-1")).not.toContainText(OLD_NAME);

        // And on the rack's own page: the header under the code, and its Info section.
        await page.getByTestId("rack-row-a-01-1").click();
        await expect.soft(page).toHaveURL(new RegExp(`/inventories/racks/${saved.rack?.id ?? "\\d+"}(\\?|$)`));
        await expect.soft(page.getByTestId("rack-detail-name")).toHaveText(NEW_NAME);
        await expect.soft(page.getByTestId("rack-info-name")).toHaveText(NEW_NAME);
      });

      await test.step("regression: only the name changed — the code stays a-01-1", async () => {
        expect.soft(saved.rack?.code).toBe("a-01-1");
        await expect.soft(page.getByTestId("rack-detail-code")).toHaveText("a-01-1");
        await expect.soft(page.getByTestId("rack-info-code")).toHaveText("a-01-1");
      });
    });
  }
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C4})`, () => {
  for (const r of DELETERS) {
    test(`${r.given} delete rack (${C4})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);

      // GIVEN — an empty rack: listed, "empty" on its row.
      const row = page.getByTestId("rack-row-d-04-1");
      await expect(row).toBeVisible();
      await expect(page.getByTestId("rack-empty-d-04-1")).toBeVisible();

      // WHEN — delete rack: the row's bin, then Delete in the confirm.
      const deleted = await deleteOnRow(page, "d-04-1");
      expect(deleted.status).toBe(200);

      await test.step("then: rack gone from the list", async () => {
        await expect.soft(row).toHaveCount(0);
        // Still gone when the list is read again — and only it: its neighbour stays.
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-d-04-1")).toHaveCount(0);
        await expect.soft(page.getByTestId("rack-row-d-05-1")).toBeVisible();
      });

      await test.step("then: its code can be used again", async () => {
        const made = await createInDialog(page, "D-04-1");
        expect.soft(made.status()).toBe(200);
        const created = (await made.json()) as { rack?: { id?: string; code?: string } };
        expect.soft(created.rack?.code).toBe("d-04-1");
        // A NEW rack under the old code — not the deleted one brought back.
        expect.soft(created.rack?.id).toBeTruthy();
        expect.soft(String(created.rack?.id)).not.toBe(ground.emptyRack[r.key]);
        await expect.soft(page.getByTestId("rack-form")).toBeHidden();
        await expect.soft(page.getByTestId("rack-row-d-04-1")).toHaveCount(1);
        await expect.soft(page.getByTestId("rack-empty-d-04-1")).toBeVisible();

        // And it stays listed when the list is read again.
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-d-04-1")).toHaveCount(1);
      });
    });
  }
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C5})`, () => {
  for (const r of DELETERS) {
    test(`${r.given} delete rack (${C5})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);

      // GIVEN — the rack holds 5 units.
      await expect(page.getByTestId("rack-row-d-05-1")).toBeVisible();
      await expect(page.getByTestId("rack-stock-d-05-1")).toHaveText("5");
      await expect(page.getByTestId("rack-empty-d-05-1")).toHaveCount(0);

      // WHEN — delete rack.
      const refused = await deleteOnRow(page, "d-05-1");

      await test.step("then: delete refused, message says to move the stock off first", async () => {
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");
        // The message: the rack still holds stock — move it off first.
        expect.soft(refused.json.message ?? "").toMatch(/stock/i);
        expect.soft(refused.json.message ?? "").toMatch(/\bmove\b.*\boff\b.*\bfirst\b/i);
        // The screen says it, in the error toast.
        const toast = errorToast(page);
        await expect.soft(toast).toBeVisible();
        await expect.soft(toast).toContainText(/\bmove\b.*\boff\b.*\bfirst\b/i);

        // The rack stays, its 5 units on it — read again.
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-d-05-1")).toBeVisible();
        await expect.soft(page.getByTestId("rack-stock-d-05-1")).toHaveText("5");
      });
    });
  }
});

test.describe(`warehouse:owner · warehouse:admin wants to set up the racks (${C6})`, () => {
  for (const r of COUNTED) {
    test(`${r.given} delete rack (${C6})`, async ({ page }) => {
      await asRole(page, r.key);
      await gotoRacks(page);

      // GIVEN — the rack is in the warehouse's running count (plan `all`, every rack); the rack itself is empty, so only
      // the count stands in the way of its delete.
      await expect(page.getByTestId("rack-row-d-06-1")).toBeVisible();
      await expect(page.getByTestId("rack-empty-d-06-1")).toBeVisible();

      // WHEN — delete rack.
      const refused = await deleteOnRow(page, "d-06-1");
      const toast = errorToast(page);

      await test.step("then: delete refused", async () => {
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");
        await expect.soft(toast).toBeVisible();
        await expect.soft(page.getByTestId("rack-row-d-06-1")).toBeVisible();
      });

      await test.step("regression: the refusal names the count holding the rack", async () => {
        expect.soft(refused.json.message ?? "").toContain(`count #${ground.counts[r.key]}`);
        await expect.soft(toast).toContainText(`count #${ground.counts[r.key]}`);
      });

      await test.step("regression: the rack is still listed when the list is read again", async () => {
        await gotoRacks(page);
        await expect.soft(page.getByTestId("rack-row-d-06-1")).toBeVisible();
      });
    });
  }
});

test.describe(`warehouse:staff wants to set up the racks (${C7})`, () => {
  test(`${STAFF.given} create rack (${C7})`, async ({ page }) => {
    await asRole(page, STAFF.key);
    await gotoRacks(page);

    // WHEN — create rack "A-01-2": through the page's dialog when the page offers it, and as a call under the staff's own
    // token either way.
    const offered = await page.getByTestId("open-create-rack").isVisible();
    let screenStatus: number | undefined;
    if (offered) {
      const answer = await createInDialog(page, "A-01-2");
      screenStatus = answer.status();
    }
    const direct = await send(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouses[STAFF.key], code: "A-01-2" });

    await test.step("then: cannot create rack", async () => {
      if (offered) {
        expect.soft(screenStatus).not.toBe(200);
        // The dialog says it was refused, and stays.
        await expect.soft(page.getByTestId("rack-form-error")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("rack-form")).toBeHidden();
      }
      expect.soft(direct.status).not.toBe(200);
      expect.soft(direct.json.code).toBe("permission_denied");

      // The list, read again by the staff, holds no such rack.
      await gotoRacks(page);
      await expect.soft(page.getByTestId("rack-row-a-01-2")).toHaveCount(0);
      await expect.soft(page.getByTestId("rack-row-A-01-2")).toHaveCount(0);
    });
  });
});
