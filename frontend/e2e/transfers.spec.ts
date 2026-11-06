import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// THE WAREHOUSE TRANSFER, END TO END (docs/business/inventory/warehouse_transfer.md) — the selling team moves its own
// stock from warehouse A to warehouse B: it opens the transfer on the form with a shipping cost paid from an operational
// account, A processes and ships it, and B counts it in with a courier's charge at the door.
//
// What it proves, beyond each screen:
//   · the stock MOVED — off A's rack, onto B's;
//   · the paying account went down by the shipping cost (a-transfers-shipping-posts-as-an-expense) — posted by
//     financial_account's listener from the transfer's event, so POLLED;
//   · the team balance shows the courier's charge as owed to B (the transfer fee) — posted by liability's listener from
//     the accept's event, so POLLED.
//
// ⚠ NAMED TO SORT AFTER orders.spec.ts AND statement.spec.ts. The suite shares one database, orders.spec asserts the
// orders screen starts empty and counts stages over every team root can read; nothing here places an order, but the
// spec stays clear of that window anyway.
//
// Team 1 (root) plays the selling team that owns the goods; root owns both warehouses, so the team switch reaches each
// side. Every RPC seed goes through the real contract.

const SUFFIX = Date.now().toString().slice(-6);
const SKU = `TRF${SUFFIX}`;
const SHIPPING = 20_000;
const COURIER = 15_000;
const SENT = 4;
const STOCKED = 10;

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

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

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = {
  whA: "",
  whB: "",
  codeA: `TA${SUFFIX}`,
  codeB: `TB${SUFFIX}`,
  rackA: "",
  rackB: "",
  product: "",
  account: "",
  transfer: "",
};

// What a rack says it holds of the product, read off its own page as that warehouse.
async function onRack(page: Page, warehouse: string, rack: string): Promise<string> {
  await useTeam(page, warehouse);
  await page.goto(`/inventories/racks/${rack}`);
  const cell = page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`);
  await expect(cell).toBeVisible();

  return (await cell.innerText()).trim();
}

test.describe.configure({ mode: "serial" });

test("Transfer: two warehouses, stock at A, and an operational account to pay the trip", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const warehouse = async (code: string, name: string) =>
    (
      await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
        name,
        teamCode: code,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id;
  state.whA = await warehouse(state.codeA, `E2E Transfer A ${SUFFIX}`);
  state.whB = await warehouse(state.codeB, `E2E Transfer B ${SUFFIX}`);

  const rack = async (teamId: string, code: string) =>
    (await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", { teamId, code, name: code })).rack
      .id;
  state.rackA = await rack(state.whA, "e2e-trf-a");
  state.rackB = await rack(state.whB, "e2e-trf-b");

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Transfer ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: "1",
    productCodePart: SKU,
    name: "Kaos Pindah",
    categoryId: category.category.id,
  });
  state.product = product.product.id;

  // The account that pays the trip — OPERATIONAL (the form's Paid from offers only those). Opened at the shipping cost,
  // so it ends at 0 and root's team total is where it started for every spec that reads it.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E transfer ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-TRF-${SUFFIX}`,
    openingBalance: SHIPPING,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  state.account = account.account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: state.account,
    operational: true,
  });

  // Stock at A: a restock of ten at Rp 0, counted in onto A's rack. Rp 0 and no freight, so it moves no money.
  const restock = await rpc<{ request: { id: string; items: { id: string; count: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: "1",
      warehouseId: state.whA,
      financeAccountId: state.account,
      items: [{ productId: state.product, productCode: product.product.productCode, name: "Kaos Pindah", count: STOCKED, total: 0 }],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.whA,
    requestId: restock.request.id,
    lines: restock.request.items.map((item) => ({
      itemId: item.id,
      receivedCount: item.count,
      placements: [{ placementId: state.rackA, quantity: item.count }],
    })),
  });

  expect(await onRack(page, state.whA, state.rackA)).toBe(String(STOCKED));
});

