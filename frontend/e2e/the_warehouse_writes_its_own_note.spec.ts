import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { SUFFIX, api } from "./restock_helpers";

// THE RECEIVING WAREHOUSE WRITES ITS OWN NOTE ON A RESTOCK — end to end, on the real server and Postgres (backlog #67):
//
//   the-warehouse-writes-its-own-note (docs/technical/frontend/restock_decision.md) — on the warehouse's page Ubah sits
//     on the WAREHOUSE's note and the selling team's is read; the save keeps it with its writer and time
//     (RestockRequestWarehouseNoteSet), and its change is an edit's row on the Riwayat (*Warehouse note “…”*);
//   the-notes-are-one-per-writer — the selling team's page and the list's Catatan dialog read it under the warehouse's
//     badge with who and when, never write it;
//   three-notes-one-writer-each (docs/business/inventory/restock_decision.md) — one writer each: only the receiving
//     warehouse writes it, and neither team's write reaches the other's note;
//   an-override-shows-a-platform-badge (docs/business/user/context_decision.md) — a note root wrote from outside the
//     warehouse carries the "by Root team" badge.
//
// The people: SARI, a selling admin, owns the selling team that raises the restock; DEDI is STAFF of the receiving
// warehouse (owned by WATI, so root holds no role there and its write is an override); EKO is staff of ANOTHER warehouse.
// Root only seeds the ground and moves the restock's status, on a page of its own.
//
// ⚠ NOT PINNED: FROM WHEN the warehouse may write its note — undecided (the-notes-are-one-per-writer: the owner leans to
// *from the box's arrival* and says the call is not his), so this spec only pins that today the server refuses no status
// and must be changed if that rule is ever decided. A restock moved to another warehouse while ongoing (no decision
// covers whose note it keeps). No money event is checked (none is sent, per the hand-off — nothing on screen shows one).

