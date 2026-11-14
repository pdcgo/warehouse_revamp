import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE TEAM BALANCE NAMES WHO RECORDED EACH ROW, END TO END (docs/technical/balance/team_balance_design_decision.md —
// the-team-balance-recorded-by-is-accepted, every-entry-names-who-posted-it; docs/business/user/context_decision.md —
// an-override-shows-a-platform-badge) — against the real server and Postgres.
//
// A selling team and a warehouse, BOTH owned by Dewi, root in neither. Dewi counts a restock in at her warehouse and
// pays the courier at the door, so the selling team owes the warehouse the courier's charge — a ledger row Dewi caused.
// Root then pays that debt from INSIDE the selling team and accepts it from INSIDE the warehouse (in by the root-team
// bypass, so the server stamps the payment's record and the posting's legs as overrides). Dewi opens the pair: the
// ledger names her on the courier's row and Root, with the "by Root team" badge, on the payment's; the payment row names
// Root with the badge. Desktop and phone. Root's own team is never touched (financial_accounts.spec checks its totals),
// and no order is placed (orders.spec counts them).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-recorder-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2erecdewi${SUFFIX}`;
const DEWI_NAME = `Dewi Recorder ${SUFFIX}`;
const SKU = `REC${SUFFIX}`;
const COURIER = 15_000;

async function login(page: Page, username = ROOT_USERNAME, password = ROOT_PASSWORD) {
  await signIn(page, username, password);
}

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = any>(page: Page, method: string, body: unknown): Promise<T> {
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
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function openAccount(page: Page, teamId: string, name: string, accountNumber: string) {
  const res = await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name,
    holderName: "PT E2E",
    accountNumber,
    openingBalance: 1_000_000,
    openingOn: today(),
  });

  return String(res.account.id);
}

// The payer's proof, uploaded and shared with the creditor (a-payment-must-carry-proof) — liability.spec's four steps.
async function uploadProof(page: Page, ownerTeam: string, shareWith: string) {
  const requested = await rpc(page, "document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename: "transfer.png",
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });

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

  const confirmed = await rpc(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await rpc(page, "document.v1.DocumentService/ShareDocument", {
    teamId: ownerTeam,
    documentId: confirmed.document.id,
    withTeamId: shareWith,
  });

  return String(confirmed.document.id);
}

// *Restock Accepted* as the broker pushes it to liability's listener — built from the restock the server returned
// (liability.spec's shape): the actor is who counted it in.
function pushRestockAccepted(restock: Record<string, string | number>) {
  const acceptedAt = new Date(Number(restock.acceptedAtUnix) * 1000);
  const event = {
    eventId: `restock-accepted:${restock.id}`,
    occurredAt: acceptedAt.toISOString(),
    aggregateId: `restock:${restock.id}`,
    restockAccepted: {
      restockId: restock.id,
      teamId: restock.requestingTeamId,
      warehouseId: restock.warehouseId,
      acceptedOn: acceptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      acceptedAtUnix: restock.acceptedAtUnix,
      warehouseAdditionalCost: restock.warehouseAdditionalCost,
      warehouseAdditionalCostNote: restock.warehouseAdditionalCostNote,
      actorId: restock.acceptedByUserId,
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.RestockAccepted" },
      messageId: `${event.eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/liability-restock-accepted",
  };
}

const state = {
  dewi: "",
  seller: "",
  warehouse: "",
  rack: "",
  sellerAccount: "",
  warehouseAccount: "",
  restock: {} as { id: string; items: { id: string; count: string }[] },
  payment: "",
};

test.describe.configure({ mode: "serial" });

test("Setup: a selling team and a warehouse owned by Dewi, root in neither, and a restock between them", async ({ page }) => {
  await login(page);

  // TeamCreate names an EXISTING person as the Owner (the-create-team-form-names-the-first-owner), so Dewi's account is
  // made first, in a scratch team of root's — the two teams under test are then hers, and root holds no role in them.
  const scratch = (
    await rpc(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Recorder Scratch ${SUFFIX}`,
      teamCode: `RS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  state.dewi = String(
    (
      await rpc(page, "user.v1.UserService/CreateUser", {
        teamId: scratch,
        username: DEWI,
        password: PASSWORD,
        name: DEWI_NAME,
        role: "ROLE_SELLING_ADMIN",
      })
    ).user.id,
  );

  state.seller = String(
    (
      await rpc(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Recorder Seller ${SUFFIX}`,
        teamCode: `RL${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: state.dewi,
      })
    ).team.id,
  );
  state.warehouse = String(
    (
      await rpc(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Recorder WH ${SUFFIX}`,
        teamCode: `RW${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: state.dewi,
      })
    ).team.id,
  );

  // What a restock needs: a shelf, one of the seller's own products, and the operational account that paid.
  state.rack = String(
    (await rpc(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: "e2e-rec", name: "E2E shelf" }))
      .rack.id,
  );
  const category = await rpc(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Recorder ${SUFFIX}` });
  const product = await rpc(page, "product.v1.ProductService/ProductCreate", {
    teamId: state.seller,
    productCodePart: SKU,
    name: "Widget",
    categoryId: category.category.id,
  });

  state.sellerAccount = await openAccount(page, state.seller, `E2E Recorder BCA ${SUFFIX}`, `78${SUFFIX}01`);
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: state.sellerAccount,
    operational: true,
  });
  state.warehouseAccount = await openAccount(page, state.warehouse, `E2E Recorder WH BCA ${SUFFIX}`, `78${SUFFIX}02`);

  const created = await rpc(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.warehouse,
    financeAccountId: state.sellerAccount,
    items: [{ productId: product.product.id, productCode: SKU, name: "Widget", count: 4, total: 200_000 }],
  });
  state.restock = created.request;
});