test("Transfer: the team opens it on the form, paying the trip from the operational account", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, "1");

  await page.goto("/inventories/transfer/new");
  await expect(page.getByTestId("transfer-form")).toBeVisible();

  // Both pickers list warehouses, so an option's testid is on the page twice — the open list's is the visible one.
  const option = (code: string) => page.locator(`[data-testid="team-select-option-${code}"]:visible`);
  await page.getByTestId("transfer-form-from").locator("input").fill(state.codeA);
  await option(state.codeA).click();
  await page.getByTestId("transfer-form-to").locator("input").fill(state.codeB);
  await option(state.codeB).click();

  await page.getByTestId("transfer-form-pick").click();
  await page.getByTestId(`product-picker-option-${state.product}`).click();
  await page.getByTestId("product-picker-confirm").click();
  await expect(page.getByTestId(`transfer-form-available-${state.product}`)).toContainText(String(STOCKED));
  await page.getByTestId(`transfer-form-count-${state.product}`).fill(String(SENT));

  await page.getByTestId("transfer-form-cost").fill(String(SHIPPING));
  await page.getByTestId("transfer-form-account").click();
  await page.getByTestId(`transfer-form-account-option-${state.account}`).click();

  await expect(page.getByTestId("transfer-form-submit")).toBeEnabled();
  await page.getByTestId("transfer-form-submit").click();

  await expect(page).toHaveURL(/\/inventories\/transfer\/\d+$/);
  state.transfer = /\/inventories\/transfer\/(\d+)$/.exec(page.url())![1]!;

  const detail = await rpc<{ transfer: { shipmentCost: number; financeAccountId: string; items: { count: string }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: "1", transferId: state.transfer },
  );
  expect(detail.transfer.shipmentCost).toBe(SHIPPING);
  expect(detail.transfer.financeAccountId).toBe(state.account);
  expect(detail.transfer.items[0]!.count).toBe(String(SENT));
});

