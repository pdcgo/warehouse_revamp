import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";
import { expect, spyOn, userEvent, waitFor } from "storybook/test";

import { routedPage } from "../../../../.storybook/pageStory";
import { productClient } from "../../../api/clients";
import { ProductEditPage } from "../index";
import { AtEditMinyak, loadedMinyak, PRODUCT_FORM_META, retype, routes } from "./kit";

// PRODUCT FORM — the states worth looking at, beyond Default and Mobile: an edit, every field filled from the record.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/States",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Editing 700 — the gallery and every field filled from the record. */
export const Editing: Story = {
  name: "Editing",
  render: () => <AtEditMinyak />,
};

// ── The read, once (#122) ───────────────────────────────────────────────────────────────────────
//
// The stored product is a query now (pages/product-edit/queries.ts), always fresh: it can answer again under the open
// form. The form takes its answer ONCE per product (useSeedOnce), and the read sits still while the form's own save runs.

// A story-only control standing in for "something made the product stale" — a product write elsewhere invalidates
// `products`, and the product answers again under the open form.
function StoryReread() {
  const client = useQueryClient();

  return (
    <Button size="xs" mt="4" data-testid="story-reread" onClick={() => void client.invalidateQueries({ queryKey: ["products"] })}>
      Read the product again
    </Button>
  );
}

const AtEditMinyakWithReread = routedPage(
  [
    {
      path: "/products/:productId/edit",
      element: (
        <>
          <ProductEditPage />
          <StoryReread />
        </>
      ),
    },
    ...routes.filter((route) => route.path !== "/products/:productId/edit"),
  ],
  "/products/700/edit",
);

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

function spyProductDetail() {
  const spy = spyOn(productClient, "productDetail");

  return () => spy.mockRestore();
}

/** A RE-READ NEVER OVERWRITES WHAT IS BEING TYPED: the product answers again, and the name and markup stay as typed. */
export const ARereadKeepsWhatWasTyped: Story = {
  name: "A re-read of the product keeps what was typed",
  beforeEach: spyProductDetail,
  render: () => <AtEditMinyakWithReread />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Baru");
    await retype(canvas.getByTestId("product-edit-description"), "Diketik ulang");

    await userEvent.click(canvas.getByTestId("story-reread"));
    await waitFor(() => expect(callsOf(productClient.productDetail)).toBe(2));
    // The answer is in: give it a render to land on the form.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Baru");
    await expect(canvas.getByTestId("product-edit-description")).toHaveValue("Diketik ulang");
  },
};

/**
 * A SAVE RE-READS NOTHING HERE. Its invalidation re-reads every product screen — but the form's own read sits still
 * while it runs: the form leaves for the screen it came from, which reads afresh.
 */
export const ASaveReReadsNothingHere: Story = {
  name: "A save re-reads nothing on the form before it leaves",
  beforeEach: spyProductDetail,
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Baru");
    await userEvent.click(canvas.getByTestId("product-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(productClient.productDetail)).toBe(1);
  },
};
