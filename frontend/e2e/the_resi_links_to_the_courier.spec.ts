import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { SUFFIX, api } from "./restock_helpers";
import { PASSWORD, ROLES, sellingGround, shopOf } from "./settlement_import_helpers";
import type { Ground, Role } from "./settlement_import_helpers";

// ── an order's resi links to the courier's own tracking page (#103) ─────────────────────────────────────────────────────
//
// Business rules (docs/business/shipment/context_decision.md):
// - an-orders-resi-links-to-the-couriers-tracking-page — NOW an order's resi links to its courier's own tracking page; the
//   app reads no tracking itself (the aggregator is the Later part, not built).
// - the-tracking-link-prototype-is-accepted — root keeps ONE optional link per courier on Channel Pengiriman (`Tracking
//   link`, `{resi}` where the number goes, URL-encoded); the ↗ "Track on the courier's site" opens it in a NEW TAB beside
//   the copyable resi on the seller's order page (Info reference + Pengiriman's leg), on the warehouse's order page
//   (which now shows the resi), and as an icon in the seller's list Resi cell (its click does not open the order); a
//   courier with no link reads as before. Build defaults the owner accepted with it: every status, and a deleted
//   courier's link still opens for its old orders.
// - a-tracking-link-must-carry-the-resi — a link with no `{resi}` is refused, as one that is not `https://` is; the
//   server refuses both (and a link that is no address), each for its own reason.
// - only-root-manages-channels — the link is root's to write.
//
// Not pinned here (the hand-off's *Not in this slice*, no decision covers them): links on the pick page, the warehouse's
// queue, the print page, and restock / transfer / custom-shipment / return resis.
//
// GROUND (beforeAll, as root, through the API): a selling team with a user per selling role, a warehouse it returns to
// with a warehouse:staff user, stock (sellingGround), one Shopee shop (root and the CS on it), and three couriers of the
// run's own: LINKED (a link with `{resi}`), PLAIN (no link) and GONE (a link, deleted after its order was placed).
// Orders, all pending (the link shows at every status): on LINKED with a resi that needs encoding (a space, `/`, `#`),
// one per role so each role reads its own; on PLAIN; on LINKED with no resi; on GONE.

const TAG = "TL";
const LINK = `https://cek.e2e-kurir.example/lacak/{resi}?via=tl${SUFFIX}`;
const GONE_LINK = `https://gone.e2e-kurir.example/t?r={resi}`;
const hrefOf = (template: string, resi: string) => template.split("{resi}").join(encodeURIComponent(resi));

const CREW = `e2etlwh${SUFFIX}`;
const ref = (slot: string) => `TL${SUFFIX}${slot.toUpperCase()}`;
// A resi typed by people: a space, a slash and a hash — each must be encoded, or the link opens somewhere else.
const linkedResi = (key: string) => `TL ${SUFFIX}/${key.toUpperCase()}#1`;
const PLAIN_RESI = `TLP${SUFFIX}`;
const GONE_RESI = `TLG${SUFFIX}`;

let g: Ground;
const ground = {
  shop: "",
  linked: "",
  plain: "",
  gone: "",
  orders: {} as Record<string, string>,
};

// An RPC as the signed-in person — the status and the JSON body, never thrown (a refusal is what some checks read).
async function call(page: Page, method: string, body: unknown): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      return { status: res.status, body: json };
    },
    [method, body, API_URL] as const,
  );
}

const CHANNELS = "shipment.v1.ShipmentChannelService";

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function signInAs(page: Page, r: Role) {
  await signIn(page, g.usernames[r.key], PASSWORD);
  await useTeam(page, g.team);
}

async function crewPage(browser: Browser): Promise<Page> {
  const wh = await browser.newPage();
  await signIn(wh, CREW, PASSWORD);
  await useTeam(wh, g.warehouse);

  return wh;
}

// The courier's page is not on the network: answer it in the browser, so the new tab LOADS and its address can be read.
async function stubCourierSites(page: Page) {
  for (const host of ["https://cek.e2e-kurir.example/**", "https://gone.e2e-kurir.example/**"]) {
    await page.context().route(host, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>courier</p>" }));
  }
}

// The seller's order page, drawn — its references and its Pengiriman.
async function openSellerOrder(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("order-reference-receipt")).toBeVisible();
}

