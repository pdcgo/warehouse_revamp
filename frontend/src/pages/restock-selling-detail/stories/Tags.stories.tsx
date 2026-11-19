import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, restockTagScenario } from "../../../../.storybook/restockTagKit";
import { asAdminTeam, asPlatformOnly } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At501, At503, At504, SELLING_DETAIL_META, loaded } from "./kit";

// RESTOCK SELLING DETAIL — THE TAGS BOX (backlog #87, live since the-restock-tags-prototype-is-accepted). The restock's tags,
// an add box over the APP-WIDE list (a new name offers *Create tag "…"*; a name that exists, in any case, puts THAT tag
// on — never a twin), a × on each custom tag; the system's locked for a team's user. Root / the Administrator also make a
// system tag, put one on or take it off, and — the owner, 2026-11-18 — RENAME and DELETE any tag from *Manage tags*; a
// team's user has no rename or delete anywhere. A tag goes on and comes off in EVERY status — a received or a lost
// restock too (the owner's 🔄). Every write is the real RPC, answered by the stub (restockTagScenario.ts).
//
// 501 (ongoing) carries an admin's Audit Gudang + Prioritas + Lebaran 2026; 503 (accepted, 2 broken, 1 missing) carries
// the app's Barang kurang + Barang rusak (a-restock-problem-is-a-system-tag) and the warehouse's Retur ke Supplier. The
// app's own tags stay locked for an admin too, and nothing draws them coming off — that waits on the problem's solution.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Tags",
  ...SELLING_DETAIL_META,
  parameters: { ...SELLING_DETAIL_META.parameters, viewport: { options: TAG_VIEWPORTS } },
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

async function box(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  return { canvas, section: within(await canvas.findByTestId("restock-detail-tags-section", {}, { timeout: 4000 })) };
}

/** Type into the add box; the options are portalled, so they are read off `screen`. */
async function typeTag(canvas: Canvas, text: string) {
  const input = canvas.getByTestId("restock-tag-add-input");
  await userEvent.click(input);
  await userEvent.type(input, text, { delay: 40 });
  const list = await screen.findByTestId("restock-tag-add-options", {}, { timeout: 3000 });
  await waitFor(() => expect(list).toBeVisible());
  return input;
}

const options = () =>
  [...document.querySelectorAll("[data-testid^='restock-tag-add-']")]
    .map((el) => el.getAttribute("data-testid")!)
    .filter((id) => id !== "restock-tag-add-options" && id !== "restock-tag-add-input");

const chipIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid='restock-tags'] [data-tag-type]")].map((el) => el.getAttribute("data-testid"));

/**
 * THE BOX — a Tags section in the nav and under the money on the right; 503's problem tags first, LOCKED (a lock, no ×)
 * for a team's user, the warehouse's custom one with its ×; the line under it says both sides see them and who may
 * change a system tag. No *Manage tags*: rename and delete are the admins'.
 */
export const TheTagsBox: Story = {
  name: "The box — system tags locked for a team's user",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(canvas.getByTestId("section-nav-tags")).toHaveTextContent("Tags");

    await expect(chipIds(canvasElement)).toEqual([`restock-tag-${TAG.missing}`, `restock-tag-${TAG.broken}`, `restock-tag-${TAG.retur}`]);
    for (const id of [TAG.missing, TAG.broken]) {
      await expect(section.getByTestId(`restock-tag-${id}-lock`)).toBeInTheDocument();
      await expect(section.queryByTestId(`restock-tag-${id}-remove`)).toBeNull();
    }
    await expect(section.getByTestId(`restock-tag-${TAG.retur}-remove`)).toBeVisible();
    await expect(section.getByTestId("restock-tags-hint")).toHaveTextContent("The selling team and the warehouse see the same tags.");
    await expect(section.getByTestId("restock-tags-hint")).toHaveTextContent("you cannot change it");
    await expect(section.queryByTestId("restock-tag-manage")).toBeNull();
  },
};

/** AN ADMIN'S SYSTEM TAG, TYPED TOWARD BY A TEAM'S USER — offered greyed, *Admin only*; a pick of it does nothing. */
export const AnAdminsTagIsAdminOnly: Story = {
  name: "Add — an admin's system tag is greyed",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "audit");
    const audit = screen.getByTestId(`restock-tag-add-option-${TAG.audit}`);
    await expect(audit).toHaveAttribute("data-disabled");
    await expect(audit).toHaveTextContent("Admin only");

    // A disabled option takes no pointer — the click is forced past the check, and still nothing is put on.
    await userEvent.click(audit, { pointerEventsCheck: 0 });
    await expect(section.queryByTestId(`restock-tag-${TAG.audit}`)).toBeNull();
    await expect(restockTagScenario.calls).toEqual([]);
  },
};

