import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { ReceiptPhoto } from "./ReceiptPhoto";

// A RESTOCK'S LABEL PHOTO — the selling team's upload, opened two ways (the-restocks-warehouse-opens-its-label-photo):
// the seller as the file's owner (GetDownloadUrl), the warehouse it is going to through RestockReceiptPhoto, which
// checks the restock is its own. The stub (restockStub.ts) plays the server's rules: every fixture restock goes to
// Gudang Pusat (11); 503 carries a photo.

const meta = {
  title: "Features/Restock/ReceiptPhoto",
  component: ReceiptPhoto,
  parameters: { signedIn: true },
  args: { documentId: "doc-restock-503-label", teamId: 11n, requestId: 503n, opensAs: "warehouse" },
} satisfies Meta<typeof ReceiptPhoto>;

export default meta;
type Story = StoryObj<typeof meta>;

// The warehouse the restock is going to opens the seller's photo — a link minted on click by RestockReceiptPhoto, never
// an href on the page.
export const TheWarehouseOpensTheLabelPhoto: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    const button = canvas.getByTestId("restock-detail-receipt-photo-open");
    await expect(button).toHaveTextContent("Open Label Photo");
    await expect(button).not.toHaveAttribute("href");
    await userEvent.click(button);

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://example.invalid/restock-photo/doc-restock-503-label",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    open.mockRestore();
  },
};

// Another warehouse asking about 503 is refused — NotFound, said in a toast, and nothing opens.
export const AnotherWarehouseIsRefused: Story = {
  args: { teamId: 14n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(canvas.getByTestId("restock-detail-receipt-photo-open"));

    await expect(await screen.findByText(/restock request not found/i)).toBeInTheDocument();
    await expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  },
};

// The selling team opens its own upload as the owner — GetDownloadUrl, unchanged.
export const TheSellerOpensItsOwnUpload: Story = {
  args: { teamId: 12n, opensAs: "owner" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(canvas.getByTestId("restock-detail-receipt-photo-open"));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://example.invalid/proof/doc-restock-503-label", "_blank", "noopener,noreferrer"),
    );
    open.mockRestore();
  },
};

// Nothing attached reads as a stated absence, not a dead button — on either side.
export const NoPhoto: Story = {
  args: { documentId: "", requestId: 501n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-detail-receipt-photo")).toHaveTextContent("No photo of the label");
    await expect(canvas.queryByTestId("restock-detail-receipt-photo-open")).toBeNull();
  },
};
