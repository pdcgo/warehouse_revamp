import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { AtEditMinyak, PRODUCT_FORM_META, loaded, loadedMinyak, retype } from "./kit";

// PRODUCT FORM — the fields: an edit arriving filled, every field's example and its limit, and the lock — its three ways
// and its minimum. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/Fields",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit arrives FILLED from the record — the markup as the percent it was typed in, the first picture as the cover. */
export const TheEditFormArrivesFilled: Story = {
  name: "Arrives filled",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Goreng Sawit 2L — Satuan");
    await expect((canvas.getByTestId("product-edit-description") as HTMLTextAreaElement).value).toContain(
      "Minyak goreng kelapa sawit",
    );
    await waitFor(() => expect(canvas.getByTestId("category-select")).toHaveTextContent("Rumah Tangga"));
    await expect(canvas.getByTestId("product-edit-cross-markup")).toHaveValue("12.5");
    // The lock arrives as the way its two fields say — a minimum of 4 (one-lock-three-ways).
    await expect(canvas.getByTestId("product-edit-lock-mode-min")).toHaveAttribute("data-state", "checked");
    await expect(canvas.getByTestId("product-edit-lock-minimum")).toHaveValue("4");

    await expect(canvas.getByTestId("product-image-1")).toBeVisible();
    await expect(canvas.getByTestId("product-image-0").parentElement!).toHaveTextContent("Cover");
    await expect(canvas.getByTestId("product-image-1").parentElement!).not.toHaveTextContent("Cover");
    // The cover is the BIG box; the second picture is a small one (the-gallery-is-a-cover-and-four).
    await expect(canvas.getByTestId("product-image-0").parentElement!).toHaveAttribute("data-slot", "cover");
    await expect(canvas.getByTestId("product-image-1").parentElement!).toHaveAttribute("data-slot", "small");
  },
};

/** Every typed field shows an example (every-form-field-shows-an-example); the two figures keep their 0, the category
 * says what to pick. */
export const EveryFieldShowsAnExample: Story = {
  name: "Examples",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-edit-sku")).toHaveAttribute("placeholder", "e.g. SKU-KOPI-250");
    await expect(canvas.getByTestId("product-edit-name")).toHaveAttribute("placeholder", "e.g. Arabica Coffee 250g");
    await expect(canvas.getByTestId("product-edit-description").getAttribute("placeholder")).toMatch(/^e\.g\. /);
    await expect(canvas.getByTestId("product-edit-cross-markup")).toHaveAttribute("placeholder", "0");
    // A new product is OPEN; the minimum shows — with its 0 — once that way is picked.
    await expect(canvas.getByTestId("product-edit-lock-mode-open")).toHaveAttribute("data-state", "checked");
    await userEvent.click(canvas.getByTestId("product-edit-lock-mode-min"));
    await expect(await canvas.findByTestId("product-edit-lock-minimum")).toHaveAttribute("placeholder", "0");
  },
};

/** EVERY LIMIT IS SHOWN (a-limited-field-shows-its-count) — "5/64" under the SKU, the name and the description, the box
 * stopping at the server's limit; an edit counts what it arrived with. */
export const EveryLimitIsShown: Story = {
  name: "Limits shown",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await expect(canvas.getByTestId("product-edit-sku-count")).toHaveTextContent("11/64");
    await expect(canvas.getByTestId("product-edit-name-count")).toHaveTextContent(
      `${"Minyak Goreng Sawit 2L — Satuan".length}/200`,
    );
    await expect(canvas.getByTestId("product-edit-description-count")).toHaveTextContent(/^\d+\/1000$/);

    await expect(canvas.getByTestId("product-edit-sku")).toHaveAttribute("maxLength", "64");
    await expect(canvas.getByTestId("product-edit-name")).toHaveAttribute("maxLength", "200");
    await expect(canvas.getByTestId("product-edit-description")).toHaveAttribute("maxLength", "1000");

    await retype(canvas.getByTestId("product-edit-sku"), "KOPI");
    await waitFor(() => expect(canvas.getByTestId("product-edit-sku-count")).toHaveTextContent("4/64"));
  },
};

/** The minimum is a QUANTITY, so it is `QuantityInput` — a − and a + either side of the box, never a typed number field
 * that changes on a scroll. */
export const TheMinimumSteps: Story = {
  name: "Minimum steps",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const box = canvas.getByTestId("product-edit-lock-minimum");

    await expect(box).toHaveValue("4");
    await userEvent.click(canvas.getByTestId("product-edit-lock-minimum-plus"));
    await waitFor(() => expect(box).toHaveValue("5"));
    await userEvent.click(canvas.getByTestId("product-edit-lock-minimum-minus"));
    await userEvent.click(canvas.getByTestId("product-edit-lock-minimum-minus"));
    await waitFor(() => expect(box).toHaveValue("3"));
  },
};

/** The lock's three ways each say what they mean for another team, and the minimum is asked for only when it is the
 * way chosen (one-lock-three-ways). */
export const TheLockSaysWhatEachWayMeans: Story = {
  name: "Lock, each way",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const help = canvas.getByTestId("product-edit-lock-help");

    await expect(help).toHaveTextContent("total stock in every warehouse");
    await userEvent.click(canvas.getByTestId("product-edit-lock-mode-always"));
    await waitFor(() => expect(help).toHaveTextContent("No other team can order it"));
    await expect(canvas.queryByTestId("product-edit-lock-minimum")).toBeNull();
    await userEvent.click(canvas.getByTestId("product-edit-lock-mode-open"));
    await waitFor(() => expect(help).toHaveTextContent("Any team may sell it"));
  },
};
