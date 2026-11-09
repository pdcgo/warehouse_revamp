import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { liveProducts } from "../../../../.storybook/productStub";
import { AtEditMinyak, PRODUCT_FORM_META, attach, loaded, loadedMinyak, picture, retype } from "./kit";

// PRODUCT FORM — Save: what it waits for, what it holds back, what it sends and where a create lands, the code the
// server refuses — taken, or fixed on a used product — and who may not create at all. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/Save",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pick Rumah Tangga › Dapur. The form takes a LEAF only, so the parent drills instead of being picked. */
async function pickDapur(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("category-select"));
  const parent = await canvas.findByTestId("category-node-Rumah Tangga");
  await waitFor(() => expect(parent).toBeVisible());
  await userEvent.click(parent);
  const leaf = await canvas.findByTestId("category-node-Dapur");
  await waitFor(() => expect(leaf).toBeVisible());
  await userEvent.click(leaf);
  await waitFor(() => expect(canvas.getByTestId("category-select")).toHaveTextContent("Rumah Tangga › Dapur"));
}

/**
 * Save stays shut until the code, the name AND a category are given — the category is the one people forget. The line by
 * Save names the FIRST thing missing, the rest on asking, and turns into the ready mark once nothing is
 * (a-save-button-says-what-it-waits-for).
 */
export const SaveWaitsForTheRequired: Story = {
  name: "Waits for the required",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const save = canvas.getByTestId("product-edit-save");

    await expect(save).toBeDisabled();
    await expect(canvas.getByTestId("product-edit-missing")).toHaveTextContent("Not filled in: SKU");
    await expect(canvas.getByTestId("product-edit-missing-more")).toHaveTextContent("+2 more");

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "ANG-045", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 5L — Jeriken", { delay: 30 });
    await expect(save).toBeDisabled();
    await expect(canvas.getByTestId("product-edit-missing-category")).toHaveTextContent("category");
    await expect(canvas.queryByTestId("product-edit-missing-more")).toBeNull();

    await pickDapur(canvas);
    await expect(save).toBeEnabled();
    await expect(canvas.getByTestId("product-edit-ready")).toHaveTextContent("Ready to create");
  },
};

/** A markup that is not a usable percent, or a minimum that is not a whole count of at least one, says so and holds the
 * save — never read as 0, which would be a discount, or an open lock, nobody chose. */
export const AnUnusableFigureHoldsTheSave: Story = {
  name: "Unusable figure holds it",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const save = canvas.getByTestId("product-edit-save");
    await expect(save).toBeEnabled();

    await retype(canvas.getByTestId("product-edit-cross-markup"), "-5");
    await waitFor(() => expect(canvasElement).toHaveTextContent("Enter a percent between 0 and 1000."));
    await expect(save).toBeDisabled();
    await retype(canvas.getByTestId("product-edit-cross-markup"), "15");
    await expect(save).toBeEnabled();

    // The minimum is a NumberInput, whose value settles a beat after the keystroke — each read waits for it. A 0 is the
    // case the rule exists for (Open under another name); a decimal was dropped from here because a "." typed at
    // machine speed under a loaded runner could land as "15", a valid minimum, and the story flaked.
    await retype(canvas.getByTestId("product-edit-lock-minimum"), "0");
    await waitFor(() => expect(canvasElement).toHaveTextContent("Enter a minimum stock of at least 1."));
    await waitFor(() => expect(save).toBeDisabled());
    await retype(canvas.getByTestId("product-edit-lock-minimum"), "6");
    await waitFor(() => expect(save).toBeEnabled());
  },
};

