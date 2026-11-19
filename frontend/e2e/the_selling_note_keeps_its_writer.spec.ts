import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { SUFFIX, api } from "./restock_helpers";

// THE SELLING NOTE KEEPS ITS OWN WRITER, AND IS WRITTEN IN ANY STATUS — end to end, on the real server and Postgres.
//
//   three-notes-one-writer-each (docs/business/inventory/restock_decision.md) — `restocks.note` is the selling team's, one
//     writer; the-notes-are-one-per-writer (docs/technical/frontend/restock_decision.md) — its head says WHO wrote the
//     note and WHEN: the raise, or an edit / a note set that changed the note, never an edit of a line;
//   the-note-is-edited-in-any-status — Ubah on the selling note in every status, and the note is KEPT (it was a toast
//     saying it was not saved once the box had arrived);
//   edits-are-in-the-same-trail — a note change is an edit's row on the trail, the note before → after;
//   an-override-shows-a-platform-badge (docs/business/user/context_decision.md) — a note root wrote from outside the team
//     carries the "by Root team" badge.
//
// The selling team is SARI's — root holds no role in it, so a note root writes there is an override. Every test seeds its
// own ground: a scratch team of root's (where Sari's account is made), Sari's selling team, root's warehouse and rack, one
// product and a paying account.
//
// ⚠ NOT PINNED: an OLD restock — one whose note was written before the writer was kept — and its fallback label
// (`restock-detail-note-selling-by-fallback`). Every raise stamps the writer, so no such row can be made through the
// contract. An ONGOING restock's note saved from the screen goes alone through the note set since backlog #71 — the last
// test pins it, a colleague's line edit made while the note was open kept.

