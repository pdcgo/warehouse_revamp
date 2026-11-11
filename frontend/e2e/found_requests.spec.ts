import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// FOUND STOCK, end to end on the real server (an-adjust-found-waits-for-the-owner-or-admin): units found on a rack
// outside a stock count are reported on the Adjust dialog and POST NOTHING — the shelf still reads what it read. The
// person who reported them cannot approve them (nobody-finalizes-their-own-count); another Owner approves, the `found`
// transaction posts, and the product's stock goes up on the rack it was found on. The menu carries the waiting count
// to the deciders (found-stock-sits-after-stock-opname-with-its-count).
//
// The Adjust dialog is opened from the batch page. The warehouse product page (/inventories/products/:id) once answered
// permission_denied to every warehouse role — it reads StockCost, whose policy was the selling roles' only; a test here
// opens it as the warehouse's Admin and Staff. The last one opens the warehouse's Products — what it holds — as the Admin.
//
// A warehouse of its own: Kaos Temuan, 10 units on Rak A at Rp 10.000 — nothing lost, so the found mints 2 at the
// team's newest price here.

const SUFFIX = Date.now().toString().slice(-6);
const ADMIN = `e2efoundadmin${SUFFIX}`;
const OWNER = `e2efoundowner${SUFFIX}`;
const STAFF = `e2efoundstaff${SUFFIX}`;
const PASSWORD = "e2epassword1";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

