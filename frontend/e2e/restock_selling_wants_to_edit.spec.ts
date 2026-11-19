import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick, ongoingOf, inboundRow } from "./restock_helpers";
import { pickTeam } from "./pickers";

// selling:all wants to edit a restock — split out of restock.spec.ts by its describe block (backlog #51). Self-contained:
// the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── selling:all wants to edit a restock — the checks behind docs/acceptances/inventory/restock.md ───────────────────────
//
// One test per GIVEN — `selling:all wants to edit a restock` in each of its eleven cases — run as EVERY selling role,
// through the restock's own page and its Edit (Edit Lines once arrived). Each THEN is its own step, named exactly as its
// row, and checked SOFTLY so one failing then does not hide the next. The warehouse's side is read as one warehouse role
// (status-is-per-then). The restocks are the GIVEN, seeded through the API, each with its OWN paying account, so a balance
// read in one test is never moved by another test's events. Every restock names its courier (JNE) when raised, so an edit
// changes only what its given says — the courier is asked for while the parcel is open (the-courier-is-required-on-the-form).
//
// Where each then is read:
// - `edit recorded in restock timeline` — the restock's Riwayat: ONE edit row (status unchanged), and under it the change
//   the given made, before → after (edits-are-in-the-same-trail).
// - `… recorded in finance analytic metric` — Analytic › Finance › Account changes, by account, filtered to the paying
//   account: its Restock figure for the week is the payment and every edit after it (−Rp 100.000 raised, −Rp 120.000 once
//   the line is Rp 120.000). A moved payment nets the old account back to nothing and charges the new one.
// - `… recorded in account history` — the account's own page: `Restock #<id> edited`, or `moved to / from another account`.
//
// `restock analytic metric adjusted` is 🚧 unimplemented — no analytic metric counts a restock until it is accepted (Restock
// counts what an accept puts on the racks), so none is adjusted by an edit. Its check is its own test per given, marked
// `test.fail` with the status (guide.md): its own test, so the expected failure never hides a broken then of the others. It
// edits its own restock as selling:owner and asks Restock by product for ANY figure of the edited product reading what the
// edit made it — field-agnostic, since how an edit will be shown is not built. The day one turns red, the then is built: ask
// the owner, then run it as every selling role and point it at the field that was built.
test.describe("selling:all wants to edit a restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The 🚧 checks' own restocks — raised for, and edited by, selling:owner.
  const METRIC = "met";

  type Key = "on" | "ad" | "rm" | "su" | "wh" | "ac" | "tr" | "co" | "nt" | "aa" | "ap";
  // Each given, the restock seeded for it per role, and whether its `restock analytic metric adjusted` is a 🚧 row.
  const CASES: { key: Key; cond: string; metric: boolean }[] = [
    { key: "ad", cond: "status: ongoing · 1 product · add product · 1 warehouse · operational account", metric: true },
    { key: "on", cond: "status: ongoing · 1 product · change product · 1 warehouse · operational account", metric: true },
    { key: "rm", cond: "status: ongoing · 2 products · remove product · 1 warehouse · operational account", metric: true },
    { key: "su", cond: "status: ongoing · 1 product · change supplier and store · 1 warehouse · operational account", metric: false },
    { key: "wh", cond: "status: ongoing · 1 product · change warehouse · 2 warehouses · operational account", metric: true },
    { key: "ac", cond: "status: ongoing · 1 product · change account · 1 warehouse · 2 operational accounts", metric: false },
    {
      key: "tr",
      cond: "status: ongoing · 1 product · change order ID, courier, tracking and receipt photo · 1 warehouse · operational account",
      metric: false,
    },
    { key: "co", cond: "status: ongoing · 1 product · change shipping cost · 1 warehouse · operational account", metric: true },
    { key: "nt", cond: "status: ongoing · 1 product · change restock note · 1 warehouse · operational account", metric: false },
    { key: "aa", cond: "status: arrived · 1 product · add product · 1 warehouse · operational account", metric: true },
    { key: "ap", cond: "status: arrived · 1 product · change product · 1 warehouse · operational account", metric: true },
  ];

  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  // Money out, as Analytic writes it — a true minus sign.
  const out = (n: number) => `−${rupiah(n)}`;
  const username = (role: string) => `e2eedt${role}${SUFFIX}`;
  const W1_USER = `e2eedtwa${SUFFIX}`;
  const W2_USER = `e2eedtwb${SUFFIX}`;
  const W1_CODE = `EA${SUFFIX}`;
  const W2_CODE = `EB${SUFFIX}`;
  const W1_NAME = `E2E Edt Warehouse A ${SUFFIX}`;
  const W2_NAME = `E2E Edt Warehouse B ${SUFFIX}`;
  const SUPPLIER_NAME = `E2E Edt Supplier ${SUFFIX}`;
  const SUPPLIER2_NAME = `E2E Edt Supplier Two ${SUFFIX}`;
  const STORE2_NAME = `E2E Edt Store Two ${SUFFIX}`;
  // P is the restock's line; Q the product an add gains, or the second line a remove takes off.
  const code = (role: string, kase: string, line: "P" | "Q") => `ED${role.toUpperCase()}${kase.toUpperCase()}${line}${SUFFIX}`;
  const at = (role: string, kase: string) => `${role}-${kase}`;
  const accountName = (role: string, kase: string) => `E2E Edt ${role} ${kase} ${SUFFIX}`;
  const newAccountName = (role: string) => `E2E Edt New ${role} ${SUFFIX}`;
  const receipt = (role: string, kase: string) => `E2E-EDT-${role}-${kase}-${SUFFIX}`.toUpperCase();
  // (change order ID, courier, tracking and receipt photo) — the Order ID raised and the one edited in, and the new resi.
  const ORDER1 = (role: string) => `E2E-EDT-O1-${role}-${SUFFIX}`.toUpperCase();
  const ORDER2 = (role: string) => `E2E-EDT-O2-${role}-${SUFFIX}`.toUpperCase();
  const RECEIPT2 = (role: string) => `E2E-EDT-R2-${role}-${SUFFIX}`.toUpperCase();
  // (change restock note) — the note raised and the one edited in.
  const NOTE1 = "for the sale";
  const NOTE2 = "for the 12.12 sale";
  // (change shipping cost) — Rp 10.000 raised, Rp 25.000 edited in.
  const SHIPPING1 = 10_000;
  const SHIPPING2 = 25_000;
  // (change product) — line 0 goes from 10 for Rp 100.000 to 12 for Rp 120.000, and gains a note.
  const LINE_NOTE = "two more at the same price";
  // A product added once the box arrived names its own supplier and says why (a-line-added-after-arrival-names-its-supplier).
  const ARRIVED_NOTE = "added after the box arrived";
  // A real 1×1 PNG — the label photo the edit attaches.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const ground = {
    team: "",
    w1: "",
    w2: "",
    supplier: "",
    supplier2: "",
    store2: "",
    couriers: {} as Record<string, string>,
    accounts: {} as Record<string, string>,
    // The account a moved restock moves to, per role.
    newAccounts: {} as Record<string, string>,
    restocks: {} as Record<string, string>,
    // Product id by product code — a line's note icon, supplier and trail line are named by its product.
    products: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    // Forty restocks, each with its products and its own account: more calls than one test's two minutes allow.
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Edt Seller ${SUFFIX}`, `ES${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.w1 = await team(W1_NAME, W1_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.w2 = await team(W2_NAME, W2_CODE, "TEAM_TYPE_WAREHOUSE");

    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.w1, W1_USER, "ROLE_WAREHOUSE_STAFF");
    await user(ground.w2, W2_USER, "ROLE_WAREHOUSE_STAFF");

    // The seeded couriers' ids, by code.
    const channels = await api(page, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    });
    const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((item) => item.channel)
      ?.channel?.mapData;
    for (const [id, channel] of Object.entries(map ?? {})) ground.couriers[channel.code] = id;
    expect(ground.couriers.jne && ground.couriers.sicepat).toBeTruthy();

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER_NAME })).supplier.id,
    );
    // (change supplier and store) — the supplier the restock moves to, and its store.
    ground.supplier2 = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER2_NAME })).supplier.id,
    );
    ground.store2 = String(
      (
        await api(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
          teamId: ground.team,
          supplierId: ground.supplier2,
          channelType: "MARKETPLACE_SHOPEE",
          name: STORE2_NAME,
          uri: `https://shopee.example/e2e-edt-${SUFFIX}`,
        })
      ).channel.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Edt Cat ${SUFFIX}` });
    const product = async (productCode: string) =>
      String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: productCode,
            name: `E2E ${productCode}`,
            categoryId: category.category.id,
          })
        ).product.id,
      );

    const account = async (name: string, number: string) => {
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: number,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const id = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId: id,
        operational: true,
      });
      return id;
    };

    let n = 0;
    const seeds = [
      ...ROLES.map((r) => ({ role: r.key as string, cases: CASES })),
      { role: METRIC, cases: CASES.filter((c) => c.metric) },
    ];
    for (const s of seeds) {
      if (s.role !== METRIC) ground.newAccounts[s.role] = await account(newAccountName(s.role), `80${SUFFIX}${++n}`);

      for (const c of s.cases) {
        const p = code(s.role, c.key, "P");
        const productId = await product(p);
        ground.products[p] = productId;
        if (c.key === "ad" || c.key === "aa" || c.key === "rm") {
          const q = code(s.role, c.key, "Q");
          ground.products[q] = await product(q);
        }

        const accountId = await account(accountName(s.role, c.key), `80${SUFFIX}${++n}`);
        ground.accounts[at(s.role, c.key)] = accountId;

        // GIVEN — an ongoing restock of 10 × Rp 10.000 to warehouse A, by JNE, one supplier, paid from its own account;
        // the removed case's also carries Q, 4 for Rp 40.000, to be taken off.
        const items = [{ productId, productCode: p, name: `E2E ${p}`, count: 10, total: 100_000, supplierId: ground.supplier }];
        if (c.key === "rm") {
          const q = code(s.role, c.key, "Q");
          items.push({ productId: ground.products[q], productCode: q, name: `E2E ${q}`, count: 4, total: 40_000, supplierId: ground.supplier });
        }
        const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.w1,
          financeAccountId: accountId,
          shipmentId: ground.couriers.jne,
          receipt: receipt(s.role, c.key),
          // …with an Order ID, a shipping cost or a note when its given changes one.
          ...(c.key === "tr" ? { invoiceRefId: ORDER1(s.role) } : {}),
          ...(c.key === "co" ? { shipmentCost: SHIPPING1 } : {}),
          ...(c.key === "nt" ? { note: NOTE1 } : {}),
          items,
        });
        const id = String(created.request.id);
        // …and for the arrived cases, signed for by warehouse A.
        if (c.key === "aa" || c.key === "ap") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: ground.w1, requestId: id });
        }
        ground.restocks[at(s.role, c.key)] = id;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its page shows it, once the line `text` is in its history — the create's payment, or the
  // edit's — so a read is never of an account an event has yet to reach.
  async function balanceOnceRecorded(page: Page, accountId: string, text: string): Promise<number> {
    let balance = 0;
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
      const shown = page.getByTestId("account-detail-balance");
      await expect(shown).toHaveText(/\d/, { timeout: 2_000 });
      balance = Number((await shown.innerText()).replace(/[^\d-]/g, ""));
    }).toPass({ timeout: 30_000 });
    return balance;
  }

  async function balanceIs(page: Page, accountId: string, expected: number) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(expected), { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  async function historySays(page: Page, accountId: string, text: string) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  // Analytic › Finance › Account changes, by account, filtered to the one account: its Restock figure this week. Re-read
  // until the posting lands.
  async function financeRestock(page: Page, accountId: string, expected: string | RegExp) {
    await expect(async () => {
      await page.goto(`/analytic?g=account&m=metrics/financial_accounts&r=7d&acc=${accountId}`);
      await expect(page.getByTestId(`analytic-cell-${accountId}-restock`)).toHaveText(expected, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  // The restock's Riwayat: its ONE edit row, and under it the change line `change` (`warehouse`, `note`, `line-<id>`, …)
  // holding every one of `texts`.
  async function trailSays(page: Page, id: string, change: string, texts: (string | RegExp)[], field?: string) {
    await page.goto(`/inventories/restock/${id}`);
    const edits = page.locator("[data-testid^='restock-timeline-'][data-kind='edit']");
    await expect.soft(edits).toHaveCount(1);
    const line = edits.first().locator(`[data-testid$='-change-${change}']`);
    for (const text of texts) await expect.soft(line).toContainText(text);
    if (field) await expect.soft(line).toHaveAttribute("data-field", field);
  }

  // WHEN — Edit on the restock's own page (Edit Lines once it has arrived: only the lines can change then), the given's
  // change made, then saved.
  async function edit(page: Page, role: string, key: Key, id: string) {
    const arrived = key === "aa" || key === "ap";
    await page.goto(`/inventories/restock/${id}`);
    await page.getByTestId(arrived ? `restock-action-edit-lines-${id}` : `restock-action-edit-${id}`).click();
    await expect(page.getByTestId("restock-edit-page")).toBeVisible();
    await expect(page.getByTestId("restock-line-0")).toContainText(code(role, key, "P"));

    switch (key) {
      case "on":
      case "ap":
        await page.getByTestId("restock-qty-0").fill("12");
        await page.getByTestId("restock-total-price-0").fill("120000");
        await page.getByTestId("restock-line-0-note").fill(LINE_NOTE);
        break;
      case "ad":
      case "aa": {
        // Q ticked beside P. While the box is on its way Q follows the restock's one supplier, which an edit opens as the
        // supplier for every product; once it has arrived Q names its own, and says why.
        await page.getByTestId("restock-pick-products").click();
        await tick(page, code(role, key, "Q"));
        await page.getByTestId("product-picker-confirm").click();
        await expect(page.getByTestId("restock-line-1")).toContainText(code(role, key, "Q"));
        if (key === "aa") {
          await page.getByTestId("restock-line-1-picker-trigger").click();
          const dialog = page.getByTestId("restock-line-1-picker-dialog");
          await dialog.getByTestId("restock-line-1-picker-search").fill(SUPPLIER_NAME);
          await dialog.getByTestId(`restock-line-1-picker-supplier-${ground.supplier}`).click();
          await dialog.getByTestId("restock-line-1-picker-confirm").click();
          await page.getByTestId("restock-line-1-note").fill(ARRIVED_NOTE);
        }
        await page.getByTestId("restock-qty-1").fill("5");
        await page.getByTestId("restock-total-price-1").fill("50000");
        break;
      }
      case "rm":
        // Q unticked in the picker.
        await expect(page.getByTestId("restock-line-1")).toContainText(code(role, key, "Q"));
        await page.getByTestId("restock-pick-products").click();
        await tick(page, code(role, key, "Q"), false);
        await page.getByTestId("product-picker-confirm").click();
        await expect(page.getByTestId("restock-line-1")).toHaveCount(0);
        break;
      case "su": {
        // The supplier for every product: the second one, and its store. The edit opens with the restock's one supplier
        // already chosen, so the box offers its Change (`restock-all-supplier-change-*`), not the first pick's trigger.
        const box = "restock-all-supplier-change";
        await expect(page.getByTestId("restock-all-supplier-shown")).toContainText(SUPPLIER_NAME);
        await page.getByTestId(`${box}-trigger`).click();
        const dialog = page.getByTestId(`${box}-dialog`);
        await dialog.getByTestId(`${box}-search`).fill(SUPPLIER2_NAME);
        await dialog.getByTestId(`${box}-supplier-${ground.supplier2}`).click();
        await dialog.getByTestId(`${box}-store-${ground.store2}`).click();
        await dialog.getByTestId(`${box}-confirm`).click();
        break;
      }
      case "wh":
        await pickTeam(page, page.getByTestId("restock-warehouse"), W2_CODE);
        break;
      case "ac":
        await page.getByTestId("restock-finance-account").click();
        await page.getByTestId(`restock-finance-account-option-${ground.newAccounts[role]}`).click();
        break;
      case "tr":
        // A new Order ID, SiCepat for JNE, the label photo attached (driving the hidden input — the trigger only opens the
        // OS dialog), and the new resi.
        await page.getByTestId("restock-invoice-ref").fill(ORDER2(role));
        await page.getByTestId("restock-courier").getByRole("combobox").click();
        await page.getByTestId("shipment-channel-option-sicepat").click();
        await page
          .getByTestId("restock-receipt-file")
          .locator("input[type=file]")
          .setInputFiles({ name: "resi.png", mimeType: "image/png", buffer: PNG });
        await expect(page.getByTestId("restock-receipt-file").getByTestId("order-receipt-attached")).toContainText("resi.png");
        await page.getByTestId("restock-receipt").fill(RECEIPT2(role));
        break;
      case "co":
        await page.getByTestId("restock-shipping-cost").fill(String(SHIPPING2));
        break;
      case "nt":
        await page.getByTestId("restock-note").fill(NOTE2);
        break;
    }

    await expect(page.getByTestId("restock-form-ready")).toBeVisible();
    await page.getByTestId("submit-restock").click();
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));
  }

  for (const r of ROLES) {
    for (const c of CASES) {
      test(`${r.given} edit restock (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[at(r.key, c.key)];
        const account = ground.accounts[at(r.key, c.key)];
        const newAccount = ground.newAccounts[r.key];
        const p = code(r.key, c.key, "P");
        const q = code(r.key, c.key, "Q");
        const pid = ground.products[p];
        const qid = ground.products[q];

        await signIn(page, username(r.key), ground.team);
        const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
        const beforeNew = c.key === "ac" ? await balanceOnceRecorded(page, newAccount, "") : 0;

        // WHEN — as this role.
        await edit(page, r.key, c.key, id);

        // THEN — as the seller, on the restock's page, its Riwayat, the picker's Ongoing, the account and Analytic.
        const products = page.getByTestId("restock-detail-products");
        const money = async (step: string, change: number, total: number) => {
          await test.step(step, async () => {
            await expect.soft(async () => balanceIs(page, account, before - change)).toPass({ timeout: 35_000 });
          });
          await test.step("then: edit recorded in account history", async () => {
            await expect.soft(async () => historySays(page, account, `Restock #${id} edited`)).toPass({ timeout: 35_000 });
          });
          await test.step("then: edit recorded in finance analytic metric", async () => {
            await expect.soft(async () => financeRestock(page, account, out(total))).toPass({ timeout: 35_000 });
          });
        };

        switch (c.key) {
          case "on":
          case "ap":
            await test.step("then: restock shows new count, total and note", async () => {
              await page.getByTestId("section-nav-products").click();
              await expect.soft(products).toContainText("12");
              await expect.soft(products).toContainText("120.000");
              await expect.soft(page.getByTestId(`restock-detail-line-note-${pid}`)).toHaveAttribute("aria-label", new RegExp(LINE_NOTE));
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, `line-${pid}`, ["10 → 12 pcs", `total ${rupiah(100_000)} → ${rupiah(120_000)}`, LINE_NOTE], "line");
            });
            await test.step("then: ongoing total adjusted (from 10 to 12)", async () => {
              await expect.soft(await ongoingOf(page, p)).toHaveText("12");
            });
            await money(`then: paying account balance adjusted (decrease/increase) (by ${rupiah(20_000)})`, 20_000, 120_000);
            break;

          case "ad":
          case "aa":
            await test.step("then: new product added", async () => {
              await page.getByTestId("section-nav-products").click();
              await expect.soft(products).toContainText(q);
              await expect.soft(products).toContainText(p);
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              const supplier = c.key === "aa" ? [`supplier ${SUPPLIER_NAME}`] : [];
              await trailSays(page, id, `line-${qid}`, [`Added E2E ${q} × 5`, rupiah(50_000), ...supplier], "line_added");
            });
            await test.step("then: ongoing total adjusted (Q from 0 to 5, P still 10)", async () => {
              await expect.soft(await ongoingOf(page, q)).toHaveText("5");
              await expect.soft(await ongoingOf(page, p)).toHaveText("10");
            });
            await money(`then: paying account balance adjusted (decrease) (by ${rupiah(50_000)})`, 50_000, 150_000);
            break;

          case "rm":
            await test.step("then: product removed", async () => {
              await page.getByTestId("section-nav-products").click();
              await expect.soft(products).toContainText(p);
              await expect.soft(products).not.toContainText(q);
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, `line-${qid}`, [`Removed E2E ${q} × 4`], "line_removed");
            });
            // Q comes off Ongoing — a dash or a 0, whichever the picker draws for none — and P keeps its 10.
            await test.step("then: ongoing total adjusted (Q from 4 to none, P still 10)", async () => {
              await expect.soft(await ongoingOf(page, q)).toHaveText(/^(0|—)$/);
              await expect.soft(await ongoingOf(page, p)).toHaveText("10");
            });
            await money(`then: paying account balance adjusted (increase) (by ${rupiah(40_000)})`, -40_000, 100_000);
            break;

          case "su":
            await test.step("then: restock shows new supplier and store", async () => {
              await page.getByTestId("section-nav-products").click();
              const supplier = page.getByTestId(`restock-detail-supplier-${pid}`);
              await expect.soft(supplier).toContainText(SUPPLIER2_NAME);
              await expect.soft(supplier).toContainText(STORE2_NAME);
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, `line-${pid}`, [`supplier ${SUPPLIER_NAME} → ${SUPPLIER2_NAME}`, `store — → ${STORE2_NAME}`], "line");
            });
            break;

          case "wh":
            await test.step("then: restock shows new warehouse", async () => {
              await expect.soft(page.getByTestId("restock-detail-warehouse")).toContainText(W2_NAME);
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, "warehouse", [`Warehouse ${W1_NAME} → ${W2_NAME}`]);
            });
            break;

          case "ac":
            await test.step("then: restock shows new account", async () => {
              await expect.soft(page.getByTestId("restock-detail-paid-from")).toContainText(newAccountName(r.key));
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, "finance_account", [`Paid from ${accountName(r.key, c.key)} → ${newAccountName(r.key)}`]);
            });
            await test.step(`then: old account balance back up (by ${rupiah(100_000)})`, async () => {
              await expect.soft(async () => balanceIs(page, account, before + 100_000)).toPass({ timeout: 35_000 });
            });
            await test.step(`then: new account balance decreases (by ${rupiah(100_000)})`, async () => {
              await expect.soft(async () => balanceIs(page, newAccount, beforeNew - 100_000)).toPass({ timeout: 35_000 });
            });
            await test.step("then: move recorded in old account history", async () => {
              await expect
                .soft(async () => historySays(page, account, `Restock #${id} moved to another account`))
                .toPass({ timeout: 35_000 });
            });
            await test.step("then: move recorded in new account history", async () => {
              await expect
                .soft(async () => historySays(page, newAccount, `Restock #${id} moved from another account`))
                .toPass({ timeout: 35_000 });
            });
            // The old account's week nets back to nothing (paid, then given back); the new one carries the payment.
            await test.step("then: move recorded in finance analytic metric", async () => {
              await expect.soft(async () => financeRestock(page, account, /^(Rp 0|—)$/)).toPass({ timeout: 35_000 });
              await expect.soft(async () => financeRestock(page, newAccount, out(100_000))).toPass({ timeout: 35_000 });
            });
            break;

          case "tr":
            await test.step("then: restock shows new order ID, courier, tracking and photo", async () => {
              await expect.soft(page.getByTestId("restock-detail-invoice")).toContainText(ORDER2(r.key));
              await expect.soft(page.getByTestId("restock-detail-courier")).toContainText("SiCepat");
              await expect.soft(page.getByTestId("restock-detail-tracking")).toContainText(RECEIPT2(r.key));
              await expect.soft(page.getByTestId("restock-detail-receipt-photo-open")).toBeVisible();
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, "invoice_ref", [`Order ID ${ORDER1(r.key)} → ${ORDER2(r.key)}`]);
              await trailSays(page, id, "shipment", ["Courier JNE → SiCepat"]);
              await trailSays(page, id, "receipt", [`Tracking no. ${receipt(r.key, c.key)} → ${RECEIPT2(r.key)}`]);
              await trailSays(page, id, "receipt_file", ["Label photo added"]);
            });
            break;

          case "co":
            await test.step("then: restock shows new shipping cost", async () => {
              await expect.soft(page.getByTestId("restock-detail-shipping")).toContainText(rupiah(SHIPPING2).replace("Rp ", ""));
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, "shipment_cost", [`Shipping ${rupiah(SHIPPING1)} → ${rupiah(SHIPPING2)}`]);
            });
            await money(
              `then: paying account balance follows difference (by ${rupiah(SHIPPING2 - SHIPPING1)})`,
              SHIPPING2 - SHIPPING1,
              100_000 + SHIPPING2,
            );
            break;

          case "nt":
            await test.step("then: restock shows new note", async () => {
              await expect.soft(page.getByTestId("restock-detail-note-selling").getByTestId("restock-detail-note")).toHaveText(NOTE2);
            });
            await test.step("then: edit recorded in restock timeline", async () => {
              await trailSays(page, id, "note", [`Note “${NOTE1}” → “${NOTE2}”`]);
            });
            break;
        }

        // THEN — as the warehouses: their inbound lists, and the restock's page on their side. The list is searched for the
        // restock's product P: warehouse A holds every given's restock, more than one page of them, so an unsearched read
        // misses the row (and an absence would prove nothing).
        switch (c.key) {
          case "on":
          case "ap":
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: total warehouse receive changes", async () => {
              await expect.soft(await inboundRow(page, id, p)).toContainText("1 product · 12 pcs");
            });
            break;
          case "ad":
          case "aa":
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: total warehouse receive changes", async () => {
              await expect.soft(await inboundRow(page, id, p)).toContainText("2 products · 15 pcs");
            });
            break;
          case "rm":
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: total warehouse receive changes", async () => {
              await expect.soft(await inboundRow(page, id, p)).toContainText("1 product · 10 pcs");
            });
            break;
          case "wh":
            await signIn(page, W2_USER, ground.w2);
            await test.step("then: recorded at new warehouse", async () => {
              await expect.soft(await inboundRow(page, id, p)).toBeVisible();
            });
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: removed from old warehouse", async () => {
              await expect.soft(await inboundRow(page, id, p)).toHaveCount(0);
            });
            break;
          case "tr":
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: target warehouse sees new courier and tracking", async () => {
              await page.goto(`/inventories/restock/${id}`);
              await expect.soft(page.getByTestId("restock-detail-courier")).toContainText("SiCepat");
              await expect.soft(page.getByTestId("restock-detail-tracking")).toContainText(RECEIPT2(r.key));
            });
            break;
          case "nt":
            await signIn(page, W1_USER, ground.w1);
            await test.step("then: target warehouse sees new note", async () => {
              await page.goto(`/inventories/restock/${id}`);
              await expect.soft(page.getByTestId("restock-detail-note-selling").getByTestId("restock-detail-note")).toHaveText(NOTE2);
            });
            break;
        }
      });
    }
  }

  // 🚧 — its own test per given, so the expected failure hides none of the thens above (see the head of this file).
  // What the edit made the edited product's figure: P's new count, Q's added count, P's count left after Q went, P's count
  // at its new warehouse, the new shipping (or the total it makes).
  const ADJUSTED: Record<string, { line: "P" | "Q"; figure: RegExp }> = {
    on: { line: "P", figure: /^12$/ },
    ap: { line: "P", figure: /^12$/ },
    ad: { line: "Q", figure: /^5$/ },
    aa: { line: "Q", figure: /^5$/ },
    rm: { line: "P", figure: /^10$/ },
    wh: { line: "P", figure: /^10$/ },
    co: { line: "P", figure: /^(Rp 25\.000|Rp 125\.000)$/ },
  };
  for (const c of CASES.filter((k) => k.metric)) {
    test(`selling:owner edit restock (${c.cond}): restock analytic metric adjusted`, async ({ page }) => {
      test.fail(
        true,
        "🚧 unimplemented (docs/acceptances/inventory/restock.md) — no analytic metric counts a restock before it is accepted, so none is adjusted by an edit",
      );

      const id = ground.restocks[at(METRIC, c.key)];
      await signIn(page, username("own"), ground.team);
      await edit(page, METRIC, c.key, id);
      const { line, figure } = ADJUSTED[c.key];
      const product = ground.products[code(METRIC, c.key, line)];

      // Restock by product, this week: any figure of the edited product reading what the edit made it. Re-read until it lands.
      await test.step("then: restock analytic metric adjusted", async () => {
        await expect(async () => {
          await page.goto(`/analytic?g=product&m=metrics/inventory/restock&r=7d`);
          await expect(page.locator(`[data-testid^="analytic-cell-${product}-"]`).filter({ hasText: figure })).not.toHaveCount(0, {
            timeout: 2_000,
          });
        }).toPass({ timeout: 20_000 });
      });
    });
  }
});