test("Transfer: A processes and ships it", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.whA);

  await page.goto(`/inventories/transfer/${state.transfer}`);
  await page.getByTestId(`transfer-action-process-${state.transfer}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`transfer-action-ship-${state.transfer}`)).toBeVisible();

  await page.getByTestId(`transfer-action-ship-${state.transfer}`).click();
  await page.getByTestId("transfer-ship-tracking").fill(`JP${SUFFIX}`);
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`transfer-action-ship-${state.transfer}`)).toBeHidden();

  // The goods LEFT A at ship (the outbound leg).
  expect(await onRack(page, state.whA, state.rackA)).toBe(String(STOCKED - SENT));
});

test("Transfer: B counts it in with the courier's charge — the stock is at B", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.whB);

  const detail = await rpc<{ transfer: { items: { id: string }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: state.whB, transferId: state.transfer },
  );
  const item = detail.transfer.items[0]!.id;

  await page.goto(`/inventories/transfer/${state.transfer}/accept`);
  await expect(page.getByTestId("accept-page")).toBeVisible();

  await page.getByTestId(`accept-line-${item}-arrived`).fill(String(SENT));
  const placements = page.getByTestId(`accept-line-${item}-placements`);
  await placements.getByTestId("rack-select").click();
  await page.getByTestId(`rack-select-option-${state.rackB}`).click();
  await page.getByTestId(`accept-line-${item}-placement-0-qty`).fill(String(SENT));

  await page.getByTestId("accept-charge-amount").fill(String(COURIER));
  await page.getByTestId("accept-charge-note").fill("courier at the door");

  await expect(page.getByTestId("accept-submit")).toBeEnabled();
  await page.getByTestId("accept-submit").click();
  await page.getByTestId("confirm-action").click();
  await expect(page).toHaveURL(new RegExp(`/inventories/transfer/${state.transfer}$`));

  expect(await onRack(page, state.whB, state.rackB)).toBe(String(SENT));
  expect(await onRack(page, state.whA, state.rackA)).toBe(String(STOCKED - SENT));
});

// The money travels by event: inventory publishes, the Pub/Sub emulator pushes to the e2e API, the listeners post —
// so both are re-read until they land.
test("Transfer: the paying account dropped by the shipping cost", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, "1");

  await expect(async () => {
    await page.goto(`/financial-accounts/${state.account}`);
    await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0), { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
});

test("Transfer: the team balance shows the transfer fee owed to B", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, "1");

  // Team 1 OWES B the courier's charge B paid at its door — the Payable column of B's row.
  await expect(async () => {
    await page.goto("/liability");
    const row = page.getByTestId(`liability-row-${state.whB}`);
    await expect(row).toContainText(rp(COURIER), { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });

  // A is owed nothing: A paid nothing at its door.
  await expect(page.getByTestId(`liability-row-${state.whA}`)).toHaveCount(0);
});

// every-side-of-a-transfer-opens-its-label-photo — A ships a second transfer WITH a photo of the label (A's own upload,
// an order receipt), and every side opens it through WarehouseTransferLabelPhoto: B's floor STAFF, created here with
// that one role, matching the parcel at its door, and the owning selling team (team 1). A fourth team — a third
// warehouse root owns — is refused NotFound. Nothing is shared: as the document's owner, B still reads NotFound.
test("Transfer: every side opens the label photo, a fourth team is refused", async ({ page }) => {
  const STAFF = `e2etrfstaff${SUFFIX}`;
  const PASSWORD = "e2e-trf-photo-1";

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const requested = await rpc<{ uploadUrl: string; method: string; headers?: Record<string, string>; uploadToken: string }>(
    page,
    "document.v1.DocumentService/RequestUpload",
    {
      teamId: state.whA,
      filename: "transfer-label.png",
      contentType: "image/png",
      sizeBytes: "70",
      resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
    },
  );
  const put = await page.evaluate(
    async ([url, method, headers]) => {
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
        (c) => c.charCodeAt(0),
      );
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: png });
      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}] as const,
  );
  expect(put).toBeLessThan(300);
  const confirmed = await rpc<{ document: { id: string } }>(page, "document.v1.DocumentService/ConfirmUpload", {
    uploadToken: requested.uploadToken,
  });
  const documentId = String(confirmed.document.id);

  // One unit, no cost — it moves no money, so the account and balance checks above stay true.
  const created = await rpc<{ transfer: { id: string } }>(page, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
    teamId: "1",
    fromWarehouseId: state.whA,
    toWarehouseId: state.whB,
    lines: [{ productId: state.product, count: "1" }],
  });
  const transfer = created.transfer.id;
  await rpc(page, "inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: state.whA, transferId: transfer });
  await rpc(page, "inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: state.whA,
    transferId: transfer,
    receipt: `JPH${SUFFIX}`,
    receiptFile: documentId,
  });

  const opensFor = async (teamId: string) => {
    await useTeam(page, teamId);
    await page.goto(`/inventories/transfer/${transfer}`);
    const button = page.getByTestId("transfer-detail-label-photo-open");
    await expect(button).toBeVisible();

    // The link comes from INVENTORY and names A's file. (Headless Chromium's popup never settles, so the answer that
    // minted the link is what is read, beside the tab opening.)
    const [answer, popup] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/warehouse.inventory.v1.WarehouseTransferService/WarehouseTransferLabelPhoto")),
      page.waitForEvent("popup"),
      button.click(),
    ]);
    expect(answer.status()).toBe(200);
    const body = (await answer.json()) as { url: string; expiresAtUnix: string };
    expect(String(body.url)).toContain("transfer-label.png");
    expect(Number(body.expiresAtUnix)).toBeGreaterThan(Date.now() / 1000);
    await popup.close();
  };

  // The owning selling team.
  await opensFor("1");

  // A fourth team: a warehouse that is no side of this transfer.
  const other = await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
    name: `E2E Transfer C ${SUFFIX}`,
    teamCode: `TC${SUFFIX}`,
    type: "TEAM_TYPE_WAREHOUSE",
    ownerUserId: ROOT_USER_ID,
  });
  await expect(
    rpc(page, "inventory.v1.WarehouseTransferService/WarehouseTransferLabelPhoto", { teamId: other.team.id, transferId: transfer }),
  ).rejects.toThrow(/404|not_found/);

  // B's floor staff, with that one role.
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: state.whB,
    username: STAFF,
    password: PASSWORD,
    name: STAFF,
    role: "ROLE_WAREHOUSE_STAFF",
  });
  await login(page, STAFF, PASSWORD);
  await opensFor(state.whB);

  // Never shared: asked as the document's owner, B reads NotFound.
  await expect(
    rpc(page, "document.v1.DocumentService/GetDownloadUrl", { teamId: state.whB, documentId }),
  ).rejects.toThrow(/404|not_found/);
});
