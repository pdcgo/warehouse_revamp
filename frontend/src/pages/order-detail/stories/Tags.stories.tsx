import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { DESKTOP, NEXT_TAG_ID, PHONE, TAG, TAG_VIEWPORTS, orderTagScenario } from "../../../../.storybook/orderTagScenario";
import { asAdminTeam, asPlatformOnly } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { AtCancelled, CANCELLED, ORDER_DETAIL_META, Routed, SELLER, WAREHOUSE } from "./kit";

// ONE ORDER — ITS TAGS (backlog #100, live since the-order-tags-prototype-is-accepted). Orders have a tag list of their own
// (orders-have-their-own-tag-list) with the restock tags' rules, on the restock tags' accepted Tag box
// (the-restock-tags-prototype-is-accepted): the order's tags, an add box over the ORDERS' one list (a new name offers
// *Create tag "…"*; a name that exists there, in any case, puts THAT tag on — never a twin; a restock tag's name is
// another list's and free here), a × on each custom tag; an admin's system tag locked for a team's user. Root / the
// Administrator also make a system tag, put one on or take it off, and RENAME and DELETE any order tag from *Manage
// tags*. A monitor reads. The seller's detail draws it as a section (its own nav item, first in the side column above
// Catatan; on one column after Info, before Catatan); the warehouse's detail as a card on its Info tab before the notes.
// The stub's OrderService plays the tags (.storybook/orderTagScenario.ts); `orderTagScenario.calls` is what was sent.
//
// 101 (pending, Toko Melati's, shipped by Gudang Pusat) carries Kemasan Ulang (the warehouse's) + Kirim Pagi + VIP; 103
// carries an admin's *Audit Admin*. There are no app-owned order tags, so nothing is locked for an admin.

const At101 = Routed("/orders/101");
const At103 = Routed("/orders/103");

const meta = {
  title: "Pages/Order/OrderDetailPage/Tags",
  ...ORDER_DETAIL_META,
  parameters: { ...ORDER_DETAIL_META.parameters, viewport: { options: TAG_VIEWPORTS } },
  globals: DESKTOP,
  render: () => <At101 />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

/** The seller's Tag section, once the order has landed. */
async function box(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const section = await canvas.findByTestId("section-tags", {}, { timeout: 4000 });
  return { canvas, section: within(section) };
}

/** Type into the add box; the options are portalled, so they are read off `screen`. */
async function typeTag(canvas: Canvas, text: string) {
  const input = canvas.getByTestId("order-tag-add-input");
  await userEvent.click(input);
  await userEvent.type(input, text, { delay: 40 });
  const list = await screen.findByTestId("order-tag-add-options", {}, { timeout: 3000 });
  await waitFor(() => expect(list).toBeVisible());
  return input;
}

const options = () =>
  [...document.querySelectorAll("[data-testid^='order-tag-add-']")]
    .map((el) => el.getAttribute("data-testid")!)
    .filter((id) => id !== "order-tag-add-options" && id !== "order-tag-add-input");

const chipIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid='order-tags'] [data-tag-type]")].map((el) => el.getAttribute("data-testid"));

const asRoot = () => {
  asPlatformOnly(Role.ROOT, [])();
  asTeam(SELLER.id)();
};

/**
 * THE BOX — a Tags section with its own nav item, first in the side column above Catatan; 101's three custom tags by name,
 * each with its × (the warehouse's *Kemasan Ulang* too — an order's tags are one set); the line says the selling team and
 * the shipping warehouse see the same tags. No *Manage tags*: rename and delete are the admins'.
 */
