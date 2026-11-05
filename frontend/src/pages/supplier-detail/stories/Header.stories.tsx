import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { channelFixture, supplierFixture } from "../../../../.storybook/supplierFixtures";
import { SUPPLIER_DETAIL_META, AtCahaya, AtSinar, SUMBER, loaded, routedAt } from "./kit";

// SUPPLIER DETAIL — who the supplier is, under its name (the-supplier-is-described-under-its-name), its own Edit and
// Delete, the way back — and a supplier this team may only read, or that is gone. The page's stories are grouped by
// the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Header",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted

const MAKMUR_JAYA_STORE = channelFixture(341n);

const AtAnotherTeams = routedAt(MAKMUR_JAYA.id);
const AtDeleted = routedAt(LAMA_TUTUP.id);

// the-supplier-has-no-code · no-province-or-city: a contact, an address, a description.
export const TheDecidedFields: Story = {
  name: "Decided fields",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-detail-name")).toHaveTextContent(SUMBER.name);
    await expect(canvas.getByTestId("supplier-detail-contact")).toHaveTextContent(SUMBER.contact);
    await expect(canvas.getByTestId("supplier-detail-address")).toHaveTextContent(SUMBER.address);
    await expect(canvas.getByTestId("supplier-detail-description")).toHaveTextContent(SUMBER.description);
  },
};

// WHO THE SUPPLIER IS, UNDER ITS NAME — a line of icons and words and its note, not a card of uppercase labels; the
// contact copies with one click.
export const TheSupplierIsDescribedUnderItsName: Story = {
  name: "Described under its name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const name = canvas.getByTestId("supplier-detail-name").getBoundingClientRect();
    const meta = canvas.getByTestId("supplier-detail-meta");
    await expect(meta.getBoundingClientRect().top).toBeGreaterThanOrEqual(name.bottom);
    await expect(meta.getBoundingClientRect().bottom).toBeLessThan(canvas.getByRole("tablist").getBoundingClientRect().top);
    await expect(within(meta).queryByText("CONTACT")).toBeNull();
    await expect(within(meta).getByRole("button", { name: /copy/i })).toBeInTheDocument();
  },
};

// …and a field left empty is left out: Toko Grosir Sinar has nothing but a name.
export const AnEmptyFieldIsLeftOut: Story = {
  name: "Empty field left out",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("supplier-detail-meta")).toBeNull();
  },
};

// UBAH FROM THE PAGE — the list row's pair, now beside the name too. What is saved is what the line then says.
export const EditFromThePage: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-detail-edit"));
    const contact = await screen.findByTestId("supplier-contact");
    await waitFor(() => expect(contact).toHaveValue(SUMBER.contact));
    await userEvent.clear(contact);
    await userEvent.type(contact, "0811-0000-1234", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(canvas.getByTestId("supplier-detail-contact")).toHaveTextContent("0811-0000-1234"));
  },
};

// HAPUS FROM THE PAGE confirms, keeps the supplier for its figures, and goes back to the list — the page it was on
// no longer opens.
export const DeleteFromThePageGoesBackToTheList: Story = {
  name: "Delete, then the list",
  render: () => <AtCahaya />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-detail-delete"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await canvas.findByTestId("at-suppliers", {}, { timeout: 4000 });
  },
};

export const BackGoesToTheList: Story = {
  name: "Back to the list",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-detail-back"));
    await canvas.findByTestId("at-suppliers");
  },
};

// READS CROSS TEAMS, WRITES DO NOT. Another selling team's supplier, opened here by its URL, reads in full —
// SupplierDetail answers for any team — but this team may not change it, so the page offers no Add Channel and no
// Edit or Delete on a store: the server would answer NotFound to every one.
export const AnotherTeamsSupplierIsReadOnly: Story = {
  name: "Another team's, read-only",
  render: () => <AtAnotherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-detail-name")).toHaveTextContent(MAKMUR_JAYA.name);
    await canvas.findByTestId(`channel-row-${MAKMUR_JAYA_STORE.id}`);

    await expect(canvas.queryByTestId("add-channel")).toBeNull();
    await expect(canvas.queryAllByTestId(/^edit-channel-|^delete-channel-/)).toHaveLength(0);
    // …nor Ubah or Hapus on the supplier itself.
    await expect(canvas.queryByTestId("supplier-detail-edit")).toBeNull();
    await expect(canvas.queryByTestId("supplier-detail-delete")).toBeNull();
    await expect(within(canvas.getByTestId("channels-table")).queryByText("Actions")).toBeNull();
  },
};

// a-deleted-supplier-is-kept-for-its-figures: a deleted supplier leaves every detail — kept for past restocks
// and the figures, read by id, never opened as a record.
export const ADeletedSupplierIsNotFound: Story = {
  name: "Deleted, not found",
  render: () => <AtDeleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("supplier-detail-error", {}, { timeout: 4000 });
  },
};