// Each person signs in on a fresh page of their own — one test each.
test("Dewi counts the box in and pays the courier at the door — the selling team owes it", async ({ page, request }) => {
  await login(page, DEWI, PASSWORD);

  const accepted = await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: state.restock.id,
    warehouseAdditionalCost: COURIER,
    warehouseAdditionalCostNote: "courier asked at the door",
    lines: state.restock.items.map((item) => ({
      itemId: item.id,
      receivedCount: item.count,
      placements: [{ placementId: state.rack, quantity: item.count }],
    })),
  });
  expect(accepted.request.acceptedByUserId).toBe(state.dewi);

  // Balance posts the courier's charge from *Restock Accepted* (balance-posts-the-couriers-debt-from-the-event) — once,
  // however often it arrives.
  const route = `${API_URL}/event/liability-restock-accepted/push`;
  for (let i = 0; i < 2; i++) {
    const res = await request.post(route, { data: pushRestockAccepted(accepted.request) });
    expect(res.status()).toBe(200);
  }
});

test("Root pays it from inside the selling team and accepts it from inside the warehouse", async ({ page }) => {
  await login(page);

  const proof = await uploadProof(page, state.seller, state.warehouse);
  const recorded = await rpc(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
    teamId: state.seller,
    creditorTeamId: state.warehouse,
    amount: String(COURIER),
    note: "transfer BCA",
    documentIds: [proof],
    fromAccountId: state.sellerAccount,
  });
  state.payment = String(recorded.payment.id);

  // The record names who made the claim, and that it was root from outside the payer.
  expect(recorded.payment.recordedBy).toBe(ROOT_USER_ID);
  expect(recorded.payment.recordedIsOverride).toBe(true);

  await rpc(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
    teamId: state.warehouse,
    paymentId: state.payment,
    toAccountId: state.warehouseAccount,
  });
});