export const TheTagsBox: Story = {
  name: "The box — the order's tags, the side column above Catatan",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(canvas.getByTestId("section-nav-tags")).toHaveTextContent("Tags");

    await expect(chipIds(canvasElement)).toEqual([`order-tag-${TAG.kemasanUlang}`, `order-tag-${TAG.kirimPagi}`, `order-tag-${TAG.vip}`]);
    for (const id of [TAG.kemasanUlang, TAG.kirimPagi, TAG.vip]) {
      await expect(section.getByTestId(`order-tag-${id}-remove`)).toBeVisible();
    }
    await expect(section.getByTestId("order-tags-hint")).toHaveTextContent("The selling team and the warehouse shipping it see the same tags.");
    await expect(section.queryByTestId("order-tag-manage")).toBeNull();

    // Beside the main column at 1440: in the side column, right above Catatan.
    const tags = canvas.getByTestId("section-tags");
    const notes = canvas.getByTestId("section-notes");
    await expect(tags.parentElement).toBe(notes.parentElement);
    await expect(tags.nextElementSibling).toBe(notes);
  },
};

/**
 * AN ADMIN'S SYSTEM TAG, FOR A TEAM'S USER — 103's *Audit Admin* is locked (a lock, no ×), the line says who may change it.
 */
export const ASystemTagIsLockedForATeamsUser: Story = {
  name: "A system tag — locked for a team's user",
  render: () => <At103 />,
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await expect(section.getByTestId(`order-tag-${TAG.audit}-lock`)).toBeInTheDocument();
    await expect(section.queryByTestId(`order-tag-${TAG.audit}-remove`)).toBeNull();
    await expect(section.getByTestId("order-tags-hint")).toHaveTextContent("you cannot change it");
  },
};

/**
 * …AND NOT OFFERED TO PUT ON — with nothing typed no system tag is in the add list; typed toward, *Audit Admin* is offered
 * greyed (*Admin only*) and a pick of it does nothing.
 */
export const ASystemTagIsGreyedInTheAddList: Story = {
  name: "Add — an admin's system tag is greyed",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await userEvent.click(canvas.getByTestId("order-tag-add-input"));
    await screen.findByTestId(`order-tag-add-option-${TAG.bonusStiker}`, {}, { timeout: 3000 });
    await expect(screen.queryByTestId(`order-tag-add-option-${TAG.audit}`)).toBeNull();
    await userEvent.keyboard("{Escape}");

    await typeTag(canvas, "audit");
    const audit = screen.getByTestId(`order-tag-add-option-${TAG.audit}`);
    await expect(audit).toHaveAttribute("data-disabled");
    await expect(audit).toHaveTextContent("Admin only");
    await userEvent.click(audit, { pointerEventsCheck: 0 });
    await expect(section.queryByTestId(`order-tag-${TAG.audit}`)).toBeNull();
    await expect(orderTagScenario.calls).toEqual([]);
  },
};

/** ADD A TAG ANOTHER TEAM MADE — Toko Kenanga's *Bonus Stiker* is on the orders' one list: "bonus" finds it, a pick puts it on. */
export const AddATagAnotherTeamMade: Story = {
  name: "Add — a tag another team made",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "bonus");
    await userEvent.click(screen.getByTestId(`order-tag-add-option-${TAG.bonusStiker}`));

    await expect(await section.findByTestId(`order-tag-${TAG.bonusStiker}`)).toHaveTextContent("Bonus Stiker");
    await expect(orderTagScenario.calls).toEqual([{ rpc: "OrderTagAdd", orderId: 101n, tagId: TAG.bonusStiker }]);
    await expect(canvas.getByTestId("order-tag-add-input")).toHaveValue("");
  },
};

/**
 * CREATE A CUSTOM TAG — *Prioritas* is a RESTOCK tag, another domain's list (orders-have-their-own-tag-list), so the
 * orders' list has no such name: *Create tag "Prioritas"* is offered (a team's user never gets the system one); the pick
 * makes it on the orders' list and puts it on.
 */
