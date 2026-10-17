import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { liveProducts } from "../../../.storybook/productStub";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductEditPage } from "./index";

// THE PRODUCT FORM — one page for New (/products/new) and Edit (/products/:id/edit), AS THE SCREEN STANDS TODAY: the
// gallery beside the record, the SKU, name, description and a LEAF category, the hold-back, the markup another team
// pays, and the lock. The stub is productStub.ts, writeable, with the server's rule that a SKU is held once among the
// live — so a story can save and then read back what was sent.
//
//   700  SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan   two pictures, a description, 12.5% markup, 4 held back
//   categories        Elektronik › Audio › Headphone, Rumah Tangga › Dapur — only Headphone and Dapur are leaves

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products/new", element: <ProductEditPage /> },
  { path: "/products/:productId/edit", element: <ProductEditPage /> },
  marker("/products", "at-products"),
  marker("/products/:productId", "at-product-detail"),
];
const AtNew = routedPage(routes, "/products/new");
const AtEditMinyak = routedPage(routes, "/products/700/edit");

const meta = {
  title: "Pages/Products/ProductEdit",
  component: AtNew,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
} satisfies Meta<typeof AtNew>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-edit-page", {}, { timeout: 5000 });
  return canvas;
}

async function loadedMinyak(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("product-edit-sku")).toHaveValue("SKU-ANG-001"));
  return canvas;
}

/** Retype a field from empty — a controlled input, so slowly enough that no keystroke is dropped. */
async function retype(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  if (text !== "") await userEvent.type(field, text, { delay: 30 });
}

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

/** A real (if plain) PNG, so the thumbnail shows the picture that was picked rather than a broken image. */
async function picture(name: string, colour: string): Promise<File> {
  const board = document.createElement("canvas");
  board.width = board.height = 96;
  const pen = board.getContext("2d")!;
  pen.fillStyle = colour;
  pen.fillRect(0, 0, 96, 96);
  const blob = await new Promise<Blob>((resolve) => board.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

async function attach(canvasElement: HTMLElement, files: File[]) {
  const input = canvasElement.querySelector<HTMLInputElement>('[data-testid="product-images-input"] input[type="file"]');
  await expect(input).not.toBeNull();
  await userEvent.upload(input!, files, { applyAccept: false });
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** A new product — an empty form. */
export const Default: Story = {};

/** Editing 700 — the gallery and every field filled from the record. */
export const Editing: Story = {
  render: () => <AtEditMinyak />,
};

/** A phone — the same form in one column, as the screen stands today. */
export const Mobile: Story = {
  render: () => <AtEditMinyak />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await loadedMinyak(canvasElement);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** Edit arrives FILLED from the record — the markup as the percent it was typed in, the first picture as the cover. */
export const TheEditFormArrivesFilled: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Goreng Sawit 2L — Satuan");
    await expect((canvas.getByTestId("product-edit-description") as HTMLTextAreaElement).value).toContain(
      "Minyak goreng kelapa sawit",
    );
    await waitFor(() => expect(canvas.getByTestId("category-select")).toHaveTextContent("Rumah Tangga"));
    await expect(canvas.getByTestId("product-edit-cross-markup")).toHaveValue("12.5");
    await expect(canvas.getByTestId("product-edit-reserved-stock")).toHaveValue("4");
    await expect(within(canvas.getByTestId("product-edit-cross-locked")).getByRole("checkbox")).not.toBeChecked();

    await expect(canvas.getByTestId("product-image-1")).toBeVisible();
    await expect(canvas.getByTestId("product-image-0").parentElement!).toHaveTextContent("Cover");
    await expect(canvas.getByTestId("product-image-1").parentElement!).not.toHaveTextContent("Cover");
  },
};

/** Save stays shut until the SKU, the name AND a category are given — the category is the one people forget. */
export const SaveWaitsForTheRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const save = canvas.getByTestId("product-edit-save");

    await expect(save).toBeDisabled();
    await userEvent.type(canvas.getByTestId("product-edit-sku"), "SKU-ANG-045", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 5L — Jeriken", { delay: 30 });
    await expect(save).toBeDisabled();

    await pickDapur(canvas);
    await expect(save).toBeEnabled();
  },
};

/** A markup that is not a usable percent, or a hold-back that is not a whole count, says so and holds the save —
 * never read as 0, which would be a discount, or a hold-back, nobody chose. */
export const AnUnusableFigureHoldsTheSave: Story = {
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

    await retype(canvas.getByTestId("product-edit-reserved-stock"), "1.5");
    await waitFor(() => expect(canvasElement).toHaveTextContent("Enter a whole number of units"));
    await expect(save).toBeDisabled();
  },
};