/** ADD AN EXISTING TAG — another team's *Barang Promo* is on the one list, so typing "promo" finds it; a pick puts it on. */
export const AddAnExistingTag: Story = {
  name: "Add — a tag another team made",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "promo");

    await expect(screen.getByTestId(`restock-tag-add-option-${TAG.promo}`)).toBeVisible();
    await userEvent.click(screen.getByTestId(`restock-tag-add-option-${TAG.promo}`));

    await expect(await section.findByTestId(`restock-tag-${TAG.promo}`)).toHaveTextContent("Barang Promo");
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockRequestTagAdd", teamId: 12n, requestId: 501n, tagId: TAG.promo },
    ]);
    await expect(canvas.getByTestId("restock-tag-add-input")).toHaveValue("");
  },
};

/**
 * CREATE A CUSTOM TAG — a name nobody has used offers *Create tag "…"* (a team's user is never offered a system one);
 * the pick makes it on the app-wide list and puts it on.
 */
export const CreateACustomTag: Story = {
  name: "Add — create a custom tag",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "Klaim Asuransi");

    const create = screen.getByTestId("restock-tag-add-create-custom");
    await expect(create).toHaveTextContent("Create tag “Klaim Asuransi”");
    await expect(screen.queryByTestId("restock-tag-add-create-system")).toBeNull();
    await userEvent.click(create);

    await waitFor(() => expect(section.getByText("Klaim Asuransi")).toBeVisible());
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockTagCreate", name: "Klaim Asuransi" },
      { rpc: "RestockRequestTagAdd", teamId: 12n, requestId: 501n, tagId: 16n },
    ]);
    await expect(section.getByTestId("restock-tag-16")).toHaveAttribute("data-tag-type", "custom");
  },
};

/**
 * ONE NAME, ONE TAG — "  supplier BARU " is *Supplier Baru* in another case: it is offered first and NO create is, so the
 * pick puts the existing tag on and nothing new is made. A name already on the restock says so, greyed.
 */
export const ASameNamePicksTheExistingTag: Story = {
  name: "Add — a name that exists picks it, never a twin",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    const input = await typeTag(canvas, "  supplier BARU ");

    await expect(options()[0]).toBe(`restock-tag-add-option-${TAG.supplierBaru}`);
    await expect(screen.queryByTestId("restock-tag-add-create-custom")).toBeNull();
    await userEvent.click(screen.getByTestId(`restock-tag-add-option-${TAG.supplierBaru}`));
    await expect(await section.findByTestId(`restock-tag-${TAG.supplierBaru}`)).toHaveTextContent("Supplier Baru");
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockRequestTagAdd", teamId: 12n, requestId: 501n, tagId: TAG.supplierBaru },
    ]);

    // Already on it: said, greyed, and still no create.
    await userEvent.type(input, "PRIORITAS", { delay: 40 });
    const on = await screen.findByTestId(`restock-tag-add-on-${TAG.prioritas}`);
    await expect(on).toHaveTextContent("Already on this restock");
    await expect(on).toHaveAttribute("data-disabled");
    await expect(screen.queryByTestId("restock-tag-add-create-custom")).toBeNull();
  },
};

/**
 * A SYSTEM TAG CANNOT BE PUT ON BY A TEAM'S USER — typed toward, the problem tags show greyed, saying the app puts them
 * on; with nothing typed no system tag is offered at all. A custom tag comes off by its ×.
 */
export const SystemTagsAreNotOffered: Story = {
  name: "Add — a system tag is greyed; remove a custom tag",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-tag-add-input"));
    await screen.findByTestId(`restock-tag-add-option-${TAG.promo}`, {}, { timeout: 3000 });
    await expect(screen.queryByTestId(`restock-tag-add-option-${TAG.missing}`)).toBeNull();
    await userEvent.keyboard("{Escape}");

    await typeTag(canvas, "barang");
    const missing = screen.getByTestId(`restock-tag-add-option-${TAG.missing}`);
    await expect(missing).toHaveAttribute("data-disabled");
    await expect(missing).toHaveTextContent("Put on by the app");
    await expect(screen.getByTestId(`restock-tag-add-option-${TAG.promo}`)).not.toHaveAttribute("data-disabled");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(section.getByTestId(`restock-tag-${TAG.lebaran}-remove`));
    await waitFor(() => expect(section.queryByTestId(`restock-tag-${TAG.lebaran}`)).toBeNull());
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockRequestTagRemove", teamId: 12n, requestId: 501n, tagId: TAG.lebaran },
    ]);
  },
};

/**
 * THE ADMIN'S VIEW — Root, from outside Toko Melati: an admin's system tag (*Audit Gudang*) carries a ×, a new name
 * offers *Create system tag "…"* beside the custom one, the line says what an admin may do, and *Manage tags* is there.
 */
