import { deflateRawSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// SHOP ENTRIES, END TO END (the-shop-entries-page-is-accepted, a-shop-entry-reverses-inline) — named to sort AFTER
// orders.spec.ts, statement.spec.ts and the_settlement_report.spec.ts, as a spec posting money must; it runs on one
// shared database. A SELLING TEAM OF ITS OWN with one Shopee shop, so root's team — whose totals financial_accounts.spec
// checks — is never touched, and no order is placed.
//
// A statement of ONE line, built per run (its ref and balance carry the run's suffix): a key is global across the
// ledger (the-row-key-is-the-only-dedupe), so the shared fixture would be "already there" under another spec's shop.
//
//   Penghasilan dari Pesanan   E2ESE<suffix>   75.000   no such order → POSTED to the shop (an-unmatched-ref-posts-to-the-shop)
//
// It is imported through the real importer, read back on /settlement/shop-entries with the statement it came from,
// reversed there (the order ledger's own SettlementPost), and the totals return to zero.

const SUFFIX = Date.now().toString().slice(-6);
const REF = `E2ESE${SUFFIX}`;
const SHOP_NAME = `E2E Entries Shop ${SUFFIX}`;

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

// ── a one-sheet XLSX, written by hand: deflated zip entries of inline-string cells ──────────────────────

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dir, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Shopee "Rincian Transaksi" export: rows by their 1-based row number, each a list of cell texts from column A. */
function shopeeStatement(rows: Record<number, string[]>): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = Object.entries(rows)
    .map(
      ([r, cells]) =>
        `<row r="${r}">${cells.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  return zip({
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

const STATEMENT = shopeeStatement({
  6: ["Username (Penjual)", "melati.e2e"],
  8: ["Dari", "2026-09-01"],
  9: ["Ke", "2026-09-07"],
  18: ["Tanggal Transaksi", "Tipe Transaksi", "Deskripsi", "No. Pesanan", "Jenis Transaksi", "Jumlah", "Status", "Saldo Akhir"],
  19: [
    "2026-09-02 10:00:00",
    "Penghasilan dari Pesanan",
    `Penghasilan dari Pesanan #${REF}`,
    REF,
    "Transaksi Masuk",
    "75000.00",
    "Transaksi Selesai",
    `75${SUFFIX}.00`,
  ],
});

// ── the session ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(ROOT_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
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

const state = { team: "", shop: "", entry: "", file: "" };

test.describe.configure({ mode: "serial" });

test("Setup: a selling team with a Shopee shop, root its primary CS", async ({ page }) => {
  await login(page);

  state.team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Shop Entries ${SUFFIX}`,
      teamCode: `SE${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  state.shop = (
    await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.team,
      name: SHOP_NAME,
      shopCode: `SE${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;

  // The first grant becomes the primary CS — a statement imports only for a shop with one.
  await rpc(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.team, shopId: state.shop, userId: ROOT_USER_ID });
});

test("A statement line that matches no order posts to the shop", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto("/settlement/imports");
  await page.getByTestId("open-import-file").click();
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("shop-select").click();
  await dialog.getByRole("option").filter({ hasText: SHOP_NAME }).click();
  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "statement.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: STATEMENT,
  });
  await dialog.getByTestId("start-import").click();

  await expect(dialog.getByTestId("import-progress-text")).toHaveText("1 of 1 rows", { timeout: 30_000 });
  await expect(dialog.getByTestId("tally-posted-value")).toHaveText("1", { timeout: 15_000 });
  await dialog.getByTestId("open-imported-file").click();
  await expect(page.getByTestId("import-detail-shop")).toContainText(SHOP_NAME);
  state.file = page.url().split("/").pop()!.split("?")[0]!;
});

test("Entri Toko lists it, with the statement it came from and who uploaded it", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto("/settlement/shop-entries");
  await expect(page.getByTestId("shop-entries-count")).toHaveText("1");
  await expect(page.getByTestId("shop-entries-received")).toContainText(rp(75_000));

  const ref = page.locator('[data-testid^="shop-entry-ref-"]').filter({ hasText: REF });
  await expect(ref).toContainText("no order found");
  state.entry = (await ref.getAttribute("data-testid"))!.replace("shop-entry-ref-", "");

  await expect(page.getByTestId(`shop-entry-kind-${state.entry}`)).toHaveText("Payout");
  await expect(page.getByTestId(`shop-entry-import-${state.entry}`)).toHaveAttribute("href", `/settlement/imports/${state.file}`);
  await expect(page.getByTestId(`shop-entry-by-${state.entry}`)).not.toContainText("#");

  // The statement link opens the import it came from.
  await page.getByTestId(`shop-entry-import-${state.entry}`).click();
  await expect(page.getByTestId("import-detail-shop")).toContainText(SHOP_NAME);
});

test("Reverse posts the opposite row, the entry reads Reversed, and the totals are back", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto("/settlement/shop-entries");
  await page.getByTestId(`shop-entry-reverse-${state.entry}`).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(rp(75_000));
  await dialog.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`shop-entry-reversed-${state.entry}`)).toHaveText("Reversed");
  await expect(page.getByTestId(`shop-entry-reverse-${state.entry}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="shop-entry-reversal-"]')).toHaveText(`Reverses #${state.entry}`);
  await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
  await expect(page.getByTestId("shop-entries-received")).toContainText(rp(0));

  // A second reverse is refused by the server — a row is reversed once.
  const again = await page.evaluate(
    async ([team, shop, entry]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch("http://localhost:8081/warehouse.settlement.v1.SettlementWriteService/SettlementPost", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          teamId: team,
          shopId: shop,
          orderId: "0",
          uniqueId: `reverse-${entry}-again`,
          settlementType: "SETTLEMENT_TYPE_FUND",
          sourceType: "SOURCE_TYPE_MANUAL",
          change: -75000,
          occurredOn: "2026-09-02",
          reversesId: entry,
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    [state.team, state.shop, state.entry] as const,
  );
  expect(again.status).toBe(400);
  expect(again.body).toContain("already reversed");
});

// The way in from the report: its By shop row opens this shop's entries (the report is fed by the fold's push, so it is
// polled until the shop's row lands).
test("The report's By shop row opens the shop's entries", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  const row = page.getByTestId(`report-group-row-${state.shop}`);
  await expect(async () => {
    await page.goto("/settlement/report");
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/settlement/shop-entries\\?shop=${state.shop}`));
  await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
});
