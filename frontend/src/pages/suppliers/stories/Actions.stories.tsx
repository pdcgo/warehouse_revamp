import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { SUPPLIERS_META, SINAR, SUMBER, loaded } from "./kit";

// SUPPLIERS — New Supplier with no code (the-supplier-has-no-code), a row's Edit, and its Delete
// (a-deleted-supplier-is-kept-for-its-figures). The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/Actions",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// the-supplier-has-no-code: the form asks for a name, a contact, an address and a description — and nothing else.
export const NewSupplierAsksNoCode: Story = {
  name: "New, no code",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-supplier"));
    const name = await screen.findByTestId("supplier-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(screen.queryByTestId("supplier-code")).toBeNull();
    await expect(screen.queryByTestId("supplier-city")).toBeNull();
    await expect(screen.queryByTestId("supplier-province")).toBeNull();

    // Name is the one required field.
    await expect(screen.getByTestId("submit-supplier")).toBeDisabled();

    await userEvent.type(name, "PT Baru Jaya", { delay: 40 });
    await userEvent.type(screen.getByTestId("supplier-contact"), "0811-7777-8888", { delay: 20 });
    await userEvent.type(screen.getByTestId("supplier-address"), "Jl. Kopo 9, Bandung", { delay: 20 });
    await expect(screen.getByTestId("submit-supplier")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(canvas.getByTestId("suppliers-table")).toHaveTextContent("PT Baru Jaya"));
  },
};

// Edit re-opens the record pre-filled, and what is saved is what the row then shows.
export const EditCorrectsTheAddress: Story = {
  name: "Edit the address",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`edit-supplier-${SUMBER.id}`));
    const address = await screen.findByTestId("supplier-address");
    await waitFor(() => expect(address).toHaveValue(SUMBER.address));

    await userEvent.clear(address);
    await userEvent.type(address, "Jl. Kopo 9, Bandung", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(screen.queryByTestId("supplier-address")).toBeNull());
    await waitFor(() =>
      expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent("Jl. Kopo 9, Bandung"),
    );
  },
};

// a-deleted-supplier-is-kept-for-its-figures: delete confirms, says past restocks keep the name, and the supplier leaves the list.
export const DeleteKeepsTheHistory: Story = {
  name: "Delete keeps history",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`delete-supplier-${SINAR.id}`));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/past restocks and its figures keep its name/)).toBeVisible();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SINAR.id}`)).toBeNull());
  },
};