export const TheAdminsView: Story = {
  name: "Admin — make a system tag, take one off",
  render: () => <At501 />,
  beforeEach: () => {
    asPlatformOnly(Role.ROOT, [])();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(section.getByTestId(`restock-tag-${TAG.audit}-remove`)).toBeVisible();
    await expect(section.getByTestId("restock-tags-hint")).toHaveTextContent("As an admin");
    await expect(section.getByTestId("restock-tag-manage")).toHaveTextContent("Manage tags");

    await typeTag(canvas, "Stok Opname");
    await expect(screen.getByTestId("restock-tag-add-create-custom")).toHaveTextContent("Create tag “Stok Opname”");
    await expect(screen.getByTestId("restock-tag-add-create-system")).toHaveTextContent("Create system tag “Stok Opname”");
    await userEvent.click(screen.getByTestId("restock-tag-add-create-system"));

    await expect(await section.findByTestId("restock-tag-16")).toHaveAttribute("data-tag-type", "system");
    await expect(section.getByTestId("restock-tag-16-lock")).toBeInTheDocument();

    await userEvent.click(section.getByTestId(`restock-tag-${TAG.audit}-remove`));
    await waitFor(() => expect(section.queryByTestId(`restock-tag-${TAG.audit}`)).toBeNull());
    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockTagSystemCreate", name: "Stok Opname" },
      { rpc: "RestockRequestSystemTagAdd", teamId: 12n, requestId: 501n, tagId: 16n },
      { rpc: "RestockRequestSystemTagRemove", teamId: 12n, requestId: 501n, tagId: TAG.audit },
    ]);
  },
};

/**
 * THE APP'S PROBLEM TAGS STAY THE APP'S — for an admin too: no × on *Barang kurang* / *Barang rusak* (when they come off
 * waits on the problem's solution, a-restock-problem-is-a-system-tag), and *Manage tags* lists them without rename or
 * delete, saying the app puts them on.
 */
export const TheAppsProblemTagsStayLocked: Story = {
  name: "Admin — the app's problem tags stay locked",
  render: () => <At503 />,
  beforeEach: () => {
    asPlatformOnly(Role.ROOT, [])();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    for (const id of [TAG.missing, TAG.broken]) {
      await expect(section.getByTestId(`restock-tag-${id}-lock`)).toBeInTheDocument();
      await expect(section.queryByTestId(`restock-tag-${id}-remove`)).toBeNull();
    }
    await expect(section.getByTestId(`restock-tag-${TAG.retur}-remove`)).toBeVisible();

    await userEvent.click(section.getByTestId("restock-tag-manage"));
    const dialog = within(await screen.findByTestId("restock-tag-manage-dialog", {}, { timeout: 3000 }));
    for (const id of [TAG.missing, TAG.broken]) {
      await expect(dialog.getByTestId(`restock-tag-manage-app-${id}`)).toHaveTextContent("Put on by the app");
      await expect(dialog.queryByTestId(`restock-tag-manage-rename-${id}`)).toBeNull();
      await expect(dialog.queryByTestId(`restock-tag-manage-delete-${id}`)).toBeNull();
    }
    await expect(dialog.getByTestId(`restock-tag-manage-rename-${TAG.audit}`)).toBeVisible();
    await expect(dialog.getByTestId(`restock-tag-manage-delete-${TAG.audit}`)).toBeVisible();
  },
};

/**
 * THE ADMIN RENAMES A TAG — *Manage tags* lists every team's tags with how many restocks carry each; a rename changes the
 * chip on this restock too; a name another tag has (any case) is refused in place.
 */
export const TheAdminRenamesATag: Story = {
  name: "Admin — rename a tag in the app-wide list",
  render: () => <At501 />,
  beforeEach: () => {
    asPlatformOnly(Role.ROOT, [])();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await userEvent.click(section.getByTestId("restock-tag-manage"));
    const dialog = within(await screen.findByTestId("restock-tag-manage-dialog", {}, { timeout: 3000 }));

    await expect(dialog.getByTestId(`restock-tag-manage-usage-${TAG.prioritas}`)).toHaveTextContent("2 restocks");
    await expect(dialog.getByTestId(`restock-tag-manage-usage-${TAG.supplierBaru}`)).toHaveTextContent("0 restocks");

    await userEvent.click(dialog.getByTestId(`restock-tag-manage-rename-${TAG.prioritas}`));
    const input = dialog.getByTestId("restock-tag-manage-name-input");
    await userEvent.clear(input);
    await userEvent.type(input, "lebaran 2026", { delay: 30 });
    await userEvent.click(dialog.getByTestId("restock-tag-manage-save"));
    await expect(dialog.getByTestId("restock-tag-manage-taken")).toHaveTextContent("Another tag already has this name.");

    await userEvent.clear(input);
    await userEvent.type(input, "Mendesak", { delay: 30 });
    await userEvent.click(dialog.getByTestId("restock-tag-manage-save"));
    await waitFor(() => expect(dialog.queryByTestId("restock-tag-manage-name-input")).toBeNull());
    await expect(section.getByTestId(`restock-tag-${TAG.prioritas}`)).toHaveTextContent("Mendesak");
    await expect(restockTagScenario.calls).toEqual([{ rpc: "RestockTagRename", tagId: TAG.prioritas, name: "Mendesak" }]);
  },
};