const PASSWORD = "e2e-note-pass-1";
const SERVICE = "inventory.v1.RestockRequestService";
const NOTE = "RESTOCK_LOG_CHANGE_FIELD_NOTE";

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Root on a page of its own (`root`), Sari on the test's `page`, working in her selling team.
async function noteGround(browser: Browser, page: Page, tag: string) {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string, ownerUserId: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId })).team.id);

  // TeamCreate names an EXISTING person as the owner, so Sari's account is made first, in a scratch team of root's.
  const scratch = await team(`E2E Note Scratch ${tag} ${SUFFIX}`, `NX${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", ROOT_USER_ID);
  const sariUsername = `e2enote${tag.toLowerCase()}${SUFFIX}`;
  const sariName = `Sari Note ${tag} ${SUFFIX}`;
  const sari = String(
    (
      await api(root, "user.v1.UserService/CreateUser", {
        teamId: scratch,
        username: sariUsername,
        password: PASSWORD,
        name: sariName,
        role: "ROLE_SELLING_ADMIN",
      })
    ).user.id,
  );

  const seller = await team(`E2E Note Seller ${tag} ${SUFFIX}`, `NS${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", sari);
  const warehouse = await team(`E2E Note Warehouse ${tag} ${SUFFIX}`, `NW${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", ROOT_USER_ID);
  const rack = String(
    (await api(root, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `note-${tag.toLowerCase()}-${SUFFIX}`, name: "E2E note shelf" }))
      .rack.id,
  );

  const category = await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E Note Cat ${tag} ${SUFFIX}` });
  const codePart = `NP${tag}${SUFFIX}`;
  const created = (
    await api(root, "product.v1.ProductService/ProductCreate", {
      teamId: seller,
      productCodePart: codePart,
      name: `E2E ${codePart}`,
      categoryId: category.category.id,
    })
  ).product;
  const product = { id: String(created.id), code: String(created.productCode || codePart), name: `E2E ${codePart}` };

  const account = String(
    (
      await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Note Kas ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `NOTE-${tag}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });

  // Sari signs in on the test's own page, in her selling team.
  await signIn(page, sariUsername, PASSWORD);
  await asTeam(page, seller);

  return { root, sari, sariName, seller, warehouse, rack, product, account };
}

type Ground = Awaited<ReturnType<typeof noteGround>>;

// Sari raises a restock of 2 × the product for Rp 20.000 — `n` keeps its resi unique within the team.
async function raise(page: Page, g: Ground, n: number, note: string) {
  return (
    await api(page, `${SERVICE}/RestockRequestCreate`, {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.account,
      receipt: `E2E-NOTE-${n}-${g.seller}-${SUFFIX}`,
      note,
      items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count: 2, total: 20_000 }],
    })
  ).request;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detail(page: Page, g: Ground, id: string): Promise<any> {
  return (await api(page, `${SERVICE}/RestockRequestDetail`, { teamId: g.seller, requestId: id })).request;
}

// The trail's note changes, oldest first — each edit row's note before → after.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function noteChanges(request: any): string[] {
  return (request.logs as { description: string; changes?: { field: string; before?: string; after?: string }[] }[])
    .filter((l) => l.description === "edited")
    .flatMap((l) => (l.changes ?? []).filter((c) => c.field === NOTE).map((c) => `${c.before ?? ""} → ${c.after ?? ""}`));
}

// The edit rows of the trail, oldest first, by their log ids.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function editRows(request: any): string[] {
  return (request.logs as { id: string; description: string }[]).filter((l) => l.description === "edited").map((l) => `restock-timeline-${l.id}`);
}

const nowUnix = () => Math.floor(Date.now() / 1000);

test.describe("the selling note keeps its writer, and is written in any status", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Selling note: written on an ARRIVED restock from its page — kept, its head names the writer, the trail says before → after", async ({
    browser,
    page,
  }) => {
    const g = await noteGround(browser, page, "A");
    const N1 = "for the 12.12 sale";
    const N2 = "box came early, sell it first";

    // GIVEN — Sari raises a restock with a note; the raise records her as the note's writer. The warehouse signs for the box.
    const raised = await raise(page, g, 1, N1);
    const id = String(raised.id);
    expect(raised.noteByUserId).toBe(g.sari);
    expect(Number(raised.noteAtUnix)).toBeGreaterThan(0);
    expect(raised.noteByIsOverride ?? false).toBe(false);
    await api(g.root, `${SERVICE}/RestockRequestArrive`, { teamId: g.warehouse, requestId: id });

    // The head names the note's own writer (data-source="note"), never the restock's last change standing in.
    await page.goto(`/inventories/restock/${id}`);
    const note = page.getByTestId("restock-detail-note-selling");
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N1);
    await expect(note.getByTestId("restock-detail-note-selling-by")).toHaveAttribute("data-source", "note");
    await expect(note.getByTestId("restock-detail-note-selling-by")).toContainText(g.sariName);
    await expect(note.getByTestId("restock-detail-note-selling-by-fallback")).toHaveCount(0);

    // WHEN — Sari changes the note from Ubah, the box already arrived.
    const before = nowUnix() - 5;
    await note.getByTestId("restock-notes-edit").click();
    await note.getByTestId("restock-notes-input").fill(N2);
    await note.getByTestId("restock-notes-save").click();
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N2);

    // THEN — kept: read back after a reload and from the server, the status unchanged, Sari its writer, stamped now.
    await page.reload();
    await expect(page.getByTestId("restock-detail-note")).toHaveText(N2);
    const after = await detail(page, g, id);
    expect(after.status).toBe("RESTOCK_REQUEST_STATUS_ARRIVED");
    expect(after.note).toBe(N2);
    expect(after.noteByUserId).toBe(g.sari);
    expect(after.noteByIsOverride ?? false).toBe(false);
    expect(Number(after.noteAtUnix)).toBeGreaterThanOrEqual(before);
    await expect(page.getByTestId("restock-detail-note-selling-by")).toContainText(g.sariName);

    // THEN — the trail: ONE edit row, and under it the note before → after and nothing else.
    expect(noteChanges(after)).toEqual([`${N1} → ${N2}`]);
    const [row] = editRows(after);
    expect(editRows(after)).toHaveLength(1);
    await expect(page.getByTestId(`${row}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);
    await expect(page.getByTestId(`${row}-changes`).locator(`[data-testid^='${row}-change-']`)).toHaveCount(1);

    // THEN — the warehouse's page reads the same note, the same writer, and the note's change on the trail; the selling
    // team's note is not the warehouse's to change (three-notes-one-writer-each).
    await asTeam(g.root, g.warehouse);
    await g.root.goto(`/inventories/restock/${id}`);
    const read = g.root.getByTestId("restock-detail-note-selling");
    await expect(read.getByTestId("restock-detail-note")).toHaveText(N2);
    await expect(read.getByTestId("restock-detail-note-selling-by")).toHaveAttribute("data-source", "note");
    await expect(read.getByTestId("restock-detail-note-selling-by")).toContainText(g.sariName);
    await expect(read.getByTestId("restock-notes-edit")).toHaveCount(0);
    await expect(g.root.getByTestId(`${row}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);

    await g.root.close();
  });

  test("Selling note: on an ACCEPTED restock — root's note carries the Root team badge, Sari rewrites it from the list's Catatan and it is kept", async ({
    browser,
    page,
  }) => {
    const g = await noteGround(browser, page, "B");
    const N1 = "urgent";
    const N2 = "checked by root";
    const N3 = "sold out already, raise again next week";

    // GIVEN — Sari's restock, counted in whole at the warehouse (accepted).
    const raised = await raise(page, g, 1, N1);
    const id = String(raised.id);
    await api(g.root, `${SERVICE}/RestockRequestAccept`, {
      teamId: g.warehouse,
      requestId: id,
      lines: [{ itemId: raised.items[0].id, receivedCount: 2, placements: [{ placementId: g.rack, quantity: 2 }] }],
    });

    // WHEN — root, who holds no role in Sari's team, writes the note: it is kept, root its writer, stamped as an override.
    const set = (await api(g.root, `${SERVICE}/RestockRequestNoteSet`, { teamId: g.seller, requestId: id, note: N2 })).request;
    expect(set.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(set.note).toBe(N2);
    expect(set.noteByUserId).toBe(ROOT_USER_ID);
    expect(set.noteByIsOverride).toBe(true);

    // THEN — Sari's list, the row's ⋯ › Catatan: root's note, its head carrying the "by Root team" badge, not Sari's name.
    await page.goto("/inventories/restock");
    await page.getByTestId(`restock-actions-${id}`).click();
    await page.getByTestId(`restock-action-notes-${id}`).click();
    const dialog = page.getByTestId("restock-notes-dialog");
    await expect(dialog).toBeVisible();
    const note = dialog.getByTestId("restock-detail-note-selling");
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N2);
    const by = note.getByTestId("restock-detail-note-selling-by");
    await expect(by).toHaveAttribute("data-source", "note");
    await expect(by).not.toContainText(g.sariName);
    await expect(note.getByTestId("root-team-badge")).toBeVisible();

    // WHEN — Sari rewrites it in the dialog, the restock long accepted.
    await note.getByTestId("restock-notes-edit").click();
    await note.getByTestId("restock-notes-input").fill(N3);
    await note.getByTestId("restock-notes-save").click();

    // THEN — the dialog reads her note, her name in the head, and no badge any more.
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N3);
    await expect(by).toContainText(g.sariName);
    await expect(note.getByTestId("root-team-badge")).toHaveCount(0);

    // THEN — kept on the server, still accepted; the trail holds both writes, each the note before → after.
    const after = await detail(page, g, id);
    expect(after.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(after.note).toBe(N3);
    expect(after.noteByUserId).toBe(g.sari);
    expect(after.noteByIsOverride ?? false).toBe(false);
    expect(noteChanges(after)).toEqual([`${N1} → ${N2}`, `${N2} → ${N3}`]);

    // …and the restock's page draws both rows.
    await page.goto(`/inventories/restock/${id}`);
    const rows = editRows(after);
    await expect(page.getByTestId(`${rows[0]}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);
    await expect(page.getByTestId(`${rows[1]}-change-note`)).toHaveText(`Note “${N2}” → “${N3}”`);

    await g.root.close();
  });

  test("Selling note: the writer moves only with the note — every status takes it, the same note writes nothing, the warehouse cannot set it", async ({
    browser,
    page,
  }) => {
    const g = await noteGround(browser, page, "C");
    const noteSet = (who: Page, teamId: string, requestId: string, note: string) =>
      api(who, `${SERVICE}/RestockRequestNoteSet`, { teamId, requestId, note });

    // A raise records its writer even with no note.
    const r1 = await raise(page, g, 1, "");
    const id1 = String(r1.id);
    expect(r1.noteByUserId).toBe(g.sari);
    expect(Number(r1.noteAtUnix)).toBeGreaterThan(0);
    const stamped = r1.noteAtUnix;

    await test.step("an edit of a line alone (root's, while ongoing) leaves the note's writer and time as they were", async () => {
      await api(g.root, `${SERVICE}/RestockRequestUpdate`, {
        teamId: g.seller,
        requestId: id1,
        warehouseId: g.warehouse,
        financeAccountId: g.account,
        receipt: r1.receipt,
        note: "",
        items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count: 3, total: 30_000 }],
      });
      const d = await detail(page, g, id1);
      expect(d.items[0].count).toBe("3");
      expect(d.noteByUserId).toBe(g.sari);
      expect(d.noteAtUnix).toBe(stamped);
      expect(d.noteByIsOverride ?? false).toBe(false);
      expect(noteChanges(d)).toEqual([]);
    });

    await test.step("ongoing: root's note set is kept, root its writer, an override", async () => {
      const set = (await noteSet(g.root, g.seller, id1, "on its way")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_ONGOING");
      expect(set.note).toBe("on its way");
      expect(set.noteByUserId).toBe(ROOT_USER_ID);
      expect(set.noteByIsOverride).toBe(true);
    });

    await test.step("the same note again writes nothing — no trail row, the writer stays root", async () => {
      const before = await detail(page, g, id1);
      await noteSet(page, g.seller, id1, "on its way");
      const d = await detail(page, g, id1);
      expect(d.logs).toHaveLength(before.logs.length);
      expect(d.noteByUserId).toBe(ROOT_USER_ID);
      expect(d.noteAtUnix).toBe(before.noteAtUnix);
    });

    await test.step("the receiving warehouse's scope, and an unknown restock, are refused — NotFound — and change nothing", async () => {
      await expect(noteSet(g.root, g.warehouse, id1, "from the warehouse")).rejects.toThrow(/: 404 /);
      await expect(noteSet(page, g.seller, "999999999", "no such restock")).rejects.toThrow(/: 404 /);
      const d = await detail(page, g, id1);
      expect(d.note).toBe("on its way");
      expect(noteChanges(d)).toEqual([" → on its way"]);
    });

    await test.step("cancelled: Sari's note is kept, the status unchanged, Sari its writer", async () => {
      await api(page, `${SERVICE}/RestockRequestCancel`, { teamId: g.seller, requestId: id1, moneyReturned: false });
      const set = (await noteSet(page, g.seller, id1, "called off, supplier out of stock")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_CANCELLED");
      expect(set.note).toBe("called off, supplier out of stock");
      expect(set.noteByUserId).toBe(g.sari);
      expect(set.noteByIsOverride ?? false).toBe(false);
      expect(noteChanges(await detail(page, g, id1))).toEqual([" → on its way", "on its way → called off, supplier out of stock"]);
    });

    await test.step("lost: the note is kept — and clearing it is a change too", async () => {
      const r2 = await raise(page, g, 2, "before it went missing");
      const id2 = String(r2.id);
      await api(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: g.seller, requestId: id2, description: "the courier lost it" });

      const set = (await noteSet(page, g.seller, id2, "claim filed with the courier")).request;
      expect(set.status).toBe("RESTOCK_REQUEST_STATUS_LOST");
      expect(set.note).toBe("claim filed with the courier");

      const cleared = (await noteSet(page, g.seller, id2, "")).request;
      expect(cleared.note ?? "").toBe("");
      expect(cleared.noteByUserId).toBe(g.sari);
      expect(noteChanges(await detail(page, g, id2))).toEqual([
        "before it went missing → claim filed with the courier",
        "claim filed with the courier → ",
      ]);
    });

    await g.root.close();
  });

  test("Selling note: on an ONGOING restock it is saved alone — a colleague's line edit made while the note was open is kept, from the page and from the list's Catatan", async ({
    browser,
    page,
  }) => {
    const g = await noteGround(browser, page, "D");
    const N1 = "first batch for the 11.11 sale";
    const N2 = "keep two aside for the live stream";
    const N3 = "the rest goes to the reseller";

    // Every restock write Sari's page sends, by RPC name, from now on.
    const writes: string[] = [];
    page.on("request", (r) => {
      const m = r.url().match(/RestockRequestService\/(RestockRequest(?:NoteSet|Update))$/);
      if (m) writes.push(m[1]!);
    });

    // GIVEN — Sari's restock of 2 units, on its way.
    const raised = await raise(page, g, 1, N1);
    const id = String(raised.id);

    // A colleague's edit of the line (root's, from its own page), the note sent back as it stood.
    const lineEdit = (count: number, note: string) =>
      api(g.root, `${SERVICE}/RestockRequestUpdate`, {
        teamId: g.seller,
        requestId: id,
        warehouseId: g.warehouse,
        financeAccountId: g.account,
        receipt: raised.receipt,
        note,
        items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count, total: count * 10_000 }],
      });

    // WHEN — Sari opens the note on the restock's page and types; meanwhile the colleague changes the line to 3; she saves.
    await page.goto(`/inventories/restock/${id}`);
    const note = page.getByTestId("restock-detail-note-selling");
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N1);
    await note.getByTestId("restock-notes-edit").click();
    await note.getByTestId("restock-notes-input").fill(N2);
    await lineEdit(3, N1);
    await note.getByTestId("restock-notes-save").click();
    await expect(note.getByTestId("restock-detail-note")).toHaveText(N2);

    // THEN — the note went ALONE: the page sent one note set and no update.
    expect(writes).toEqual(["RestockRequestNoteSet"]);

    // THEN — the colleague's line edit is kept (3 units, Rp 30.000); the note is Sari's; still on its way.
    const after = await detail(page, g, id);
    expect(after.status).toBe("RESTOCK_REQUEST_STATUS_ONGOING");
    expect(after.items).toHaveLength(1);
    expect(after.items[0].count).toBe("3");
    expect(Number(after.items[0].total)).toBe(30_000);
    expect(after.note).toBe(N2);
    expect(after.noteByUserId).toBe(g.sari);

    // THEN — the trail: the colleague's edit row, then Sari's, which says the note before → after and nothing else.
    expect(noteChanges(after)).toEqual([`${N1} → ${N2}`]);
    const rows = editRows(after);
    expect(rows).toHaveLength(2);
    await page.reload();
    await expect(page.getByTestId(`${rows[1]}-change-note`)).toHaveText(`Note “${N1}” → “${N2}”`);
    await expect(page.getByTestId(`${rows[1]}-changes`).locator(`[data-testid^='${rows[1]}-change-']`)).toHaveCount(1);

    // WHEN — again from the list's ⋯ › Catatan: the colleague changes the line to 4 while the dialog's note is open.
    await page.goto("/inventories/restock");
    await page.getByTestId(`restock-actions-${id}`).click();
    await page.getByTestId(`restock-action-notes-${id}`).click();
    const dialog = page.getByTestId("restock-notes-dialog");
    await expect(dialog).toBeVisible();
    const inDialog = dialog.getByTestId("restock-detail-note-selling");
    await expect(inDialog.getByTestId("restock-detail-note")).toHaveText(N2);
    await inDialog.getByTestId("restock-notes-edit").click();
    await inDialog.getByTestId("restock-notes-input").fill(N3);
    await lineEdit(4, N2);
    await inDialog.getByTestId("restock-notes-save").click();
    await expect(inDialog.getByTestId("restock-detail-note")).toHaveText(N3);

    // THEN — alone again, and the line edit kept: 4 units, the note Sari's third.
    expect(writes).toEqual(["RestockRequestNoteSet", "RestockRequestNoteSet"]);
    const again = await detail(page, g, id);
    expect(again.status).toBe("RESTOCK_REQUEST_STATUS_ONGOING");
    expect(again.items[0].count).toBe("4");
    expect(Number(again.items[0].total)).toBe(40_000);
    expect(again.note).toBe(N3);
    expect(noteChanges(again)).toEqual([`${N1} → ${N2}`, `${N2} → ${N3}`]);

    await g.root.close();
  });
});