async function rpcError(page: Page, method: string, body: unknown): Promise<string> {
  try {
    await rpc(page, method, body);
  } catch (err) {
    return String(err);
  }

  return "";
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = { warehouse: "", rakA: "", kaos: "", code: "", batch: "", request: "" };

// What Rak A says it holds of Kaos Temuan.
async function onHandOnRack(page: Page): Promise<string> {
  await page.goto(`/inventories/racks/${state.rakA}`);
  const cell = page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.kaos}`);
  await expect(cell).toBeVisible();

  return (await cell.innerText()).trim();
}

test.describe.configure({ mode: "serial" });

test("Found: a warehouse with stock, its Admin and a second Owner", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const wh = await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
    name: `E2E Found WH ${SUFFIX}`,
    teamCode: `FW${SUFFIX}`,
    type: "TEAM_TYPE_WAREHOUSE",
    ownerUserId: "1",
  });
  state.warehouse = wh.team.id;

  state.rakA = (
    await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
      teamId: state.warehouse,
      code: `fnd-a-${SUFFIX}`,
    })
  ).rack.id;

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Found ${SUFFIX}`,
  });
  const created = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: "1",
    productCodePart: `FK${SUFFIX}`,
    name: "Kaos Temuan",
    categoryId: category.category.id,
  });
  state.kaos = created.product.id;
  state.code = created.product.productCode;

  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E found ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-FND-${SUFFIX}`,
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  // The restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account) — the server refuses any other.
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: account.account.id,
    operational: true,
  });

  const restock = await rpc<{ request: { id: string; items: { id: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: "1",
      warehouseId: state.warehouse,
      financeAccountId: account.account.id,
      items: [{ productId: state.kaos, productCode: state.code, name: "Kaos Temuan", count: 10, total: 100000 }],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: state.rakA, quantity: 10 }] }],
  });

  for (const [username, role] of [
    [ADMIN, "ROLE_WAREHOUSE_ADMIN"],
    [OWNER, "ROLE_WAREHOUSE_OWNER"],
    [STAFF, "ROLE_WAREHOUSE_STAFF"],
  ] as const) {
    await rpc(page, "user.v1.UserService/CreateUser", { teamId: state.warehouse, username, password: PASSWORD, name: username, role });
  }
});

test("Found: the Admin reports two units on the Adjust dialog — nothing posts, and they cannot approve their own", async ({
  page,
}) => {
  await login(page, ADMIN, PASSWORD);
  await useTeam(page, state.warehouse);

  await expect.poll(() => onHandOnRack(page)).toBe("10");

  const batches = await rpc<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.warehouse,
    filter: { productId: state.kaos },
    page: { page: 1, limit: 5 },
  });
  expect(batches.ids).toHaveLength(1);
  state.batch = batches.ids[0];

  await page.goto(`/inventories/batches/${state.batch}`);
  await expect(page.getByTestId("batch-detail-adjust")).toBeEnabled();
  await page.getByTestId("batch-detail-adjust").click();
  const dialog = page.getByTestId("adjust-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("rack-select").click();
  await dialog.getByTestId(`rack-select-option-${state.rakA}`).click();
  // The reason is a radio pill, every one on screen (the-adjust-reason-is-a-radio-pill).
  await dialog.getByTestId("adjust-reason-option-found").click();
  await expect(dialog.getByTestId("adjust-found-waits")).toContainText("Stock changes once another Owner or Admin");
  await expect(dialog.getByTestId("adjust-batch")).toHaveCount(0);
  await dialog.getByTestId("adjust-amount").fill("2");
  await dialog.getByTestId("adjust-reason").fill("behind the cartons");
  await dialog.getByTestId("submit-adjust").click();
  await expect(dialog).toBeHidden();

  // Nothing posted: the shelf still reads 10, and the product has still one batch.
  await expect.poll(() => onHandOnRack(page)).toBe("10");
  const still = await rpc<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.warehouse,
    filter: { productId: state.kaos },
    page: { page: 1, limit: 5 },
  });
  expect(still.ids).toHaveLength(1);

  const list = await rpc<{ ids: string[] }>(page, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: state.warehouse,
    filter: { status: "FOUND_REQUEST_STATUS_WAITING" },
    page: { page: 1, limit: 5 },
  });
  expect(list.ids).toHaveLength(1);
  state.request = list.ids[0];

  // The menu carries the one waiting, beside Stock Opname; the page says why this Admin may not approve it.
  await page.goto("/inventories/found-stock");
  await expect(page.getByTestId("found-requests-page")).toBeVisible();
  await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");
  // One request a row (the-found-list-is-a-table): what was found is its own cell.
  await expect(page.getByTestId(`found-request-units-${state.request}`)).toContainText("2 units");
  await expect(page.getByTestId(`found-request-approve-${state.request}`)).toBeDisabled();
  await expect(page.getByTestId(`found-request-block-${state.request}`)).toContainText("You reported it");
  await expect(page.getByTestId(`found-request-reject-${state.request}`)).toHaveText("Withdraw");

  // …and the server refuses it whatever the screen offers.
  const refused = await rpcError(page, "inventory.v1.FoundRequestService/FoundRequestApprove", {
    teamId: state.warehouse,
    foundRequestId: state.request,
  });
  expect(refused).toContain("you reported this found");
});

test("Found: a second Owner approves — the found posts and the product's stock goes up", async ({ page }) => {
  await login(page, OWNER, PASSWORD);
  await useTeam(page, state.warehouse);

  await page.goto("/inventories/found-stock");
  await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveText("1");
  const approve = page.getByTestId(`found-request-approve-${state.request}`);
  await expect(approve).toBeEnabled();
  await expect(page.getByTestId(`found-request-minted-${state.request}`)).toContainText("Rp 20.000");
  await approve.click();
  await page.getByRole("alertdialog").getByTestId("confirm-action").click();

  // Off the waiting list, and off the menu's count — a 0 is never drawn.
  await expect(page.getByTestId(`found-request-${state.request}`)).toHaveCount(0);
  await expect(page.getByTestId("nav-count-/inventories/found-stock")).toHaveCount(0);

  // The rack they were found on holds them; the batch ledger moved the same two — a new batch of 2 at Rp 10.000.
  await expect.poll(() => onHandOnRack(page)).toBe("12");
  const after = await rpc<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.warehouse,
    filter: { productId: state.kaos },
    page: { page: 1, limit: 5 },
  });
  expect(after.ids).toHaveLength(2);

  const done = await rpc<{ items: { request?: { mapData: Record<string, { status: string; transactionId: string }> } }[] }>(
    page,
    "inventory.v1.FoundRequestService/FoundRequestList",
    { teamId: state.warehouse, filter: { status: "FOUND_REQUEST_STATUS_APPROVED" }, page: { page: 1, limit: 5 } },
  );
  const approved = Object.values(done.items.find((i) => i.request)?.request?.mapData ?? {});
  expect(approved).toHaveLength(1);
  expect(approved[0].transactionId).not.toBe("0");
});

// STAFF REPORT FROM THE SHELF (staff-may-report-a-found): a warehouse Staff opens Rak A, presses Report Found, finds the
// product by name and sends it — the request waits. On the real server, so the picker's own read must admit staff.
test("Found: staff report from the rack page, and the picker finds the product", async ({ page }) => {
  await login(page, STAFF, PASSWORD);
  await useTeam(page, state.warehouse);

  await page.goto(`/inventories/racks/${state.rakA}`);
  await page.getByTestId("rack-action-report-found").click();
  const dialog = page.getByTestId("report-found-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").click();
  await dialog.getByRole("combobox").pressSequentially("Kaos Tem", { delay: 30 });
  await expect(dialog.getByTestId(`product-select-option-${state.code}`)).toBeVisible();
  await dialog.getByTestId(`product-select-option-${state.code}`).click();
  await dialog.getByTestId("report-found-amount").fill("1");
  await dialog.getByTestId("report-found-submit").click();
  await expect(dialog).toBeHidden();

  const mine = await rpc<{ ids: string[] }>(page, "inventory.v1.FoundRequestService/FoundRequestList", {
    teamId: state.warehouse,
    filter: { status: "FOUND_REQUEST_STATUS_WAITING" },
    page: { page: 1, limit: 5 },
  });
  expect(mine.ids).toHaveLength(1);
});

// THE WAREHOUSE PRODUCT PAGE OPENS FOR THE WAREHOUSE: it reads StockCost, whose policy now admits the warehouse roles
// (their own building only). The Admin sees the page and its Adjust; staff see the page.
test("Found: the warehouse product page opens for the warehouse's Admin and Staff", async ({ page }) => {
  for (const [username, adjusts] of [
    [ADMIN, true],
    [STAFF, false],
  ] as const) {
    await login(page, username, PASSWORD);
    await useTeam(page, state.warehouse);

    await page.goto(`/inventories/products/${state.kaos}`);
    await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
    await expect(page.getByTestId("warehouse-product-error")).toHaveCount(0);

    if (adjusts) {
      await expect(page.getByTestId("wp-action-adjust")).toBeVisible();
    }
  }
});

// A WAREHOUSE'S PRODUCTS IS WHAT IT HOLDS (a-warehouses-products-is-what-it-holds — the list is
// the-stock-screen-lists-what-the-warehouse-has-held): the warehouse's Admin opens Products and finds Kaos Temuan — another
// team's product — with its owner NAMED and the 12 units the approved found brought it to. A row opens the warehouse
// product page, and the old Inventories ▸ Stock address forwards to Products. Products once listed what the warehouse was
// ASKED to hold, with the seller's columns read as "—" and the owner as "Team #1"; the Stock screen before it read "No
// products in this warehouse's catalogue" — it listed the warehouse TEAM's own products, and a warehouse owns none.
test("Found: the warehouse Admin's Products lists Kaos Temuan with its owner and on-hand, and opens it", async ({ page }) => {
  await login(page, ADMIN, PASSWORD);
  await useTeam(page, state.warehouse);

  await page.goto("/products");
  await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
  const row = page.getByTestId(`stock-row-${state.code}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Kaos Temuan");
  await expect(page.getByTestId(`stock-onhand-${state.code}`)).toHaveText("12");
  const owner = page.getByTestId(`stock-owner-${state.code}`);
  await expect(owner).not.toBeEmpty();
  await expect(owner).not.toContainText("Team #");
  await expect(page.getByTestId("inventory-error")).toHaveCount(0);

  // The seller's catalogue is not the warehouse's view: no Cross markup, no Lock, no catalogue table.
  await expect(page.getByTestId("products-table")).toHaveCount(0);
  await expect(page.getByTestId(`cross-${state.code}`)).toHaveCount(0);
  await expect(page.getByTestId(`lock-${state.code}`)).toHaveCount(0);

  // The search runs on the server: a word nothing here carries empties the list, the product's name finds it again.
  await page.getByTestId("inventory-search").fill("zzzz");
  await expect(page.getByTestId("inventory-none-match")).toBeVisible();
  await page.getByTestId("inventory-search").fill("kaos tem");
  await expect(row).toBeVisible();

  // A row opens the warehouse product page — this product's stock in this building.
  await page.getByTestId(`stock-row-${state.code}`).getByText("Kaos Temuan").click();
  await expect(page).toHaveURL(new RegExp(`/inventories/products/${state.kaos}$`));
  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
  await expect(page.getByTestId("warehouse-product-error")).toHaveCount(0);

  // The old Stock address forwards to Products, the search with it.
  await page.goto("/inventories/stock?q=kaos");
  await expect(page).toHaveURL(/\/products\?q=kaos$/);
  await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
  await expect(row).toBeVisible();
});