/**
 * THE ADMIN DELETES A TAG — the confirm says it comes off every restock that carries it, every team's; confirmed, it
 * leaves the list and this restock's chips.
 */
export const TheAdminDeletesATag: Story = {
  name: "Admin — delete a tag (it comes off every restock)",
  render: () => <At501 />,
  beforeEach: () => {
    asPlatformOnly(Role.ROOT, [])();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await userEvent.click(section.getByTestId("restock-tag-manage"));
    const dialog = within(await screen.findByTestId("restock-tag-manage-dialog", {}, { timeout: 3000 }));

    await userEvent.click(dialog.getByTestId(`restock-tag-manage-delete-${TAG.prioritas}`));
    const confirm = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    await expect(confirm).toHaveTextContent("Delete tag “Prioritas”?");
    await expect(confirm).toHaveTextContent("It comes off the 2 restocks that carry it, for every team.");
    await userEvent.click(within(confirm).getByTestId("confirm-action"));

    await waitFor(() => expect(dialog.queryByTestId(`restock-tag-manage-row-${TAG.prioritas}`)).toBeNull());
    await expect(section.queryByTestId(`restock-tag-${TAG.prioritas}`)).toBeNull();
    await expect(restockTagScenario.calls).toEqual([{ rpc: "RestockTagDelete", tagId: TAG.prioritas }]);
  },
};

/** THE ADMIN TEAM MONITORING — it reads the tags and changes none: no add box, no ×, no Manage tags. */
export const AMonitorOnlyReads: Story = {
  name: "Monitor — reads, changes nothing",
  render: () => <At501 />,
  beforeEach: () => {
    asAdminTeam()();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await expect(section.getByTestId(`restock-tag-${TAG.prioritas}`)).toBeVisible();
    await expect(section.queryByTestId(`restock-tag-${TAG.prioritas}-remove`)).toBeNull();
    await expect(section.queryByTestId("restock-tag-add")).toBeNull();
    await expect(section.queryByTestId("restock-tag-manage")).toBeNull();
  },
};

/** ON A PHONE — the box sits in the page's one column before the note, its add box the full width; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the box before the note",
  render: () => <At503 />,
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await expect(section.getByTestId(`restock-tag-${TAG.missing}-lock`)).toBeInTheDocument();

    const order = [...canvasElement.querySelectorAll("[id^='restock-section-']")].map((el) => el.id);
    await expect(order.indexOf("restock-section-tags")).toBe(order.indexOf("restock-section-note") - 1);
    await expect(canvas.getByTestId("restock-tag-add")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * IN EVERY STATUS (the owner's 🔄 under the-restock-tags-prototype-is-accepted, as the-note-is-edited-in-any-status) — a
 * RECEIVED restock is tagged (503, Diterima: *Retur ke Supplier* comes off, *Prioritas* goes on), and so is a LOST one
 * (504). The server takes both; Go pins it (TestRestockRequestTagAdd_InEveryStatus).
 */
export const TaggedInEveryStatus: Story = {
  name: "Every status — tag a received and a lost restock",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await userEvent.click(section.getByTestId(`restock-tag-${TAG.retur}-remove`));
    await waitFor(() => expect(section.queryByTestId(`restock-tag-${TAG.retur}`)).toBeNull());
    await typeTag(canvas, "priori");
    await userEvent.click(screen.getByTestId(`restock-tag-add-option-${TAG.prioritas}`));
    await expect(await section.findByTestId(`restock-tag-${TAG.prioritas}`)).toHaveTextContent("Prioritas");

    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockRequestTagRemove", teamId: 12n, requestId: 503n, tagId: TAG.retur },
      { rpc: "RestockRequestTagAdd", teamId: 12n, requestId: 503n, tagId: TAG.prioritas },
    ]);
  },
};

export const TaggedWhenLost: Story = {
  name: "Every status — tag a lost restock",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "Klaim Kurir");
    await userEvent.click(screen.getByTestId("restock-tag-add-create-custom"));
    await waitFor(() => expect(section.getByText("Klaim Kurir")).toBeVisible());

    await expect(restockTagScenario.calls).toEqual([
      { rpc: "RestockTagCreate", name: "Klaim Kurir" },
      { rpc: "RestockRequestTagAdd", teamId: 12n, requestId: 504n, tagId: 16n },
    ]);
  },
};
