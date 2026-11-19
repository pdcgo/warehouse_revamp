import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to finish a draft — the checks behind docs/acceptances/inventory/order.md (## draft) ───────────
//
// One test for the GIVEN — (1 draft from app · 1 product) — run as EVERY selling role. WHEN: the role opens the draft
// from its drafts list (/order-drafts → the row). THEN `draft opens in order form with its data`: the order form
// (/orders/new?draft=<id>, the-draft-opens-in-the-order-form) opens SEEDED from everything the app pushed:
//
//   the reference      the draft's badge, and the marketplace's Order ID box
//   shop · warehouse   the shop and the warehouse the app read
//   money · dates      the sell price (the draft's platform total), the order date, the shipment deadline
//   buyer              the customer's name and phone, the buyer's marketplace username
//   address            the marketplace's text beside the picker, the picker pre-filled (its names match one place),
//                      the street line
//   courier            the channel the app mapped the platform's courier to
//   the 1 product      the scraped line as text above the products — quantity × title · price — and which app sent it
//
// ⚠ The scraped line is NOT a product line of the order: a draft stores no mapping (a-draft-stores-no-mapping) — the
// person picks our product while reading it. So the product's data is checked where the form shows it, the hint list.
//
// ⚠ There is no "New Draft" button — every draft comes in from a third-party app (drafts-exist-only-for-the-third-party-app),
// which pushes it with a person's own login, and a draft is its AUTHOR's (OrderDraftList / OrderDraftDetail narrow to the
// author). So each role pushes its own draft with its OWN token, as the app does.
//
// The ground: one selling team (root its owner) with a user per role; one warehouse; a shop per role, which that role
// may write to. Each role's draft names its own shop, the warehouse, and a buyer of its own.
test.describe("selling:all wants to finish a draft", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  type Role = (typeof ROLES)[number];
  const COND = "1 draft from app · 1 product";
  const SOURCE = "e2e-scraper";
  const SELLER = `E2E Odr Seller ${SUFFIX}`;
  const WH_NAME = `E2E Odr Warehouse ${SUFFIX}`;
  const COURIER = "jne";
  // What the buyer paid, and the one scraped line: 2 × Rp 50.000.
  const PLATFORM_TOTAL = 100_000;
  const QTY = 2;
  const UNIT_PRICE = 50_000;

  const username = (r: Role) => `e2eodr${r.key}${SUFFIX}`;
  const ref = (r: Role) => `E2E-ODR-${r.key}-${SUFFIX}`;
  const shopName = (r: Role) => `E2E Odr Shop ${r.key} ${SUFFIX}`;
  const buyer = (r: Role) => `E2E Odr Buyer ${r.key}`;
  const phone = (r: Role) => `0812${SUFFIX}${ROLES.indexOf(r)}`;
  const buyerUsername = (r: Role) => `odr.${r.key}.${SUFFIX}`;
  const title = (r: Role) => `Kaos Odr ${r.key} Hitam L`;
  const street = (r: Role) => `Jl. Odr ${r.key} No. 1`;

  // The platform's two dates, on whole minutes (the form keeps a time to the minute): bought an hour ago, to ship within
  // two days — the order date is never in the future and the deadline never in the past.
  const minute = (ms: number) => Math.floor(ms / 60_000) * 60;
  const ORDERED_AT = minute(Date.now() - 60 * 60_000);
  const DEADLINE_AT = minute(Date.now() + 2 * 24 * 60 * 60_000);

  const ground = {
    team: "",
    warehouse: "",
    courier: { id: "", name: "" },
    shops: {} as Record<string, string>,
    drafts: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const root = await browser.newPage();
    await login(root, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(SELLER, `ODS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(WH_NAME, `ODH${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    // A seller set up to create from it: the warehouse charges its fee, and the seller returns to it.
    await api(root, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(root, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.team,
      warehouseId: ground.warehouse,
    });

    // The courier the app maps the platform's text to — a seeded channel, by code.
    const channels = (await api(root, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    })) as { items: { channel?: { mapData: Record<string, { code: string; name: string }> } }[] };
    const map = channels.items.find((item) => item.channel)?.channel?.mapData ?? {};
    const found = Object.entries(map).find(([, channel]) => channel.code === COURIER);
    if (!found) throw new Error(`the seeded courier ${COURIER} is not in the catalogue`);
    ground.courier = { id: found[0], name: found[1].name };

    // A user per role, and a shop each that the role may write to.
    let n = 0;
    for (const r of ROLES) {
      const created = await api(root, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r),
        password: PASSWORD,
        name: `Odr ${r.given} ${SUFFIX}`,
        role: r.role,
      });
      const shop = String(
        (
          await api(root, "selling.v1.ShopService/ShopCreate", {
            teamId: ground.team,
            name: shopName(r),
            shopCode: `OD${++n}${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      ground.shops[r.key] = shop;
      await api(root, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: created.user.id });
    }
    await root.close();

    // GIVEN — each role's one draft, pushed with its own login the way the app does: every field the app can send, and
    // one scraped line. The address names the e2e region fixture's one place, in the marketplace's spelling.
    for (const r of ROLES) {
      const page = await browser.newPage();
      await login(page, username(r), PASSWORD);
      const pushed = await api(page, "selling.v1.OrderDraftService/OrderDraftPush", {
        teamId: ground.team,
        source: SOURCE,
        externalId: ref(r),
        shopId: ground.shops[r.key],
        warehouseId: ground.warehouse,
        customerName: buyer(r),
        customerPhone: phone(r),
        address: {
          provinsiName: "ACEH",
          kabupatenName: "Kab. Aceh Selatan",
          kecamatanName: "Bakongan",
          desaName: "Keude Bakongan",
          kodePos: "23773",
          addressLine: street(r),
        },
        platformCreatedAtUnix: String(ORDERED_AT),
        platformShipmentDeadlineUnix: String(DEADLINE_AT),
        buyerUsername: buyerUsername(r),
        platformTotal: PLATFORM_TOTAL,
        shipmentChannelId: ground.courier.id,
        items: [{ externalSku: `MP-ODR-${r.key}`, externalName: title(r), quantity: QTY, unitPrice: UNIT_PRICE }],
      });
      expect(pushed.created).toBe(true);
      ground.drafts[r.key] = String(pushed.draft.id);
      await page.close();
    }
  });

  async function signIn(page: Page, user: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
  }

  // A date picker's button reads the value in the app's own format (formatUnixDateTime: English by default, WIB) —
  // formatted by the browser itself, so its ICU is the one the screen uses.
  const label = (page: Page, unix: number) =>
    page.evaluate(
      (u) =>
        new Date(u * 1000).toLocaleString("en", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        }),
      unix,
    );

  for (const r of ROLES) {
    test(`${r.given} open draft order (${COND})`, async ({ page }) => {
      const draftId = ground.drafts[r.key];
      expect(draftId, "the role's draft was pushed").toBeTruthy();

      // GIVEN — the role's one draft from the app, on its drafts list.
      await signIn(page, username(r));
      await page.goto("/order-drafts");
      await expect(page.getByTestId("team-switcher")).toContainText(SELLER);
      const row = page.getByTestId(`draft-row-${draftId}`);
      await expect(row).toContainText(ref(r));

      // WHEN — the role opens it: the ROW opens the draft, clicked on its date (the reference is a copy button).
      await row.getByTestId(/^draft-updated-/).click();

      await test.step("then: draft opens in order form with its data", async () => {
        // The order form, on this draft.
        await expect(page).toHaveURL(new RegExp(`/orders/new\\?draft=${draftId}$`));
        await expect(page.getByTestId("order-create-page")).toBeVisible();
        await expect.soft(page.getByTestId("order-create-draft-ref")).toHaveText(`Draft ${ref(r)}`);

        // The reference, the shop and the warehouse the app read.
        await expect.soft(page.getByTestId("order-external-ref-id")).toHaveValue(ref(r));
        await expect.soft(page.getByTestId("shop-select")).toHaveValue(shopName(r));
        await expect.soft(page.getByTestId("order-warehouse").locator("input")).toHaveValue(WH_NAME);

        // The money and the platform's dates.
        await expect.soft(page.getByTestId("order-marketplace-total")).toHaveValue("100.000");
        await expect.soft(page.getByTestId("order-create-order-date")).toHaveText(await label(page, ORDERED_AT));
        await expect.soft(page.getByTestId("order-create-deadline")).toHaveText(await label(page, DEADLINE_AT));

        // The buyer.
        await expect.soft(page.getByTestId("order-create-customer-name")).toHaveValue(buyer(r));
        await expect.soft(page.getByTestId("order-create-customer-phone")).toHaveValue(phone(r));
        await expect.soft(page.getByTestId("order-create-buyer-username")).toHaveValue(buyerUsername(r));

        // The address: the marketplace's text beside the picker, the picker pre-filled in the region list's spelling,
        // and the street line.
        await expect.soft(page.getByTestId("draft-address-text-street")).toHaveText(street(r));
        await expect
          .soft(page.getByTestId("draft-address-text-place"))
          .toHaveText("Keude Bakongan, Bakongan, Kab. Aceh Selatan, ACEH 23773");
        const level = (name: string) => page.getByTestId(`address-${name}`).getByRole("combobox");
        await expect.soft(level("provinsi")).toHaveValue("Aceh");
        await expect.soft(level("kabupaten")).toHaveValue("Kabupaten Aceh Selatan");
        await expect.soft(level("kecamatan")).toHaveValue("Bakongan");
        await expect.soft(level("desa")).toHaveValue("Keude Bakongan");
        await expect.soft(page.getByTestId("address-line")).toHaveValue(street(r));

        // The courier the app mapped.
        await expect
          .soft(page.getByTestId("shipment-channel-select").getByRole("combobox"))
          .toHaveValue(ground.courier.name);

        // The 1 product — the scraped line, as the marketplace wrote it, above the products; and which app sent it.
        const hints = page.getByTestId("draft-product-hints").locator('[data-testid^="draft-product-hint-"]');
        await expect.soft(hints).toHaveCount(1);
        await expect
          .soft(page.getByTestId("draft-product-hint-0"))
          .toHaveText(new RegExp(`^${QTY} × ${title(r)} · Rp\\s?50\\.000$`));
        await expect.soft(page.getByTestId("draft-product-hints-source")).toContainText(SOURCE);
      });
    });
  }
});