/** Creating sends the whole record — the markup typed as a percent arrives as basis points — and lands on the list. */
export const CreatingLandsOnTheList: Story = {
  name: "Create lands on the list",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "ANG-045", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 5L — Jeriken", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.type(canvas.getByTestId("product-edit-cross-markup"), "7.5", { delay: 30 });
    // A minimum of 3, then Always — which keeps the 3 (one-lock-three-ways).
    await userEvent.click(canvas.getByTestId("product-edit-lock-mode-min"));
    await userEvent.type(await canvas.findByTestId("product-edit-lock-minimum"), "3", { delay: 30 });
    await userEvent.click(canvas.getByTestId("product-edit-lock-mode-always"));
    await attach(canvasElement, [await picture("jeriken.png", "#facc15")]);
    await waitFor(() => expect(canvas.getByTestId("product-image-0")).toBeVisible());

    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());

    // Stored under the team's code — the part typed was ANG-045.
    const created = liveProducts().find((p) => p.productCode === "SL-03-ANG-045");
    await expect(created).toMatchObject({
      teamId: 15n,
      name: "Minyak Goreng Sawit 5L — Jeriken",
      categoryId: 55n,
      reservedStock: 3,
      crossMarkupBps: 750,
      crossLocked: true,
    });
    await expect(created!.images).toHaveLength(1);
    await expect(created!.defaultImageUrl).toBe(created!.images[0]!.url);
  },
};

/** A code another product already holds — an archived one too, which keeps its code — is refused by the server, and said
 * UNDER THE CODE, not at the top of the page: the field turns red, Save stays shut while that part stands, and changing
 * it clears both. The form stays as typed. */
export const ATakenCodeIsSaidUnderTheCode: Story = {
  name: "Taken code",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // ANG-001-L is 790's, the ARCHIVED older pack: archiving does not free a code.
    await userEvent.type(canvas.getByTestId("product-edit-sku"), "ANG-001-L", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Karton Baru", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.click(canvas.getByTestId("product-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("product-edit-sku-taken")).toHaveTextContent("already taken"));
    await expect(canvas.queryByTestId("product-edit-error")).toBeNull();
    await expect(canvas.queryByTestId("at-products")).toBeNull();
    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Goreng Sawit 2L — Karton Baru");
    await expect(canvas.getByTestId("product-edit-save")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "B", { delay: 30 });
    await waitFor(() => expect(canvas.queryByTestId("product-edit-sku-taken")).toBeNull());
    await expect(canvas.getByTestId("product-edit-save")).toBeEnabled();
  },
};

/** A USED product's code is fixed — a sticker can exist — so a correction of its part is refused by the server and said
 * at the top of the page; the form stays as typed. Its other fields still save, because an untouched part is not sent
 * (SavingAnEditReturnsToTheProduct). */
export const AUsedProductsCodeIsFixed: Story = {
  name: "Used code is fixed",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    await expect(canvas.getByTestId("product-edit-sku-prefix")).toHaveTextContent("SL-03-");

    await retype(canvas.getByTestId("product-edit-sku"), "ANG-001-B");
    await userEvent.click(canvas.getByTestId("product-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("product-edit-error")).toHaveTextContent("its code is fixed"));
    await expect(canvas.queryByTestId("at-products")).toBeNull();
    await expect(liveProducts().find((p) => p.id === 700n)!.productCode).toBe("SL-03-ANG-001");
  },
};

/** What is sent is TRIMMED — a space typed before or after the part would otherwise store a second code nobody can see. */
export const WhatIsSentIsTrimmed: Story = {
  name: "Trimmed",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "  ANG-046 ", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), " Gula Aren Cair 500ml ", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());

    await expect(liveProducts().find((p) => p.productCode === "SL-03-ANG-046")).toMatchObject({ name: "Gula Aren Cair 500ml" });
  },
};

/** Creating is **Buat** with a plus — the icon of adding a thing, where an edit's Simpan carries a disk. */
export const CreateCarriesAPlus: Story = {
  name: "Create carries a plus",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const create = canvas.getByTestId("product-edit-save");

    await expect(create).toHaveTextContent("Create");
    await expect(create.querySelector("svg")).toHaveClass("lucide-plus");
  },
};

/** A warehouse does not create products — the New form sends it back to the list, even when reached by URL. */
export const AWarehouseCannotCreate: Story = {
  name: "Warehouse cannot create",
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("at-products", {}, { timeout: 5000 })).toBeInTheDocument();
  },
};