export const CreateACustomTag: Story = {
  name: "Add — create a custom tag (a restock tag's name is free here)",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await typeTag(canvas, "Prioritas");

    const create = screen.getByTestId("order-tag-add-create-custom");
    await expect(create).toHaveTextContent("Create tag “Prioritas”");
    await expect(screen.queryByTestId("order-tag-add-create-system")).toBeNull();
    await userEvent.click(create);

    await waitFor(() => expect(section.getByTestId(`order-tag-${NEXT_TAG_ID}`)).toHaveTextContent("Prioritas"));
    await expect(section.getByTestId(`order-tag-${NEXT_TAG_ID}`)).toHaveAttribute("data-tag-type", "custom");
    await expect(orderTagScenario.calls).toEqual([
      { rpc: "OrderTagCreate", name: "Prioritas" },
      { rpc: "OrderTagAdd", orderId: 101n, tagId: NEXT_TAG_ID },
    ]);
  },
};

/**
 * ONE NAME, ONE TAG — "  pre-ORDER " is *Pre-order* in another case: it is offered first and NO create is, so the pick
 * puts the existing tag on. A name already on the order says so, greyed, and still no create. A custom tag comes off by ×.
 */
export const ASameNamePicksTheExistingTag: Story = {
  name: "Add — a name that exists picks it, never a twin; remove by ×",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    const input = await typeTag(canvas, "  pre-ORDER ");

    await expect(options()[0]).toBe(`order-tag-add-option-${TAG.preOrder}`);
    await expect(screen.queryByTestId("order-tag-add-create-custom")).toBeNull();
    await userEvent.click(screen.getByTestId(`order-tag-add-option-${TAG.preOrder}`));
    await expect(await section.findByTestId(`order-tag-${TAG.preOrder}`)).toHaveTextContent("Pre-order");

    await userEvent.type(input, "VIP", { delay: 40 });
    const on = await screen.findByTestId(`order-tag-add-on-${TAG.vip}`);
    await expect(on).toHaveTextContent("Already on this order");
    await expect(on).toHaveAttribute("data-disabled");
    await expect(screen.queryByTestId("order-tag-add-create-custom")).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(section.getByTestId(`order-tag-${TAG.kirimPagi}-remove`));
    await waitFor(() => expect(section.queryByTestId(`order-tag-${TAG.kirimPagi}`)).toBeNull());
    await expect(orderTagScenario.calls).toEqual([
      { rpc: "OrderTagAdd", orderId: 101n, tagId: TAG.preOrder },
      { rpc: "OrderTagRemove", orderId: 101n, tagId: TAG.kirimPagi },
    ]);
  },
};

/**
 * IN EVERY STATUS — a cancelled order (107) is tagged like any other: the restock tags' rule *a tag goes on and comes off
 * in every status* (the 🔄 under the-restock-tags-prototype-is-accepted), applied to orders by orders-have-their-own-tag-list.
 */
export const TagACancelledOrder: Story = {
  name: "Every status — tag a cancelled order",
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(section.getByText("No tags on this order yet.")).toBeVisible();
    await typeTag(canvas, "vip");
    await userEvent.click(screen.getByTestId(`order-tag-add-option-${TAG.vip}`));
    await expect(await section.findByTestId(`order-tag-${TAG.vip}`)).toHaveTextContent("VIP");
    await expect(orderTagScenario.calls).toEqual([{ rpc: "OrderTagAdd", orderId: CANCELLED.id, tagId: TAG.vip }]);
  },
};

/**
 * THE ADMIN'S VIEW — Root, from outside Toko Melati, on 103: the system tag carries a ×, the line says what an admin may
 * do, and *Manage tags* is there.
 */
export const TheAdminSeesManageTags: Story = {
  name: "Admin — a system tag's ×, and Manage tags",
  render: () => <At103 />,
  beforeEach: asRoot,
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await expect(section.getByTestId(`order-tag-${TAG.audit}-remove`)).toBeVisible();
    await expect(section.getByTestId("order-tags-hint")).toHaveTextContent("As an admin");
    await expect(section.getByTestId("order-tag-manage")).toHaveTextContent("Manage tags");
  },
};

/**
 * THE ADMIN MAKES A SYSTEM TAG — a new name offers *Create system tag "…"* beside the custom one; the pick makes it and
 * puts it on, locked for team users; the admin's × takes a system tag off.
 */