test("The reads name who recorded each row, and say which was root from outside", async ({ page }) => {
  await login(page, DEWI, PASSWORD);

  // proto3 JSON leaves a false out.
  const ledger = await rpc(page, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: state.seller,
    filter: { counterpartyId: state.warehouse },
    page: { page: 1, limit: 50 },
  });
  type Log = { id: string; sourceType: string; actorId?: string; isOverride?: boolean };
  const logs = Object.values(
    (ledger.items as { log?: { mapData: Record<string, Log> } }[]).find((it) => it.log)!.log!.mapData,
  );
  // The courier at a restock is an incidental fee on the wire; the screen words it "Courier at a restock".
  const courier = logs.find((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_INCIDENTAL_FEE")!;
  const paid = logs.find((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_PAYMENT")!;
  expect(courier.actorId).toBe(state.dewi);
  expect(courier.isOverride ?? false).toBe(false);
  expect(paid.actorId).toBe(ROOT_USER_ID);
  expect(paid.isOverride).toBe(true);

  const payments = await rpc(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentList", {
    teamId: state.seller,
    filter: { counterpartyId: state.warehouse },
    page: { page: 1, limit: 50 },
  });
  const listed = (payments.items as { payment?: { mapData: Record<string, Record<string, unknown>> } }[]).find(
    (it) => it.payment,
  )!.payment!.mapData[state.payment]!;
  expect(listed.recordedBy).toBe(ROOT_USER_ID);
  expect(listed.recordedIsOverride).toBe(true);
});

// Signed in on the desktop shell (the phone's has no `current-user` line), then sized for the screen under test.
async function openPair(page: Page, phone = false) {
  await login(page, DEWI, PASSWORD);
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await useTeam(page, state.seller);
  await page.goto(`/liability/${state.warehouse}`);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
}

function rowsOf(page: Page) {
  const all = page.getByTestId("liability-detail-all");
  const courierRow = all.locator('[data-testid^="liability-detail-entry-"]', { hasText: "Courier at a restock" });
  const paymentRow = all.locator('[data-testid^="liability-detail-entry-"]', { hasText: `Payment #${state.payment}` });

  return { all, courierRow, paymentRow };
}

test("Dewi sees who recorded each ledger row and payment, the badge on root's only", async ({ page }) => {
  await openPair(page);
  const { all, courierRow, paymentRow } = rowsOf(page);

  // The ledger's Recorded by column: Dewi on the charge she caused, root on the payment, its badge there alone.
  await expect(all.getByRole("columnheader", { name: "Recorded by" })).toBeVisible();
  const courierBy = courierRow.locator('[data-testid^="liability-detail-by-"]');
  const paymentBy = paymentRow.locator('[data-testid^="liability-detail-by-"]');
  await expect(courierBy).toHaveText(DEWI_NAME);
  await expect(courierBy.getByTestId("root-team-badge")).toHaveCount(0);
  await expect(paymentBy).toContainText("Root");
  await expect(paymentBy.getByTestId("root-team-badge")).toHaveText("by Root team");
  await expect(all.getByTestId("root-team-badge")).toHaveCount(1);

  // My payments: the claim names who recorded it — root, from outside the team.
  await page.getByTestId("liability-detail-tab-mine").click();
  const recordedBy = page.getByTestId("liability-detail-mine").getByTestId(`liability-detail-payment-by-${state.payment}`);
  await expect(recordedBy).toContainText("Root");
  await expect(recordedBy.getByTestId("root-team-badge")).toHaveText("by Root team");
});

test("On a phone each block carries a Recorded by line, the badge on root's", async ({ page }) => {
  await openPair(page, true);
  const { courierRow, paymentRow } = rowsOf(page);

  await expect(page.getByTestId("liability-detail-all").getByTestId("liability-ledger-table")).toHaveAttribute(
    "data-layout",
    "blocks",
  );
  await expect(courierRow.locator('[data-testid^="liability-detail-by-"]')).toHaveText(`Recorded by ${DEWI_NAME}`);
  const paymentBy = paymentRow.locator('[data-testid^="liability-detail-by-"]');
  await expect(paymentBy).toContainText("Recorded by Root");
  await expect(paymentBy.getByTestId("root-team-badge")).toBeVisible();

  await page.getByTestId("liability-detail-tab-mine").click();
  const recordedBy = page.getByTestId("liability-detail-mine").getByTestId(`liability-detail-payment-by-${state.payment}`);
  await expect(recordedBy).toContainText("Recorded by Root");
  await expect(recordedBy.getByTestId("root-team-badge")).toBeVisible();
});