// The warehouse's order page, drawn — its Info tab is the default.
async function openWarehouseOrder(wh: Page, orderId: string) {
  await wh.goto(`/orders/${orderId}`);
  await expect(wh.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
  await expect(wh.getByTestId("order-detail-tab-info")).toHaveAttribute("aria-selected", "true");
}

// The courier catalogue is ONE read per session (features/shipping/catalogue.ts) — wait it out before judging "no ↗".
async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  g = await sellingGround(page, TAG, 10);
  await api(page, "user.v1.UserService/CreateUser", {
    teamId: g.warehouse,
    username: CREW,
    password: PASSWORD,
    name: `Track crew ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });
  ground.shop = await shopOf(page, g, `E2E Lacak Shop ${SUFFIX}`, `TLP${SUFFIX}`, "MARKETPLACE_SHOPEE", [ROOT_USER_ID, g.users.cs]);

  const courier = async (code: string, name: string, trackingUrl: string) =>
    String((await api(page, `${CHANNELS}/ShipmentChannelCreate`, { code, name, trackingUrl })).channel.id);
  ground.linked = await courier(`tl_${SUFFIX}`, `E2E Kurir Lacak ${SUFFIX}`, LINK);
  ground.plain = await courier(`tln_${SUFFIX}`, `E2E Kurir Polos ${SUFFIX}`, "");
  ground.gone = await courier(`tlg_${SUFFIX}`, `E2E Kurir Lama ${SUFFIX}`, GONE_LINK);

  const place = async (slot: string, channel: string, receiptCode: string) => {
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-track-${slot}-${SUFFIX}`,
      shipmentChannelId: channel,
      teamId: g.team,
      shopId: ground.shop,
      warehouseId: g.warehouse,
      customerName: `E2E Lacak Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref(slot),
      receiptCode,
      items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, quantity: 1 }],
    });
    ground.orders[slot] = String(placed.order.id);
  };
  for (const r of ROLES) await place(r.key, ground.linked, linkedResi(r.key));
  await place("plain", ground.plain, PLAIN_RESI);
  await place("nores", ground.linked, "");
  await place("gone", ground.gone, GONE_RESI);
  // GONE is deleted AFTER its order was placed — a deleted courier still names (and links) its old orders.
  await api(page, `${CHANNELS}/ShipmentChannelDelete`, { channelId: ground.gone });

  await page.close();
});

// ── root keeps the link ─────────────────────────────────────────────────────────────────────────────────────────────────

test("Root keeps a courier's tracking link on Channel Pengiriman — optional, https, with {resi}, an address", async ({ page }) => {
  const code = `tlu_${SUFFIX}`;
  const good = `https://u.e2e-kurir.example/t/{resi}`;
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/shipping");
  await expect(page.getByTestId("shipment-channels-table")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("open-create-shipment-channel").click();
  await page.getByTestId("shipment-channel-code").fill(code);
  await page.getByTestId("shipment-channel-name").fill(`E2E Kurir Form ${SUFFIX}`);
  const field = page.getByTestId("shipment-channel-tracking-url");
  const error = page.getByTestId("shipment-channel-tracking-url-error");
  const save = page.getByTestId("shipment-channel-save");
  // Optional, and it says where the number goes.
  await expect(page.getByTestId("shipment-channel-tracking-url-help")).toBeVisible();
  await expect(save).toBeEnabled();

  // Each refusal shows once the field is left, for its own reason — and Save waits until it is fixed.
  for (const [typed, problem] of [
    ["http://u.e2e-kurir.example/t/{resi}", "notHttps"],
    ["https://u.e2e-kurir.example/track", "noResi"],
    ["https://u.e2e kurir.example/t/{resi}", "notAUrl"],
  ] as const) {
    await field.fill(typed);
    await field.press("Tab");
    await expect(error, typed).toHaveAttribute("data-problem", problem);
    await expect(save, typed).toBeDisabled();
  }
  await expect(error).toContainText("not a web address");

  await field.fill(good);
  await field.press("Tab");
  await expect(error).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();

  await page.goto(`/shipping?q=${code}`);
  const cell = page.getByTestId(`shipment-channel-tracking-${code}`);
  await expect(cell).toHaveText(good, { timeout: 15_000 });

  // Edit: the field holds the link; cleared, the courier has none ("—").
  await page.getByTestId(`edit-${code}`).click();
  await expect(field).toHaveValue(good);
  await field.fill("");
  await field.press("Tab");
  await expect(error).toHaveCount(0);
  await save.click();
  await expect(cell).toHaveText("—", { timeout: 15_000 });
});

test("The server refuses a link that is not https, holds no {resi} or is no address — each for its own reason; only root writes it", async ({
  page,
  browser,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const refusals = [
    ["http://x.e2e-kurir.example/{resi}", "must start with https://"],
    ["https://x.e2e-kurir.example/track", "must hold {resi}"],
    ["https://x e2e-kurir.example/{resi}", "not a web address"],
  ] as const;
  for (const [i, [link, reason]] of refusals.entries()) {
    const created = await call(page, `${CHANNELS}/ShipmentChannelCreate`, { code: `tlx${i}_${SUFFIX}`, name: "refused", trackingUrl: link });
    expect.soft(created.status, `create ${link}`).toBe(400);
    expect.soft(created.body.code, `create ${link}`).toBe("invalid_argument");
    expect.soft(String(created.body.message ?? ""), `create ${link}`).toContain(reason);

    const updated = await call(page, `${CHANNELS}/ShipmentChannelUpdate`, {
      channelId: ground.linked,
      name: `E2E Kurir Lacak ${SUFFIX}`,
      trackingUrl: link,
    });
    expect.soft(updated.status, `update ${link}`).toBe(400);
    expect.soft(String(updated.body.message ?? ""), `update ${link}`).toContain(reason);
  }
  // A refused create made nothing; a refused update left the link as it was.
  const byIds = await call(page, `${CHANNELS}/ShipmentChannelByIds`, { filter: { ids: [ground.linked] } });
  expect(byIds.status).toBe(200);
  expect(JSON.stringify(byIds.body)).toContain(LINK);
  for (const i of refusals.keys()) {
    const list = await call(page, `${CHANNELS}/ShipmentChannelList`, {
      filter: { q: `tlx${i}_${SUFFIX}`, includeDeleted: true },
      page: { page: 1, limit: 50 },
    });
    expect.soft(list.status).toBe(200);
    expect.soft(list.body.ids ?? [], `tlx${i}_${SUFFIX} was not made`).toHaveLength(0);
  }

  // only-root-manages-channels: the selling team's owner cannot set a courier's link.
  const owner = await browser.newPage();
  try {
    await signInAs(owner, ROLES[0]);
    const refused = await call(owner, `${CHANNELS}/ShipmentChannelUpdate`, {
      channelId: ground.linked,
      name: `E2E Kurir Lacak ${SUFFIX}`,
      trackingUrl: "https://evil.e2e-kurir.example/{resi}",
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("permission_denied");
  } finally {
    await owner.close();
  }
});

// ── the seller ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe("The seller's order and list link the resi to the courier's page", () => {
  for (const r of ROLES) {
    test(`${r.given} — the order page and the list open the courier's page for THIS resi, in a new tab`, async ({ page }) => {
      const orderId = ground.orders[r.key]!;
      const resi = linkedResi(r.key);
      const href = hrefOf(LINK, resi);
      await signInAs(page, r);
      await stubCourierSites(page);

      // The order page: the Info reference and Pengiriman's leg.
      await openSellerOrder(page, orderId);
      await expect.soft(page.getByTestId("order-reference-receipt")).toContainText(resi);
      const reference = page.getByTestId("order-reference-track");
      await expect(reference).toHaveAttribute("href", href);
      await expect.soft(reference).toHaveAttribute("target", "_blank");
      await expect.soft(reference).toHaveAttribute("rel", /noopener/);
      await expect.soft(reference).toHaveAttribute("rel", /noreferrer/);
      await expect.soft(reference).toContainText("Track on the courier's site");
      const leg = page.getByTestId("section-shipping").getByTestId("shipment-outbound");
      await expect.soft(leg).toContainText(resi);
      await expect.soft(leg.getByTestId("shipment-outbound-track")).toHaveAttribute("href", href);

      // Clicked: a new tab on the courier's page for this parcel; this page stays on the order.
      const [tab] = await Promise.all([page.context().waitForEvent("page"), reference.click()]);
      await tab.waitForLoadState();
      expect.soft(tab.url()).toBe(href);
      await tab.close();
      expect.soft(new URL(page.url()).pathname).toBe(`/orders/${orderId}`);

      // The list: the ↗ alone on the resi's line — its click opens the courier's page, never the order.
      await page.goto(`/orders?q=${ref(r.key)}`);
      const row = page.getByTestId(`order-row-${orderId}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect.soft(row.getByTestId("order-receipt")).toContainText(resi);
      const icon = row.getByTestId("order-receipt-track");
      await expect(icon).toHaveAttribute("href", href);
      await expect.soft(icon).toHaveAttribute("aria-label", "Track on the courier's site");
      const [listTab] = await Promise.all([page.context().waitForEvent("page"), icon.click()]);
      await listTab.waitForLoadState();
      expect.soft(listTab.url()).toBe(href);
      await listTab.close();
      await page.waitForTimeout(500);
      expect.soft(new URL(page.url()).pathname, "the ↗ did not open the order").toBe("/orders");
    });
  }
});

// ── the warehouse ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("warehouse:staff — the warehouse's order page shows the resi, copyable, with the courier's link", async ({ browser }) => {
  const orderId = ground.orders.own!;
  const resi = linkedResi("own");
  const wh = await crewPage(browser);
  try {
    await openWarehouseOrder(wh, orderId);
    const shown = wh.getByTestId("order-detail-resi");
    await expect(shown).toContainText(resi);
    const link = wh.getByTestId("order-detail-resi-track");
    await expect(link).toHaveAttribute("href", hrefOf(LINK, resi));
    await expect.soft(link).toHaveAttribute("target", "_blank");
    await expect.soft(link).toContainText("Track on the courier's site");
  } finally {
    await wh.close();
  }
});

// ── no link ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("A courier with no link — no ↗ anywhere, the resi still shown", async ({ page, browser }) => {
  const orderId = ground.orders.plain!;
  await signInAs(page, ROLES[0]);

  await openSellerOrder(page, orderId);
  await settled(page);
  await expect(page.getByTestId("order-reference-receipt")).toContainText(PLAIN_RESI);
  await expect(page.getByTestId("order-reference-track")).toHaveCount(0);
  await expect(page.getByTestId("section-shipping").getByTestId("shipment-outbound")).toContainText(PLAIN_RESI);
  await expect(page.getByTestId("shipment-outbound-track")).toHaveCount(0);

  await page.goto(`/orders?q=${ref("plain")}`);
  const row = page.getByTestId(`order-row-${orderId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await settled(page);
  await expect(row.getByTestId("order-receipt")).toContainText(PLAIN_RESI);
  await expect(row.getByTestId("order-receipt-track")).toHaveCount(0);

  const wh = await crewPage(browser);
  try {
    await openWarehouseOrder(wh, orderId);
    await settled(wh);
    await expect(wh.getByTestId("order-detail-resi")).toContainText(PLAIN_RESI);
    await expect(wh.getByTestId("order-detail-resi-track")).toHaveCount(0);
  } finally {
    await wh.close();
  }
});

test("An order with no resi yet — nothing to open, on a courier that has a link", async ({ page, browser }) => {
  const orderId = ground.orders.nores!;
  await signInAs(page, ROLES[0]);

  // First an order on the SAME courier with a resi draws its ↗ — the link is there to draw; then the resi-less one, once
  // its courier catalogue has been read (settled), draws none.
  await openSellerOrder(page, ground.orders.own!);
  await expect(page.getByTestId("order-reference-track")).toBeVisible();

  await openSellerOrder(page, orderId);
  await settled(page);
  await expect(page.getByTestId("order-reference-track")).toHaveCount(0);
  await expect(page.getByTestId("shipment-outbound-track")).toHaveCount(0);

  const wh = await crewPage(browser);
  try {
    await openWarehouseOrder(wh, orderId);
    await settled(wh);
    await expect(wh.getByTestId("order-detail-resi-track")).toHaveCount(0);
  } finally {
    await wh.close();
  }
});

test("A deleted courier's link still opens for its old orders", async ({ page }) => {
  const orderId = ground.orders.gone!;
  await signInAs(page, ROLES[0]);

  await openSellerOrder(page, orderId);
  await expect(page.getByTestId("order-reference-receipt")).toContainText(GONE_RESI);
  await expect(page.getByTestId("order-reference-track")).toHaveAttribute("href", hrefOf(GONE_LINK, GONE_RESI));
});