export const TheAdminsView: Story = {
  name: "Admin — make a system tag, take one off",
  render: () => <At103 />,
  beforeEach: asRoot,
  play: async ({ canvasElement }) => {
    const { canvas, section } = await box(canvasElement);
    await expect(section.getByTestId(`order-tag-${TAG.audit}-remove`)).toBeVisible();

    await typeTag(canvas, "Komplain Pembeli");
    await expect(screen.getByTestId("order-tag-add-create-custom")).toHaveTextContent("Create tag “Komplain Pembeli”");
    await expect(screen.getByTestId("order-tag-add-create-system")).toHaveTextContent("Create system tag “Komplain Pembeli”");
    await userEvent.click(screen.getByTestId("order-tag-add-create-system"));

    await expect(await section.findByTestId(`order-tag-${NEXT_TAG_ID}`)).toHaveAttribute("data-tag-type", "system");
    await expect(section.getByTestId(`order-tag-${NEXT_TAG_ID}-lock`)).toBeInTheDocument();

    await userEvent.click(section.getByTestId(`order-tag-${TAG.audit}-remove`));
    await waitFor(() => expect(section.queryByTestId(`order-tag-${TAG.audit}`)).toBeNull());
    await expect(orderTagScenario.calls).toEqual([
      { rpc: "OrderTagSystemCreate", name: "Komplain Pembeli" },
      { rpc: "OrderSystemTagAdd", orderId: 103n, tagId: NEXT_TAG_ID },
      { rpc: "OrderSystemTagRemove", orderId: 103n, tagId: TAG.audit },
    ]);
  },
};

/**
 * THE ADMIN RENAMES A TAG — *Manage tags* lists every team's ORDER tags with how many orders carry each; a name another
 * order tag has (any case) is refused in place; a rename changes the chip on this order too.
 */
export const TheAdminRenamesATag: Story = {
  name: "Admin — Manage tags: rename",
  beforeEach: asRoot,
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await userEvent.click(section.getByTestId("order-tag-manage"));
    const dialog = within(await screen.findByTestId("order-tag-manage-dialog", {}, { timeout: 3000 }));
    await expect(dialog.getByText("Manage order tags")).toBeVisible();

    await expect(dialog.getByTestId(`order-tag-manage-usage-${TAG.vip}`)).toHaveTextContent("2 orders");
    await expect(dialog.getByTestId(`order-tag-manage-usage-${TAG.audit}`)).toHaveTextContent("1 order");
    await expect(dialog.getByTestId(`order-tag-manage-usage-${TAG.preOrder}`)).toHaveTextContent("0 orders");

    await userEvent.click(dialog.getByTestId(`order-tag-manage-rename-${TAG.vip}`));
    const input = dialog.getByTestId("order-tag-manage-name-input");
    await userEvent.clear(input);
    await userEvent.type(input, "kirim PAGI", { delay: 30 });
    await userEvent.click(dialog.getByTestId("order-tag-manage-save"));
    await expect(dialog.getByTestId("order-tag-manage-taken")).toHaveTextContent("Another order tag already has this name.");

    await userEvent.clear(input);
    await userEvent.type(input, "Pelanggan VIP", { delay: 30 });
    await userEvent.click(dialog.getByTestId("order-tag-manage-save"));
    await waitFor(() => expect(dialog.queryByTestId("order-tag-manage-name-input")).toBeNull());
    await expect(section.getByTestId(`order-tag-${TAG.vip}`)).toHaveTextContent("Pelanggan VIP");
    await expect(orderTagScenario.calls).toEqual([{ rpc: "OrderTagRename", tagId: TAG.vip, name: "Pelanggan VIP" }]);
  },
};

