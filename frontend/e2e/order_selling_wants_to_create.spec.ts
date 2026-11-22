import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick, readyAt } from "./restock_helpers";
import { listLanded, pickTeam } from "./pickers";

// ── selling:all wants to create an order — the checks behind docs/acceptances/inventory/order.md ────────────────────
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its checks live in the
// regression spec of the feature its WHEN belongs to — create order. orders.spec.ts is one serial chain of 2.000 lines,
// so the acceptance block is its own file beside it, as the restock family's are (restock_selling_wants_to_*.spec.ts).
// The rows' statuses are the owner's, set by hand on the owner's instruction — never by this file.
//
// One test per GIVEN, run as EVERY selling role (selling:owner, selling:admin, selling:cs — `selling:all`), through the
// seller's own order form. Each THEN is its own step, named exactly as its row, and checked SOFTLY so one failing then
// does not hide the next. Every role and case orders its OWN product (10 units restocked from the ONE supplier, accepted
// onto the ONE rack at Rp 10.000 a unit) through its OWN shop, so a figure read in one test is never moved by another.
// The ground is seeded in beforeAll, so a worker restarted after a failure seeds its own instead of reading a moved
// SUFFIX.
//
// The WHEN — 2 units of the product, the marketplace paid Rp 100.000, the warehouse charges 10% of the goods:
//   goods Rp 20.000 · warehouse fee Rp 2.000 · total Rp 22.000.
// (typed in) — every field typed on /orders/new. (from draft) — a draft pushed the way the scraper app does (its shop,
// warehouse, buyer, Order ID, order date and Rp 100.000), opened from /order-drafts; the person picks the product,
// its quantity and the courier, writes the note and attaches the label, as on a typed order.
//
// How each then is read:
// - `order created with 1 product` — the order's own page: ONE item line, the product, pending.
// - `draft removed from drafts` — /order-drafts no longer lists the draft.
// - `note shown in order timeline` — the note typed on the form is the order's first timeline row with no status
//   (a-note-is-a-timeline-row), drawn in its Notes section (Catatan).
// - `ready stock of 1 product decreases at 1 warehouse` — the seller's Ready at the warehouse, on its product picker:
//   10 → 8.
// - `recorded in product history` — the selling team's product page, Stock history: ONE Order row, −2.
// - `order shows items cost and warehouse fee` — the order's page: the line at Rp 10.000 a unit, the fee Rp 2.000, the
//   system total Rp 22.000.
// - `target warehouse sees order pending` — the warehouse (warehouse:staff), its orders screen, To Confirm: the row.
// - `target warehouse can print receipt` — the warehouse opens the order and the label the seller attached opens
//   (OrderLabels includes it).
// - `warehouse fee recorded in liability` — the seller's ledger with the warehouse: ONE "Order fee · order #<id>" entry of
//   Rp 2.000. Read as the role that ordered, except selling:cs, which liability does not serve — read as selling:owner.
// - `sale recorded in order settlement` — the order's Settlement section reads the Rp 100.000 the marketplace paid.
// - `order recorded in analytic metric` — Analytic › Orders created, last 7 days, by shop, filtered to the role's shop: 1.
// - `warehouse fee recorded in analytic metric` — (typed in, own product: the one given that names it) Analytic,
//   Warehouse Fee, last 7 days, by shop, filtered to the role's shop: 1 fee transaction of Rp 2.000, read as the role
//   that ordered (the-warehouse-fee-prototype-is-accepted — the fee frozen on the order, on its placement day).
// - `recorded at 1 supplier` — the supplier's Statistics by product, the product's row: 2 sold for Rp 100.000.
// The figures that land on a fold or a listener (liability, settlement, analytic, supplier) are re-read until they do.
//
// (cross product) — the product is ANOTHER selling team's (the cross team), its 10 units restocked by that team from its
// ONE supplier and accepted onto the same warehouse's rack; it carries a 20% cross markup, so it costs the seller
// Rp 12.000 a unit: goods Rp 24.000 · warehouse fee Rp 2.400 · total Rp 26.400. The seller finds it on the order form's
// picker, Other tab. Its return map already stands (written through ProductReturnMapCreate in the GIVEN, onto a product
// of the seller's own) — mapping it on the form is its own given (cross product · return map chosen), and a borrowed
// line with no map cannot be created at all (cross product · no return map).
// - `ready stock of 1 product decreases at 1 warehouse` — what the SELLER can draw: the order form's picker, Other tab,
//   READY at the warehouse, 10 → 8.
// - `cross team's ready stock decreases` — the cross team's own Ready at the warehouse (selling:owner there): 10 → 8.
// - `recorded in product history` — the product's own page, read by its owner (the cross team): ONE Order row, −2.
// - `product fee recorded in liability to cross team` — the seller's ledger with the cross team: ONE
//   "Product fee · order #<id>" entry of Rp 24.000 (the goods with the markup, the-ledger-charges-the-frozen-line-total).
// - `recorded at 1 supplier` — the cross team's supplier (its owner reads it): 2 sold for Rp 100.000.
//
// (Order ID on …) — the four givens of the DUPLICATE ORDER ID warning (a-duplicate-ref-is-warned-not-refused,
// the-duplicate-warning-reads-drafts-too; business/order/context.md "How We Warn Duplicate Order"). The form is typed in
// on the role's shop with an Order ID already recorded; Create first looks the ID up (OrderByExternalRefs +
// OrderDraftByExternalRefs). The recorded order is placed by root in beforeAll (2 units of the role's own product):
// still pending on the SAME shop · cancelled on the same shop · pending on ANOTHER shop of the team, which the role also
// writes to (so the order is one it can see — only the shop sets it apart). The draft is pushed in the test with the
// role's own token, the way the scraper app pushes under a person's login.
// - `warning names the used order in frontend` — the duplicate dialog names that order: "Order #<id>", linking to it,
//   Pending — and nothing else.
// - `warning names the draft in frontend` — the dialog names that draft: "Draft #<id>", linking to the draft's form.
// - `can create but needs confirm in frontend` — while the warning stands the form sends NO OrderCreate and stays on
//   /orders/new; Create Anyway places it — a NEW pending order on the same Order ID.
// - `no warning in frontend` — the lookup runs and Create goes straight on: no dialog, one OrderCreate, the new order's
//   page.
test.describe("selling:all wants to create an order", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const CASES = [
    {
      cond: "1 product · own product · 1 warehouse · 1 supplier · note · receipt label · typed in",
      key: "ty",
      draft: false,
      cross: false,
    },
    {
      cond: "1 product · cross product · 1 warehouse · 1 supplier · note · receipt label · typed in",
      key: "cx",
      draft: false,
      cross: true,
    },
    {
      cond: "1 product · own product · 1 warehouse · 1 supplier · note · receipt label · from draft",
      key: "dr",
      draft: true,
      cross: false,
    },
  ] as const;
  // The Order ID givens — every one typed in on the role's own product; `on` is what already holds the Order ID.
  const REF_CASES = [
    {
      cond: "1 product · own product · 1 warehouse · Order ID on 1 pending order of same shop",
      key: "pd",
      on: "order",
      warns: true,
      cross: false,
    },
    {
      cond: "1 product · own product · 1 warehouse · Order ID on 1 cancelled order of same shop",
      key: "cn",
      on: "cancelled",
      warns: false,
      cross: false,
    },
    {
      cond: "1 product · own product · 1 warehouse · Order ID on 1 pending order of other shop",
      key: "os",
      on: "otherShop",
      warns: false,
      cross: false,
    },
    {
      cond: "1 product · own product · 1 warehouse · Order ID on 1 draft of same shop",
      key: "df",
      on: "draft",
      warns: true,
      cross: false,
    },
  ] as const;
  type Role = (typeof ROLES)[number];
  type Case = (typeof CASES)[number];
  type RefCase = (typeof REF_CASES)[number];
  type Keyed = { key: string };

  const STOCK = 10;
  const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
  const QTY = 2;
  const FEE_PERCENT = 10;
  const PLATFORM_TOTAL = 100_000;
  const CROSS_MARKUP_BPS = 2_000; // 20% — a borrowed unit costs the seller Rp 12.000
  // What the order costs the seller — at the product's cost on an own line, with the owner's markup on a borrowed one.
  const money = (c: Case) =>
    c.cross
      ? { unit: "Rp 12.000", goods: "Rp 24.000", fee: "Rp 2.400", total: "Rp 26.400" }
      : { unit: "Rp 10.000", goods: "Rp 20.000", fee: "Rp 2.000", total: "Rp 22.000" };
  const LABEL = "resi-acceptance.pdf";

  const username = (role: string) => `e2eoc${role}${SUFFIX}`;
  const WH_USER = `e2eocwh${SUFFIX}`;
  const CROSS_USER = `e2eocxo${SUFFIX}`; // selling:owner of the cross team
  const WH_CODE = `OCW${SUFFIX}`;
  const at = (r: Role, c: Keyed) => `${r.key}-${c.key}`;
  const sku = (r: Role, c: Keyed) => `OC${r.key.toUpperCase()}${c.key.toUpperCase()}${SUFFIX}`;
  // The marketplace's Order ID — typed (typed in) or carried by the draft (from draft), unique per role and case.
  const ref = (r: Role, c: Keyed) => `OC${SUFFIX}${r.key.toUpperCase()}${c.key.toUpperCase()}`;
  const note = (r: Role, c: Keyed) => `Bungkus rapi, ${r.given} ${c.key} ${SUFFIX}`;

  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    supplier: "",
    // (cross product) — the team whose goods the seller borrows, and that team's one supplier.
    crossTeam: "",
    crossSupplier: "",
    refSupplier: "",
    products: {} as Record<string, string>,
    shops: {} as Record<string, string>,
    // (Order ID on … other shop) — the team's second shop the recorded order sits on.
    otherShops: {} as Record<string, string>,
    // (Order ID on … order) — the order already holding the Order ID, placed in beforeAll.
    recorded: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Ocr Seller ${SUFFIX}`, `OCS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.crossTeam = await team(`E2E Ocr Cross ${SUFFIX}`, `OCX${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Ocr Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `oc-${SUFFIX}`, name: "E2E order shelf" }))
        .rack.id,
    );

    const users: Record<string, string> = {};
    for (const r of ROLES) {
      const made = await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: `Ocr ${r.given} ${SUFFIX}`,
        role: r.role,
      });
      users[r.key] = String(made.user.id);
    }
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: WH_USER,
      password: PASSWORD,
      name: `Ocr warehouse:staff ${SUFFIX}`,
      role: "ROLE_WAREHOUSE_STAFF",
    });
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.crossTeam,
      username: CROSS_USER,
      password: PASSWORD,
      name: `Ocr cross selling:owner ${SUFFIX}`,
      role: "ROLE_SELLING_OWNER",
    });

    // The warehouse charges 10% of the goods; the seller returns to it (create refuses a team with no return warehouse).
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", {
      teamId: ground.warehouse,
      feePercent: FEE_PERCENT,
      minFee: 0,
    });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.team,
      warehouseId: ground.warehouse,
    });

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Ocr Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    ground.crossSupplier = String(
      (
        await api(page, "supplier.v1.SupplierService/SupplierCreate", {
          teamId: ground.crossTeam,
          name: `E2E Ocr Cross Supplier ${SUFFIX}`,
        })
      ).supplier.id,
    );
    // (Order ID on …) — the Order ID givens restock from a supplier of their own, so their 12 products and the orders
    // placed on them never crowd the one supplier's statistics the other givens read.
    ground.refSupplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Ocr Ref Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Ocr Cat ${SUFFIX}` });
    // An operational account per selling team — a restock is paid from the raising team's own.
    const accountOf = async (teamId: string, tail: string) => {
      const id = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E Ocr BCA ${tail} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `84${SUFFIX}${tail}`,
            openingBalance: 10_000_000,
            openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          })
        ).account.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: id,
        operational: true,
      });
      return id;
    };
    const account = await accountOf(ground.team, "01");
    const crossAccount = await accountOf(ground.crossTeam, "02");

    // (cross product) — the seller's own product every borrowed product's return map points at.
    const mapTo = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.team,
          productCodePart: `OCMAP${SUFFIX}`,
          name: `E2E OCMAP${SUFFIX}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );

    // GIVEN — per role and case: the product, 10 restocked from the one supplier and accepted onto the one rack; a shop
    // the role may write to; for (from draft) the draft the scraper pushed. (cross product): the product, the restock,
    // the account and the supplier are the CROSS team's, the product carries its markup, and the seller's return map
    // for it already stands.
    let n = 0;
    for (const r of ROLES) {
      for (const c of [...CASES, ...REF_CASES]) {
        const code = sku(r, c);
        const owner = c.cross ? ground.crossTeam : ground.team;
        const productId = String(
          (
            await api(page, "product.v1.ProductService/ProductCreate", {
              teamId: owner,
              productCodePart: code,
              name: `E2E ${code}`,
              categoryId: category.category.id,
              ...(c.cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
            })
          ).product.id,
        );
        ground.products[at(r, c)] = productId;

        const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: owner,
          warehouseId: ground.warehouse,
          financeAccountId: c.cross ? crossAccount : account,
          items: [
            {
              productId,
              productCode: code,
              name: `E2E ${code}`,
              count: STOCK,
              total: RESTOCK_TOTAL,
              supplierId: c.cross ? ground.crossSupplier : "on" in c ? ground.refSupplier : ground.supplier,
            },
          ],
        });
        await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
          teamId: ground.warehouse,
          requestId: raised.request.id,
          lines: [{ itemId: raised.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: ground.rack, quantity: STOCK }] }],
        });
        if (c.cross) {
          await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
            teamId: ground.team,
            sharedProductId: productId,
            ownProductId: mapTo,
          });
        }

        const shop = String(
          (
            await api(page, "selling.v1.ShopService/ShopCreate", {
              teamId: ground.team,
              name: `E2E Ocr Shop ${r.key} ${c.key} ${SUFFIX}`,
              shopCode: `O${++n}${SUFFIX}`,
              marketplace: "MARKETPLACE_SHOPEE",
            })
          ).shop.id,
        );
        ground.shops[at(r, c)] = shop;
        await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users[r.key] });
      }
    }

    // GIVEN (Order ID on … order) — the order already holding the Order ID, placed by root: 2 units of the role's own
    // product, from the warehouse. (other shop) on the team's second shop, which the role writes to as well, so the
    // order is one it can see. (cancelled) then called off.
    for (const r of ROLES) {
      for (const c of REF_CASES) {
        if (c.on === "draft") continue;
        let onShop = ground.shops[at(r, c)];
        if (c.on === "otherShop") {
          onShop = String(
            (
              await api(page, "selling.v1.ShopService/ShopCreate", {
                teamId: ground.team,
                name: `E2E Ocr Other Shop ${r.key} ${SUFFIX}`,
                shopCode: `O${++n}${SUFFIX}`,
                marketplace: "MARKETPLACE_SHOPEE",
              })
            ).shop.id,
          );
          ground.otherShops[at(r, c)] = onShop;
          await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: onShop, userId: users[r.key] });
        }
        const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-ocref-${SUFFIX}-${r.key}-${c.key}`,
          shipmentChannelId: "1",
          teamId: ground.team,
          shopId: onShop,
          warehouseId: ground.warehouse,
          customerName: `E2E Earlier Buyer ${r.key} ${c.key}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: ref(r, c),
          items: [{ productId: ground.products[at(r, c)], productCode: sku(r, c), name: `E2E ${sku(r, c)}`, quantity: QTY }],
        });
        ground.recorded[at(r, c)] = String(placed.order.id);
        if (c.on === "cancelled") {
          const off = await api(page, "selling.v1.OrderService/OrderCancel", { teamId: ground.team, orderId: placed.order.id });
          expect(off.order.status).toBe("ORDER_STATUS_CANCEL");
        }
      }
    }

    await page.close();
  });

  // GIVEN (from draft) — the draft the scraper app pushed. A draft is its AUTHOR's (OrderDraftList reads the signed-in
  // person's own), and the app authenticates as that person — so it is pushed with the role's own token, right before the
  // WHEN, into the role's shop and the warehouse. (Order ID on 1 draft) is the same push. Returns the draft's id.
  async function pushDraft(page: Page, r: Role, c: Keyed): Promise<string> {
    const pushed = await api(page, "selling.v1.OrderDraftService/OrderDraftPush", {
      teamId: ground.team,
      source: "e2e-scraper",
      externalId: ref(r, c),
      shopId: ground.shops[at(r, c)],
      warehouseId: ground.warehouse,
      customerName: `E2E Buyer ${r.key} ${c.key}`,
      platformCreatedAtUnix: String(Math.floor(Date.now() / 1000)),
      platformTotal: PLATFORM_TOTAL,
      items: [{ externalSku: "MP-OC-1", externalName: "Kaos Acceptance", quantity: QTY, unitPrice: PLATFORM_TOTAL / QTY }],
    });
    return String(pushed.draft.id);
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The marketplace's order date — today's cell, in the browser's own clock (orders.spec.ts's pickOrderDate).
  async function pickOrderDate(page: Page) {
    await page.getByTestId("order-create-order-date").click();
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await page.getByTestId("order-create-order-date-content").locator(`[data-part="table-cell-trigger"][data-value="${today}"]`).click();
    await page.keyboard.press("Escape");
  }

  // (cross product) — what the SELLER can draw of a borrowed product: the order form's picker, Other tab, READY at the
  // warehouse (the form's "available" lens — what a pick would find).
  async function readyOnOrderForm(page: Page, code: string) {
    await page.goto("/orders/new");
    await expect(page.getByTestId("order-create-page")).toBeVisible();
    await pickTeam(page, page.getByTestId("order-warehouse"), WH_CODE);
    await page.getByTestId("order-create-add-line").click();
    await page.getByTestId("product-picker-tab-other").click();
    await page.getByTestId("product-picker-search").fill(code);
    const row = page
      .getByTestId("product-picker-list")
      .locator('[data-testid^="product-picker-option-"]')
      .filter({ hasText: code });
    await expect(row).toHaveCount(1);
    return row.locator('[data-testid^="product-picker-ready-"]');
  }

  // WHEN — create order through the seller's own form, as whoever is signed in. Returns the order's id.
  async function create(page: Page, r: Role, c: Case): Promise<string> {
    const shop = ground.shops[at(r, c)];

    if (c.draft) {
      // Opened from the drafts list, where the scraper's push landed: the form is seeded from it.
      await page.goto("/order-drafts");
      await page.getByTestId(/^draft-row-/).filter({ hasText: ref(r, c) }).getByTestId(/^draft-updated-/).click();
      await expect(page).toHaveURL(/\/orders\/new\?draft=\d+$/);
      await expect(page.getByTestId("order-create-draft-ref")).toHaveText(`Draft ${ref(r, c)}`);
      await expect(page.getByTestId("order-external-ref-id")).toHaveValue(ref(r, c));
      await expect(page.getByTestId("order-marketplace-total")).toHaveValue("100.000");
    } else {
      await page.goto("/orders/new");
      await expect(page.getByTestId("order-create-page")).toBeVisible();
      await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${r.key} ${c.key}`);
      await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
      await page.getByTestId("shop-select").click();
      await page.getByTestId(`shop-select-option-${shop}`).click();
      await pickTeam(page, page.getByTestId("order-warehouse"), WH_CODE);
    }

    await page.getByTestId("order-create-add-line").click();
    // (cross product) — another team's goods are on the picker's Other tab.
    if (c.cross) await page.getByTestId("product-picker-tab-other").click();
    await tick(page, sku(r, c));
    await page.getByTestId("product-picker-confirm").click();
    await page.getByTestId("order-line-qty-0").fill(String(QTY));
    // (cross product) — the return map that already stands arrives locked on the Return Mapping card.
    if (c.cross) await expect(page.getByTestId(`return-map-locked-${ground.products[at(r, c)]}`)).toBeVisible();

    if (!c.draft) {
      await pickOrderDate(page);
      await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
      await page.getByTestId("order-external-ref-id").fill(ref(r, c));
    }
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();

    await page.getByTestId("order-create-note").fill(note(r, c));
    await page
      .getByTestId("order-receipt-upload")
      .locator("input[type=file]")
      .setInputFiles({ name: LABEL, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e acceptance label") });
    await expect(page.getByTestId("order-receipt-attached")).toContainText(LABEL);

    await expect(page.getByTestId("order-create-save")).toBeEnabled();
    await page.getByTestId("order-create-save").click();
    await expect(page).toHaveURL(/\/orders\/\d+$/);
    await expect(page.getByTestId("order-detail-page")).toBeVisible();

    return /\/orders\/(\d+)$/.exec(page.url())![1]!;
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} create order (${c.cond})`, async ({ page, browser }) => {
        const code = sku(r, c);
        const productId = ground.products[at(r, c)];
        const shop = ground.shops[at(r, c)];

        // The starting point — the seller's Ready at the warehouse is the 10 the restock put away. (cross product): the
        // seller's is what it can draw on the order form, and the cross team — signed in on a page of its own, which
        // also reads its product's history and its supplier below — reads the same 10 as its own.
        await signIn(page, username(r.key), ground.team);
        const sellerReady = () => (c.cross ? readyOnOrderForm(page, code) : readyAt(page, WH_CODE, code));
        await expect(await sellerReady()).toHaveText(String(STOCK));
        const crossPage = c.cross ? await browser.newPage() : undefined;
        if (crossPage) {
          await signIn(crossPage, CROSS_USER, ground.crossTeam);
          await expect(await readyAt(crossPage, WH_CODE, code)).toHaveText(String(STOCK));
        }
        // Whoever owns the product reads its history and its supplier.
        const owner = crossPage ?? page;
        const supplier = c.cross ? ground.crossSupplier : ground.supplier;
        const m = money(c);
        if (c.draft) await pushDraft(page, r, c);

        // WHEN — through the seller's own form, as this role.
        const orderId = await create(page, r, c);

        // THEN — as the seller, on the order it just made.
        await test.step("then: order created with 1 product", async () => {
          const lines = page.getByTestId("section-items").locator('[data-testid^="order-item-"]');
          await expect.soft(lines).toHaveCount(1);
          await expect.soft(lines.first()).toContainText(code);
          await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
        });

        if (c.draft) {
          await test.step("then: draft removed from drafts", async () => {
            await page.goto("/order-drafts");
            await expect(page.getByTestId("order-drafts-table")).toBeVisible();
            await expect.soft(page.getByTestId(/^draft-row-/).filter({ hasText: ref(r, c) })).toHaveCount(0);
          });
        }

        await test.step("then: note shown in order timeline", async () => {
          await page.goto(`/orders/${orderId}`);
          const notes = page.getByTestId("section-notes").getByTestId("order-note-text");
          await expect.soft(notes.filter({ hasText: note(r, c) })).toHaveCount(1);
        });

        await test.step("then: ready stock of 1 product decreases at 1 warehouse", async () => {
          await expect
            .soft(async () => {
              await expect(await sellerReady()).toHaveText(String(STOCK - QTY), { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });

        if (crossPage) {
          await test.step("then: cross team's ready stock decreases", async () => {
            await expect
              .soft(async () => {
                await expect(await readyAt(crossPage, WH_CODE, code)).toHaveText(String(STOCK - QTY), { timeout: 2_000 });
              })
              .toPass({ timeout: 30_000 });
          });
        }

        await test.step("then: recorded in product history", async () => {
          await owner.goto(`/products/${productId}`);
          await owner.getByTestId("pd-tab-history").click();
          const rows = owner
            .getByTestId("pd-panel-history")
            .locator('[data-testid^="pd-history-row-"]')
            .filter({ hasText: /Order/ });
          await expect.soft(rows).toHaveCount(1);
          // The row's change cell reads −2 (its cells run together in the row's text: "#<order> -2 8").
          await expect.soft(rows.first().locator("td").filter({ hasText: new RegExp(`^\\s*[−-]${QTY}\\s*$`) })).toHaveCount(1);
        });

        await test.step("then: order shows items cost and warehouse fee", async () => {
          await page.goto(`/orders/${orderId}`);
          await expect.soft(page.getByTestId("section-items").locator('[data-testid^="order-item-"]').first()).toContainText(m.unit);
          await expect.soft(page.getByTestId("order-money-breakdown")).toContainText(m.goods);
          await expect.soft(page.getByTestId("money-fees")).toContainText(m.fee);
          await expect.soft(page.getByTestId("money-system")).toContainText(m.total);
        });

        await test.step("then: sale recorded in order settlement", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/orders/${orderId}`);
              await expect(page.getByTestId("order-ledger-panel")).toBeVisible({ timeout: 3_000 });
              await expect(page.getByTestId("settlement-summary")).toContainText("Rp 100.000", { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });

        await test.step("then: order recorded in analytic metric", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/analytic?g=shop&m=metrics/orders/created&r=7d&shop=${shop}`);
              await expect(page.getByTestId(`analytic-cell-${shop}-created_count`)).toHaveText("1", { timeout: 3_000 });
            })
            .toPass({ timeout: 30_000 });
        });

        // Only the (typed in, own product) given names this then.
        if (c.key === "ty") {
          await test.step("then: warehouse fee recorded in analytic metric", async () => {
            await expect
              .soft(async () => {
                await page.goto(`/analytic?g=shop&m=metrics/warehouse_fee&r=7d&shop=${shop}`);
                await expect(page.getByTestId(`analytic-cell-${shop}-transaction_count`)).toHaveText("1", { timeout: 3_000 });
                await expect(page.getByTestId(`analytic-cell-${shop}-amount`)).toHaveText(m.fee, { timeout: 3_000 });
              })
              .toPass({ timeout: 30_000 });
          });
        }

        await test.step("then: recorded at 1 supplier", async () => {
          await expect
            .soft(async () => {
              await owner.goto(`/inventories/suppliers/${supplier}`);
              await owner.getByTestId("supplier-tab-statistics").click();
              await owner.getByTestId("statistics-view-product").click();
              const row = owner
                .getByTestId("supplier-statistics")
                .locator('[data-testid^="statistics-product-row-"]')
                .filter({ hasText: code });
              await expect(row).toHaveCount(1, { timeout: 2_000 });
              await expect(row.getByTestId("figure-sales")).toHaveText(/^2\s*Rp\s?100\.000$/, { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });
        if (crossPage) await crossPage.close();

        // THEN — the seller's ledger with the warehouse (and, for a cross product, with the cross team). selling:cs is not
        // served liability, so its order's entries are read as selling:owner (a-then-observed-by-another-role: any one
        // role that can read it).
        const ledger = r.key === "cs" ? await browser.newPage() : page;
        if (r.key === "cs") await signIn(ledger, username("own"), ground.team);
        const entryOf = () =>
          ledger
            .getByTestId("liability-detail-all")
            .locator('[data-testid^="liability-detail-entry-"]')
            .filter({ hasText: `order #${orderId}` });
        await test.step("then: warehouse fee recorded in liability", async () => {
          await expect
            .soft(async () => {
              await ledger.goto(`/liability/${ground.warehouse}`);
              const entry = entryOf();
              await expect(entry).toHaveCount(1, { timeout: 3_000 });
              await expect(entry).toContainText("Order fee");
              await expect(entry).toContainText(m.fee);
            })
            .toPass({ timeout: 30_000 });
        });
        if (c.cross) {
          await test.step("then: product fee recorded in liability to cross team", async () => {
            await expect
              .soft(async () => {
                await ledger.goto(`/liability/${ground.crossTeam}`);
                const entry = entryOf();
                await expect(entry).toHaveCount(1, { timeout: 3_000 });
                await expect(entry).toContainText("Product fee");
                await expect(entry).toContainText(m.goods);
              })
              .toPass({ timeout: 30_000 });
          });
        }
        if (ledger !== page) await ledger.close();

        // THEN — as the warehouse the order ships from (warehouse:staff).
        await signIn(page, WH_USER, ground.warehouse);
        await test.step("then: target warehouse sees order pending", async () => {
          await page.goto("/warehouse-orders");
          await expect.soft(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
          await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible();
        });

        await test.step("then: target warehouse can print receipt", async () => {
          await page.goto(`/orders/${orderId}`);
          await expect(page.getByTestId("order-detail-page")).toBeVisible();
          await expect.soft(page.getByTestId("order-detail-receipt")).toContainText(LABEL);
          const [answer, popup] = await Promise.all([
            page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderLabels")),
            page.waitForEvent("popup"),
            page.getByTestId("order-receipt-open").click(),
          ]);
          expect.soft(answer.status()).toBe(200);
          const labels = (await answer.json()) as { url: string; results: { orderId: string; included?: boolean }[] };
          expect.soft(labels.results).toEqual([{ orderId, included: true }]);
          expect.soft(labels.url).toContain(LABEL);
          await popup.close();
        });
      });
    }
  }

  // WHEN (Order ID on …) — the form typed in on the role's own shop, the Order ID already recorded: the role's own
  // product, 2 units, the order date, Rp 100.000 paid, JNE. No note and no label (the givens carry neither). Create is
  // left to the test.
  async function fillTyped(page: Page, r: Role, c: RefCase) {
    await page.goto("/orders/new");
    await expect(page.getByTestId("order-create-page")).toBeVisible();
    await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${r.key} ${c.key}`);
    await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
    await page.getByTestId("shop-select").click();
    await page.getByTestId(`shop-select-option-${ground.shops[at(r, c)]}`).click();
    await pickTeam(page, page.getByTestId("order-warehouse"), WH_CODE);
    await page.getByTestId("order-create-add-line").click();
    await tick(page, sku(r, c));
    await page.getByTestId("product-picker-confirm").click();
    await page.getByTestId("order-line-qty-0").fill(String(QTY));
    await pickOrderDate(page);
    await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
    await page.getByTestId("order-external-ref-id").fill(ref(r, c));
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();
    await expect(page.getByTestId("order-create-save")).toBeEnabled();
  }

  for (const c of REF_CASES) {
    for (const r of ROLES) {
      test(`${r.given} create order (${c.cond})`, async ({ page }) => {
        await signIn(page, username(r.key), ground.team);
        // GIVEN (draft) — pushed by the role itself, as the scraper app does under its login. Otherwise the order placed
        // in beforeAll.
        const held = c.on === "draft" ? await pushDraft(page, r, c) : ground.recorded[at(r, c)]!;

        // Every OrderCreate the page sends — the warning has to stand BEFORE the order is sent, not after it.
        let sent = 0;
        page.on("request", (req) => {
          if (req.method() === "POST" && req.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")) sent++;
        });

        // WHEN — Create, on the form typed in with the recorded Order ID. The lookup runs first, every time.
        await fillTyped(page, r, c);
        const [looked] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderByExternalRefs")),
          page.getByTestId("order-create-save").click(),
        ]);
        expect(looked.status()).toBe(200);

        const dialog = page.getByTestId("duplicate-ref-dialog");
        const detail = page.getByTestId("order-detail-page");
        // Whichever Create lands on: the warning, or the new order's own page.
        await expect(dialog.or(detail)).toBeVisible();
        const placedId = () => /\/orders\/(\d+)$/.exec(page.url())?.[1];

        if (c.on === "order") {
          await test.step("then: warning names the used order in frontend", async () => {
            await expect.soft(dialog).toBeVisible();
            await expect.soft(dialog.getByTestId("duplicate-ref-lead")).toContainText(ref(r, c));
            const link = dialog.getByTestId(`duplicate-ref-order-link-${held}`);
            await expect.soft(link).toHaveText(`Order #${held}`);
            await expect.soft(link).toHaveAttribute("href", `/orders/${held}`);
            await expect.soft(dialog.getByTestId(`duplicate-ref-order-${held}`)).toContainText("Pending");
            // That order and nothing else.
            await expect.soft(dialog.locator('[data-testid^="duplicate-ref-order-link-"]')).toHaveCount(1);
            await expect.soft(dialog.locator('[data-testid^="duplicate-ref-draft-"]')).toHaveCount(0);
          });
        }
        if (c.on === "draft") {
          await test.step("then: warning names the draft in frontend", async () => {
            await expect.soft(dialog).toBeVisible();
            await expect.soft(dialog.getByTestId("duplicate-ref-lead")).toContainText(ref(r, c));
            const link = dialog.getByTestId(`duplicate-ref-draft-link-${held}`);
            await expect.soft(link).toHaveText(`Draft #${held}`);
            await expect.soft(link).toHaveAttribute("href", `/orders/new?draft=${held}`);
            // That draft and nothing else.
            await expect.soft(dialog.locator('[data-testid^="duplicate-ref-draft-link-"]')).toHaveCount(1);
            await expect.soft(dialog.locator('[data-testid^="duplicate-ref-order-"]')).toHaveCount(0);
          });
        }
        if (c.warns) {
          await test.step("then: can create but needs confirm in frontend", async () => {
            // While the warning stands nothing is sent — the form waits on the person.
            await expect.soft(page).toHaveURL(/\/orders\/new$/);
            expect.soft(sent).toBe(0);
            await dialog.getByTestId("duplicate-ref-create-anyway").click();
            await expect(detail).toBeVisible();
            // A NEW pending order on the same Order ID.
            expect.soft(sent).toBe(1);
            expect.soft(placedId()).toBeDefined();
            if (c.on === "order") expect.soft(placedId()).not.toBe(held);
            await expect.soft(page.getByTestId("order-reference-mp")).toContainText(ref(r, c));
            await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
          });
        } else {
          await test.step("then: no warning in frontend", async () => {
            // The lookup ran (above) and Create went straight on: no dialog, one OrderCreate, the new order's page.
            await expect.soft(dialog).toBeHidden();
            await expect.soft(detail).toBeVisible();
            expect.soft(sent).toBe(1);
            expect.soft(placedId()).toBeDefined();
            expect.soft(placedId()).not.toBe(held);
            await expect.soft(page.getByTestId("order-reference-mp")).toContainText(ref(r, c));
          });
        }
      });
    }
  }
});