const PASSWORD = "e2e-whnote-pass-1";
const SERVICE = "inventory.v1.RestockRequestService";
const WAREHOUSE_NOTE = "RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE_NOTE";
const NOTE = "RESTOCK_LOG_CHANGE_FIELD_NOTE";

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function whNoteGround(browser: Browser, page: Page, tag: string) {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string, ownerUserId: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId })).team.id);
  const user = async (teamId: string, username: string, name: string, role: string) =>
    String((await api(root, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name, role })).user.id);

  // TeamCreate names an EXISTING person as the owner, so Sari's and Wati's accounts are made first, in a scratch team.
  const scratch = await team(`E2E WhNote Scratch ${tag} ${SUFFIX}`, `WX${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", ROOT_USER_ID);
  const sariUsername = `e2ewhnsari${tag.toLowerCase()}${SUFFIX}`;
  const sariName = `Sari WhNote ${tag} ${SUFFIX}`;
  const sari = await user(scratch, sariUsername, sariName, "ROLE_SELLING_ADMIN");
  const wati = await user(scratch, `e2ewhnwati${tag.toLowerCase()}${SUFFIX}`, `Wati WhNote ${tag} ${SUFFIX}`, "ROLE_SELLING_ADMIN");
  const seller = await team(`E2E WhNote Seller ${tag} ${SUFFIX}`, `WS${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", sari);

  // The receiving warehouse is WATI's — root holds no role in it.
  const warehouse = await team(`E2E WhNote Gudang ${tag} ${SUFFIX}`, `WW${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", wati);
  const dediUsername = `e2ewhndedi${tag.toLowerCase()}${SUFFIX}`;
  const dediName = `Dedi WhNote ${tag} ${SUFFIX}`;
  const dedi = await user(warehouse, dediUsername, dediName, "ROLE_WAREHOUSE_STAFF");
  const rack = String(
    (await api(root, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `whn-${tag.toLowerCase()}-${SUFFIX}`, name: "E2E whnote shelf" }))
      .rack.id,
  );

  // A third team — another warehouse — and its staff.
  const other = await team(`E2E WhNote Gudang Lain ${tag} ${SUFFIX}`, `WO${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", ROOT_USER_ID);
  const ekoUsername = `e2ewhneko${tag.toLowerCase()}${SUFFIX}`;
  await user(other, ekoUsername, `Eko WhNote ${tag} ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF");

  const category = await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E WhNote Cat ${tag} ${SUFFIX}` });
  const codePart = `WNP${tag}${SUFFIX}`;
  const created = (
    await api(root, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: codePart, name: `E2E ${codePart}`, categoryId: category.category.id })
  ).product;
  const product = { id: String(created.id), code: String(created.productCode || codePart), name: `E2E ${codePart}` };

  const account = String(
    (
      await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E WhNote Kas ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `WHN-${tag}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: seller, accountId: account, operational: true });

  // Sari on the test's own page, in her selling team; Dedi on a page of his own, in his warehouse; Eko in his.
  await signIn(page, sariUsername, PASSWORD);
  await asTeam(page, seller);
  const door = await browser.newPage();
  await signIn(door, dediUsername, PASSWORD);
  await asTeam(door, warehouse);
  const eko = await browser.newPage();
  await signIn(eko, ekoUsername, PASSWORD);
  await asTeam(eko, other);

  const close = async () => {
    await root.close();
    await door.close();
    await eko.close();
  };

  return { root, door, eko, sari, sariName, dedi, dediName, seller, warehouse, other, rack, product, account, close };
}

type Ground = Awaited<ReturnType<typeof whNoteGround>>;

// Sari raises a restock of 2 × the product for Rp 20.000 with a note — `n` keeps its resi unique within the team.
async function raise(page: Page, g: Ground, n: number, note: string) {
  return (
    await api(page, `${SERVICE}/RestockRequestCreate`, {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.account,
      receipt: `E2E-WHNOTE-${n}-${g.seller}-${SUFFIX}`,
      note,
      items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count: 2, total: 20_000 }],
    })
  ).request;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detail(page: Page, teamId: string, id: string): Promise<any> {
  return (await api(page, `${SERVICE}/RestockRequestDetail`, { teamId, requestId: id })).request;
}

const whNoteSet = (who: Page, teamId: string, requestId: string, note: string) =>
  api(who, `${SERVICE}/RestockRequestWarehouseNoteSet`, { teamId, requestId, note });

// The trail's changes of one field, oldest first — each edit row's value before → after.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function changesOf(request: any, field: string): string[] {
  return (request.logs as { description: string; changes?: { field: string; before?: string; after?: string }[] }[])
    .filter((l) => l.description === "edited")
    .flatMap((l) => (l.changes ?? []).filter((c) => c.field === field).map((c) => `${c.before ?? ""} → ${c.after ?? ""}`));
}

// The edit rows that changed the warehouse note — each must change NOTHING else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warehouseNoteRows(request: any): { id: string; fields: string[] }[] {
  return (request.logs as { id: string; description: string; changes?: { field: string }[] }[])
    .filter((l) => l.description === "edited" && (l.changes ?? []).some((c) => c.field === WAREHOUSE_NOTE))
    .map((l) => ({ id: `restock-timeline-${l.id}`, fields: (l.changes ?? []).map((c) => c.field) }));
}

const nowUnix = () => Math.floor(Date.now() / 1000);

test.describe("the receiving warehouse writes its own note", () => {
  test.describe.configure({ timeout: 150_000 });

  test("Warehouse note: Dedi writes it on the warehouse's page — kept with his name and time, the trail says it, Sari reads it on her page and in the list's Catatan, never writes it", async ({
    browser,
    page,
  }) => {
    const g = await whNoteGround(browser, page, "A");
    const SELLING = "for the 12.12 sale";
    const W1 = "box corner crushed, contents fine";

    // GIVEN — Sari's ongoing restock with her note; the warehouse has written nothing yet.
    const raised = await raise(page, g, 1, SELLING);
    const id = String(raised.id);
    expect(raised.warehouseNote ?? "").toBe("");

    // The warehouse's page: the selling note is READ (no Ubah on it); the warehouse's own block says nothing is written.
    await g.door.goto(`/inventories/restock/${id}`);
    const selling = g.door.getByTestId("restock-detail-note-selling");
    await expect(selling.getByTestId("restock-detail-note")).toHaveText(SELLING);
    await expect(selling.getByTestId("restock-notes-edit")).toHaveCount(0);
    const mine = g.door.getByTestId("restock-detail-note-warehouse");
    await expect(mine.getByTestId("restock-detail-note-warehouse-text")).toHaveText("No note from the warehouse yet.");
    await expect(mine.getByTestId("restock-detail-note-warehouse-by")).toHaveCount(0);

    // WHEN — Dedi writes the warehouse's note from its Ubah.
    const before = nowUnix() - 5;
    await mine.getByTestId("restock-warehouse-note-edit").click();
    await mine.getByTestId("restock-warehouse-note-input").fill(W1);
    await mine.getByTestId("restock-warehouse-note-save").click();
    await expect(mine.getByTestId("restock-detail-note-warehouse-text")).toHaveText(W1);
    await expect(mine.getByTestId("restock-detail-note-warehouse-by")).toContainText(g.dediName);

    // THEN — kept: read back after a reload and from the server — Dedi its writer, stamped now, not an override; the
    // status unchanged, and the selling note and ITS writer untouched (three-notes-one-writer-each).
    await g.door.reload();
    await expect(g.door.getByTestId("restock-detail-note-warehouse-text")).toHaveText(W1);
    await expect(g.door.getByTestId("restock-detail-note-warehouse-by")).toContainText(g.dediName);
    const after = await detail(g.door, g.warehouse, id);
    expect(after.status).toBe("RESTOCK_REQUEST_STATUS_ONGOING");
    expect(after.warehouseNote).toBe(W1);
    expect(after.warehouseNoteByUserId).toBe(g.dedi);
    expect(after.warehouseNoteByIsOverride ?? false).toBe(false);
    expect(Number(after.warehouseNoteAtUnix)).toBeGreaterThanOrEqual(before);
    expect(after.note).toBe(SELLING);
    expect(after.noteByUserId).toBe(g.sari);
    expect(after.noteAtUnix).toBe(raised.noteAtUnix);

    // THEN — the trail: ONE edit row, the warehouse note "" → W1 and nothing else under it, drawn on the warehouse's page.
    expect(changesOf(after, WAREHOUSE_NOTE)).toEqual([` → ${W1}`]);
    expect(changesOf(after, NOTE)).toEqual([]);
    const rows = warehouseNoteRows(after);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields).toEqual([WAREHOUSE_NOTE]);
    const row = rows[0].id;
    await expect(g.door.getByTestId(`${row}-change-warehouse_note`)).toHaveText(`Warehouse note “${W1}”`);
    await expect(g.door.getByTestId(`${row}-changes`).locator(`[data-testid^='${row}-change-']`)).toHaveCount(1);

    // THEN — Sari's page reads the warehouse's note under its badge, with Dedi's name — and offers her no Ubah on it. Her
    // own note still names her (the warehouse's write is not read as her note's last change), and the trail says it too.
    await page.goto(`/inventories/restock/${id}`);
    const theirs = page.getByTestId("restock-detail-note-warehouse");
    await expect(theirs.getByTestId("restock-detail-note-warehouse-text")).toHaveText(W1);
    await expect(theirs.getByTestId("restock-detail-note-warehouse-by")).toContainText(g.dediName);
    await expect(theirs.getByTestId("restock-warehouse-note-edit")).toHaveCount(0);
    await expect(theirs.getByTestId("restock-notes-edit")).toHaveCount(0);
    const own = page.getByTestId("restock-detail-note-selling");
    await expect(own.getByTestId("restock-detail-note")).toHaveText(SELLING);
    await expect(own.getByTestId("restock-detail-note-selling-by")).toContainText(g.sariName);
    await expect(page.getByTestId(`${row}-change-warehouse_note`)).toHaveText(`Warehouse note “${W1}”`);

    // THEN — Sari's list, the row's ⋯ › Catatan: the same note, the same writer, read-only.
    await page.goto("/inventories/restock");
    await page.getByTestId(`restock-actions-${id}`).click();
    await page.getByTestId(`restock-action-notes-${id}`).click();
    const dialog = page.getByTestId("restock-notes-dialog");
    await expect(dialog).toBeVisible();
    const inDialog = dialog.getByTestId("restock-detail-note-warehouse");
    await expect(inDialog.getByTestId("restock-detail-note-warehouse-text")).toHaveText(W1);
    await expect(inDialog.getByTestId("restock-detail-note-warehouse-by")).toContainText(g.dediName);
    await expect(inDialog.getByTestId("restock-warehouse-note-edit")).toHaveCount(0);
    await expect(inDialog.getByTestId("restock-notes-edit")).toHaveCount(0);

    await g.close();
  });

  test("Warehouse note: only the receiving warehouse writes it, in every status — the others are refused, the same note writes nothing, root's write is an override, the selling team's writes leave it", async ({
    browser,
    page,
  }) => {
    const g = await whNoteGround(browser, page, "B");

    const r1 = await raise(page, g, 1, "urgent");
    const id1 = String(r1.id);

    await test.step("ongoing: Dedi's note is kept, Dedi its writer", async () => {
      const set = (await whNoteSet(g.door, g.warehouse, id1, "rack 3 is full, will go on rack 4")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_ONGOING");
      expect(set.warehouseNote).toBe("rack 3 is full, will go on rack 4");
      expect(set.warehouseNoteByUserId).toBe(g.dedi);
      expect(set.warehouseNoteByIsOverride ?? false).toBe(false);
    });

    await test.step("the same note again writes nothing — no trail row, the writer and time unchanged", async () => {
      const before = await detail(g.door, g.warehouse, id1);
      await whNoteSet(g.door, g.warehouse, id1, "rack 3 is full, will go on rack 4");
      const d = await detail(g.door, g.warehouse, id1);
      expect(d.logs).toHaveLength(before.logs.length);
      expect(d.warehouseNoteByUserId).toBe(g.dedi);
      expect(d.warehouseNoteAtUnix).toBe(before.warehouseNoteAtUnix);
    });

    await test.step("the selling team, another warehouse, and an unknown restock are refused — and change nothing", async () => {
      // Sari holds no warehouse role: refused in her own team's scope and in the warehouse's.
      await expect(whNoteSet(page, g.seller, id1, "from the seller")).rejects.toThrow(/: (403|404) /);
      await expect(whNoteSet(page, g.warehouse, id1, "from the seller")).rejects.toThrow(/: (403|404) /);
      // Root passes every policy, but the selling team's scope is not the receiving warehouse: NotFound.
      await expect(whNoteSet(g.root, g.seller, id1, "root, as the seller")).rejects.toThrow(/: 404 /);
      // Eko is staff of ANOTHER warehouse — the restock is not his warehouse's: NotFound.
      await expect(whNoteSet(g.eko, g.other, id1, "from the other warehouse")).rejects.toThrow(/: 404 /);
      // An unknown restock, asked by the receiving warehouse itself: NotFound.
      await expect(whNoteSet(g.door, g.warehouse, "999999999", "no such restock")).rejects.toThrow(/: 404 /);

      const d = await detail(g.door, g.warehouse, id1);
      expect(d.warehouseNote).toBe("rack 3 is full, will go on rack 4");
      expect(d.warehouseNoteByUserId).toBe(g.dedi);
      expect(changesOf(d, WAREHOUSE_NOTE)).toEqual([" → rack 3 is full, will go on rack 4"]);
    });

    await test.step("the selling team's writes leave the warehouse note — an edit of a line, then a note set", async () => {
      const stamped = (await detail(g.door, g.warehouse, id1)).warehouseNoteAtUnix;
      await api(page, `${SERVICE}/RestockRequestUpdate`, {
        teamId: g.seller,
        requestId: id1,
        warehouseId: g.warehouse,
        financeAccountId: g.account,
        receipt: r1.receipt,
        note: "urgent",
        items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count: 3, total: 30_000 }],
      });
      await api(page, `${SERVICE}/RestockRequestNoteSet`, { teamId: g.seller, requestId: id1, note: "urgent, two boxes" });

      const d = await detail(page, g.seller, id1);
      expect(d.items[0].count).toBe("3");
      expect(d.note).toBe("urgent, two boxes");
      expect(d.warehouseNote).toBe("rack 3 is full, will go on rack 4");
      expect(d.warehouseNoteByUserId).toBe(g.dedi);
      expect(d.warehouseNoteAtUnix).toBe(stamped);
      expect(changesOf(d, WAREHOUSE_NOTE)).toEqual([" → rack 3 is full, will go on rack 4"]);
    });

    await test.step("arrived: Dedi's change is kept — and the selling note and its writer stay Sari's", async () => {
      await api(g.root, `${SERVICE}/RestockRequestArrive`, { teamId: g.warehouse, requestId: id1 });
      const set = (await whNoteSet(g.door, g.warehouse, id1, "arrived wet, dried on rack 4")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_ARRIVED");
      expect(set.warehouseNote).toBe("arrived wet, dried on rack 4");
      expect(set.warehouseNoteByUserId).toBe(g.dedi);
      expect(set.note).toBe("urgent, two boxes");
      expect(set.noteByUserId).toBe(g.sari);
    });

    await test.step("accepted: root, who holds no role in the warehouse, writes it — kept, root its writer, an override with its badge", async () => {
      const d0 = await detail(g.door, g.warehouse, id1);
      await api(g.root, `${SERVICE}/RestockRequestAccept`, {
        teamId: g.warehouse,
        requestId: id1,
        lines: [{ itemId: d0.items[0].id, receivedCount: 3, placements: [{ placementId: g.rack, quantity: 3 }] }],
      });
      const set = (await whNoteSet(g.root, g.warehouse, id1, "counted in whole by root")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
      expect(set.warehouseNote).toBe("counted in whole by root");
      expect(set.warehouseNoteByUserId).toBe(ROOT_USER_ID);
      expect(set.warehouseNoteByIsOverride).toBe(true);

      // Sari's page: the warehouse block carries the "by Root team" badge, not Dedi's name.
      await page.goto(`/inventories/restock/${id1}`);
      const theirs = page.getByTestId("restock-detail-note-warehouse");
      await expect(theirs.getByTestId("restock-detail-note-warehouse-text")).toHaveText("counted in whole by root");
      await expect(theirs.getByTestId("root-team-badge")).toBeVisible();
      await expect(theirs.getByTestId("restock-detail-note-warehouse-by")).not.toContainText(g.dediName);
    });

    await test.step("cleared: an empty note is a change too — each write its own edit row, the warehouse note alone", async () => {
      const cleared = (await whNoteSet(g.door, g.warehouse, id1, "")).request;
      expect(cleared.warehouseNote ?? "").toBe("");
      expect(cleared.warehouseNoteByUserId).toBe(g.dedi);

      const d = await detail(g.door, g.warehouse, id1);
      expect(changesOf(d, WAREHOUSE_NOTE)).toEqual([
        " → rack 3 is full, will go on rack 4",
        "rack 3 is full, will go on rack 4 → arrived wet, dried on rack 4",
        "arrived wet, dried on rack 4 → counted in whole by root",
        "counted in whole by root → ",
      ]);
      for (const r of warehouseNoteRows(d)) expect(r.fields).toEqual([WAREHOUSE_NOTE]);

      // The last row reads as a removal on the warehouse's page.
      const last = warehouseNoteRows(d).at(-1)!.id;
      await g.door.goto(`/inventories/restock/${id1}`);
      await expect(g.door.getByTestId(`${last}-change-warehouse_note`)).toHaveText("Warehouse note removed");
    });

    await test.step("cancelled and lost restocks take it too — the server refuses no status today", async () => {
      const r2 = await raise(page, g, 2, "");
      const id2 = String(r2.id);
      await api(page, `${SERVICE}/RestockRequestCancel`, { teamId: g.seller, requestId: id2, moneyReturned: false });
      const c = (await whNoteSet(g.door, g.warehouse, id2, "never came, supplier called it off")).request;
      expect(c.status).toBe("RESTOCK_REQUEST_STATUS_CANCELLED");
      expect(c.warehouseNote).toBe("never came, supplier called it off");

      const r3 = await raise(page, g, 3, "");
      const id3 = String(r3.id);
      await api(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: g.seller, requestId: id3, description: "the courier lost it" });
      const l = (await whNoteSet(g.door, g.warehouse, id3, "no box reached our door")).request;
      expect(l.status).toBe("RESTOCK_REQUEST_STATUS_LOST");
      expect(l.warehouseNote).toBe("no box reached our door");
      expect(l.warehouseNoteByUserId).toBe(g.dedi);
    });

    await g.close();
  });
});