/** THE ADMIN DELETES A TAG — the confirm says how many orders it comes off, every team's; confirmed, it leaves the list and this order. */
export const TheAdminDeletesATag: Story = {
  name: "Admin — Manage tags: delete (it comes off every order)",
  beforeEach: asRoot,
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await userEvent.click(section.getByTestId("order-tag-manage"));
    const dialog = within(await screen.findByTestId("order-tag-manage-dialog", {}, { timeout: 3000 }));

    await userEvent.click(dialog.getByTestId(`order-tag-manage-delete-${TAG.kemasanUlang}`));
    const confirm = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    await expect(confirm).toHaveTextContent("Delete tag “Kemasan Ulang”?");
    await expect(confirm).toHaveTextContent("It comes off the 2 orders that carry it, for every team.");
    await userEvent.click(within(confirm).getByTestId("confirm-action"));

    await waitFor(() => expect(dialog.queryByTestId(`order-tag-manage-row-${TAG.kemasanUlang}`)).toBeNull());
    await expect(section.queryByTestId(`order-tag-${TAG.kemasanUlang}`)).toBeNull();
    await expect(orderTagScenario.calls).toEqual([{ rpc: "OrderTagDelete", tagId: TAG.kemasanUlang }]);
  },
};

/** THE ADMIN TEAM MONITORING — it reads the tags and changes none: no add box, no ×, no Manage tags. */
export const AMonitorOnlyReads: Story = {
  name: "Monitor — reads, changes nothing",
  beforeEach: () => {
    asAdminTeam()();
    asTeam(SELLER.id)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await box(canvasElement);
    await expect(section.getByTestId(`order-tag-${TAG.vip}`)).toBeVisible();
    await expect(section.queryByTestId(`order-tag-${TAG.vip}-remove`)).toBeNull();
    await expect(section.queryByTestId("order-tag-add")).toBeNull();
    await expect(section.queryByTestId("order-tag-manage")).toBeNull();
  },
};

/** ON A PHONE — one column: the box after Info and right before Catatan, its add box the full width; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the box before Catatan",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const { canvas } = await box(canvasElement);
    await expect(window.innerWidth).toBe(390);

    const order = [...canvasElement.querySelectorAll("[id^='order-section-']")].map((el) => el.id);
    await expect(order.indexOf("order-section-tags")).toBe(order.indexOf("order-section-info") + 1);
    await expect(order.indexOf("order-section-tags")).toBe(order.indexOf("order-section-notes") - 1);
    await expect(canvas.getByTestId("order-tag-add")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * THE WAREHOUSE'S DETAIL — Gudang Pusat ships 101: a Tags card on its Info tab right before the notes, the same tags the
 * selling team sees, each custom one with its × for the warehouse too — one set for both sides.
 */
export const TheWarehousesDetail: Story = {
  name: "Warehouse detail — a Tags card before the notes",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("order-detail-tags", {}, { timeout: 4000 });
    await expect(card.nextElementSibling).toBe(canvas.getByTestId("order-detail-notes"));
    const tags = within(card);
    await expect(chipIds(canvasElement)).toEqual([`order-tag-${TAG.kemasanUlang}`, `order-tag-${TAG.kirimPagi}`, `order-tag-${TAG.vip}`]);
    await expect(tags.getByTestId(`order-tag-${TAG.vip}-remove`)).toBeVisible();
    await expect(tags.getByTestId("order-tag-add")).toBeVisible();
  },
};

/** THE WAREHOUSE TAGS TOO — it puts *Pre-order* on and takes the seller's *VIP* off. */
export const TheWarehouseTagsToo: Story = {
  name: "Warehouse detail — the warehouse tags too",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tags = within(await canvas.findByTestId("order-detail-tags", {}, { timeout: 4000 }));

    await typeTag(tags, "pre");
    await userEvent.click(screen.getByTestId(`order-tag-add-option-${TAG.preOrder}`));
    await expect(await tags.findByTestId(`order-tag-${TAG.preOrder}`)).toBeVisible();
    await userEvent.click(tags.getByTestId(`order-tag-${TAG.vip}-remove`));
    await waitFor(() => expect(tags.queryByTestId(`order-tag-${TAG.vip}`)).toBeNull());
    await expect(orderTagScenario.calls).toEqual([
      { rpc: "OrderTagAdd", orderId: 101n, tagId: TAG.preOrder },
      { rpc: "OrderTagRemove", orderId: 101n, tagId: TAG.vip },
    ]);
  },
};