/** Creating sends the whole record — the markup typed as a percent arrives as basis points — and lands on the list. */
export const CreatingLandsOnTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "SKU-ANG-045", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 5L — Jeriken", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.type(canvas.getByTestId("product-edit-reserved-stock"), "3", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-cross-markup"), "7.5", { delay: 30 });
    await userEvent.click(canvas.getByTestId("product-edit-cross-locked"));
    await attach(canvasElement, [await picture("jeriken.png", "#facc15")]);
    await waitFor(() => expect(canvas.getByTestId("product-image-0")).toBeVisible());

    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());

    const created = liveProducts().find((p) => p.sku === "SKU-ANG-045");
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

/** A SKU a live product already holds is refused by the server — the reason shows, and the form stays as typed. */
export const ATakenSkuIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "SKU-ANG-002", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Karton Baru", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.click(canvas.getByTestId("product-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("product-edit-error")).toHaveTextContent("already exists"));
    await expect(canvas.queryByTestId("at-products")).toBeNull();
    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Goreng Sawit 2L — Karton Baru");
  },
};

/** Saving an edit writes it and lands on the list — the gallery sent back as it stands, so it is kept, not dropped. */
export const SavingAnEditLandsOnTheList: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Botol");
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());

    const saved = liveProducts().find((p) => p.id === 700n)!;
    await expect(saved).toMatchObject({ name: "Minyak Goreng Sawit 2L — Botol", crossMarkupBps: 1250, reservedStock: 4 });
    await expect(saved.images).toHaveLength(2);
  },
};

/** Removing the cover makes the next picture the cover — and the product's cover follows once saved. */
export const RemovingTheCoverPromotesTheNext: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const label = canvas.getByTestId("product-image-1").getAttribute("src")!;

    await userEvent.click(canvas.getByTestId("remove-product-image-0"));
    await waitFor(() => expect(canvas.queryByTestId("product-image-1")).toBeNull());
    await expect(canvas.getByTestId("product-image-0")).toHaveAttribute("src", label);
    await expect(canvas.getByTestId("product-image-0").parentElement!).toHaveTextContent("Cover");

    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(liveProducts().find((p) => p.id === 700n)!.defaultImageUrl).toBe(label);
  },
};

/** The gallery holds five — once full, Add is shut. */
export const TheGalleryHoldsFive: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    await expect(canvas.getByTestId("add-product-image")).toBeEnabled();

    await attach(canvasElement, [
      await picture("tutup.png", "#dc2626"),
      await picture("kardus.png", "#a16207"),
      await picture("rak.png", "#0284c7"),
    ]);
    await waitFor(() => expect(canvas.getByTestId("product-image-4")).toBeVisible());
    await expect(canvas.getByTestId("add-product-image")).toBeDisabled();
  },
};

/** Back returns to where the form was opened from: an edit to the product's page, a new one to the list. */
export const BackFromAnEditReturnsToTheProduct: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const BackFromANewOneReturnsToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

/** A warehouse does not create products — the New form sends it back to the list, even when reached by URL. */
export const AWarehouseCannotCreate: Story = {
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("at-products", {}, { timeout: 5000 })).toBeInTheDocument();
  },
};
