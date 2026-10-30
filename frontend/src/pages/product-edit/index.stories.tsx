import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
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
// Reached by a pasted link — no screen opened it, so there is no "came from" (the-form-returns-where-it-was-opened).
const AtEditMinyak = routedPage(routes, "/products/700/edit");
// Opened from the product's own page, as its Ubah does.
const AtEditFromDetail = routedPage(routes, { pathname: "/products/700/edit", state: { from: "/products/700" } });
// Opened from a filtered list, as a row's Ubah does — the list route shows its query, to see it came back filtered.
const AtEditFromList = routedPage(
  [
    routes[0]!,
    routes[1]!,
    { path: "/products", element: <><span data-testid="at-products" /><LocationProbe /></> },
    marker("/products/:productId", "at-product-detail"),
  ],
  { pathname: "/products/700/edit", state: { from: "/products?q=minyak" } },
);

// "ProductForm" (owner: *"di story jadi form aja namanya"*): one page creates AND edits a product, so the sidebar names
// it for what it is rather than for one of its two routes.
const meta = {
  title: "Pages/Products/ProductForm",
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

/**
 * Drop files on the gallery, as a browser does — dragenter, dragover, drop, each carrying the files.
 *
 * ⚠ A DataTransfer BUILT BY A SCRIPT has no file-system entry behind its items (`webkitGetAsEntry()` is null in
 * Chromium), and the dropzone reads files through that entry — so a scripted drop would arrive empty. For the length
 * of the drop, each item answers with the plain file entry a drag from the desktop carries.
 */
async function drop(canvasElement: HTMLElement, files: File[]) {
  const zone = canvasElement.querySelector<HTMLElement>('[data-testid="product-images-dropzone"]');
  await expect(zone).not.toBeNull();
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);

  const original = DataTransferItem.prototype.webkitGetAsEntry;
  DataTransferItem.prototype.webkitGetAsEntry = function (this: DataTransferItem) {
    return { isFile: true, isDirectory: false, name: this.getAsFile()?.name ?? "" } as unknown as FileSystemEntry;
  };
  try {
    for (const type of ["dragenter", "dragover", "drop"]) {
      zone!.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
    }
  } finally {
    DataTransferItem.prototype.webkitGetAsEntry = original;
  }
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

/** The minimum is a QUANTITY, so it is `QuantityInput` — a − and a + either side of the box, never a typed number field
 * that changes on a scroll. */
export const TheMinimumSteps: Story = {
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

/** A markup that is not a usable percent, or a minimum that is not a whole count of at least one, says so and holds the
 * save — never read as 0, which would be a discount, or an open lock, nobody chose. */
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
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "SKU-ANG-045", { delay: 30 });
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

/** A SKU a live product already holds is refused by the server — and said UNDER THE SKU, not at the top of the page: the
 * field turns red, Save stays shut while that SKU stands, and changing it clears both. The form stays as typed. */
export const ATakenSkuIsSaidUnderTheSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "SKU-ANG-002", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Karton Baru", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.click(canvas.getByTestId("product-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("product-edit-sku-taken")).toHaveTextContent("already uses this SKU"));
    await expect(canvas.queryByTestId("product-edit-error")).toBeNull();
    await expect(canvas.queryByTestId("at-products")).toBeNull();
    await expect(canvas.getByTestId("product-edit-name")).toHaveValue("Minyak Goreng Sawit 2L — Karton Baru");
    await expect(canvas.getByTestId("product-edit-save")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "B", { delay: 30 });
    await waitFor(() => expect(canvas.queryByTestId("product-edit-sku-taken")).toBeNull());
    await expect(canvas.getByTestId("product-edit-save")).toBeEnabled();
  },
};

/** EVERY LIMIT IS SHOWN (a-limited-field-shows-its-count) — "5/64" under the SKU, the name and the description, the box
 * stopping at the server's limit; an edit counts what it arrived with. */
export const EveryLimitIsShown: Story = {
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

/** What is sent is TRIMMED — a space typed before or after a SKU would otherwise store a second SKU nobody can see. */
export const WhatIsSentIsTrimmed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-edit-sku"), "  SKU-ANG-046 ", { delay: 30 });
    await userEvent.type(canvas.getByTestId("product-edit-name"), " Gula Aren Cair 500ml ", { delay: 30 });
    await pickDapur(canvas);
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());

    await expect(liveProducts().find((p) => p.sku === "SKU-ANG-046")).toMatchObject({ name: "Gula Aren Cair 500ml" });
  },
};

/** Saving an edit writes it and lands on THE PRODUCT'S PAGE — where it was opened from, as Back goes too (the-form-returns-where-it-was-opened) —
 * the gallery sent back as it stands, so it is kept, not dropped. */
export const SavingAnEditReturnsToTheProduct: Story = {
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Botol");
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());

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

/** The gallery holds five — once full, no empty box is left to pick into. */
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
    await expect(canvas.queryByTestId("add-product-image")).toBeNull();
    await expect(canvas.getByTestId("product-images-help")).toHaveTextContent("5/5");
  },
};

/** A NEW PRODUCT'S GALLERY: one big box asking for a drop, four small empty ones (the-gallery-is-a-cover-and-four). */
export const AnEmptyGalleryAsksForADrop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const add = canvas.getByTestId("add-product-image");

    await expect(add).toHaveAttribute("data-slot", "cover");
    await expect(add).toHaveTextContent("Drop images here, or click to choose");
    for (const i of [1, 2, 3, 4]) {
      await expect(canvas.getByTestId(`product-image-empty-${i}`)).toHaveAttribute("data-slot", "small");
    }
  },
};

/** FILES DROPPED ON THE GALLERY fill the boxes in order — the first one the cover, the next the first small box. And
 * THE BOXES KEEP THEIR SIZE (owner: *"ukurannya tidak konsisten, saat kosong, loading upload dan setelahnya"*): the
 * gallery is the card's width empty, while uploading and filled, so nothing jumps as a picture lands. */
export const DroppedFilesFillTheBoxes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // Read afresh each time: the picker remounts after every upload (pickerKey), so a kept element would be detached.
    const zone = () => canvas.getByTestId("product-images-dropzone");
    const card = canvas.getByTestId("product-images-input");
    const size = (el: Element) => Math.round(el.getBoundingClientRect().width);
    const coverBox = () => canvasElement.querySelector('[data-testid="product-images-dropzone"] [data-slot="cover"]')!;
    const smallBox = () => canvasElement.querySelector('[data-testid="product-images-dropzone"] [data-slot="small"]')!;

    // Measured once the page has laid out — it arrives with a short entrance.
    await waitFor(() => expect(size(zone())).toBeGreaterThan(0));
    await expect(size(zone())).toBe(size(card));
    const cover = size(coverBox());
    const small = size(smallBox());

    await drop(canvasElement, [await picture("depan.png", "#16a34a"), await picture("samping.png", "#9333ea")]);

    await waitFor(() => expect(canvas.getByTestId("product-image-1")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("product-image-0").parentElement!).toHaveAttribute("data-slot", "cover");
    await expect(canvas.getByTestId("product-image-1").parentElement!).toHaveAttribute("data-slot", "small");
    await expect(canvas.getByTestId("add-product-image")).toHaveAttribute("data-slot", "small");
    await expect(canvas.getByTestId("product-images-help")).toHaveTextContent("2/5");

    await expect(size(zone())).toBe(size(card));
    await expect(size(coverBox())).toBe(cover);
    await expect(size(smallBox())).toBe(small);
  },
};

/** ★ MAKES A SMALL ONE THE COVER — it moves into the big box, and the old cover becomes the first small box; the
 * product's cover follows once saved. */
export const AStarMakesTheCover: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const front = canvas.getByTestId("product-image-0").getAttribute("src")!;
    const label = canvas.getByTestId("product-image-1").getAttribute("src")!;

    await expect(canvas.queryByTestId("make-cover-product-image-0")).toBeNull();
    await userEvent.click(canvas.getByTestId("make-cover-product-image-1"));

    await waitFor(() => expect(canvas.getByTestId("product-image-0")).toHaveAttribute("src", label));
    await expect(canvas.getByTestId("product-image-1")).toHaveAttribute("src", front);

    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(liveProducts().find((p) => p.id === 700n)!.defaultImageUrl).toBe(label);
  },
};

/** BACK RETURNS TO WHERE THE FORM WAS OPENED FROM (the-form-returns-where-it-was-opened): from the product's page, back
 * there; from a filtered list, back to that list with its query; reached by a link, to the list. */
export const BackFromAnEditReturnsToTheProduct: Story = {
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

/** Creating is **Buat** with a plus — the icon of adding a thing, where an edit's Simpan carries a disk. */
export const CreateCarriesAPlus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const create = canvas.getByTestId("product-edit-save");

    await expect(create).toHaveTextContent("Create");
    await expect(create.querySelector("svg")).toHaveClass("lucide-plus");
  },
};

export const BackFromAnEditOpenedFromTheListReturnsToTheList: Story = {
  render: () => <AtEditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back-foot"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=minyak");
  },
};

export const ASaveFromTheListReturnsToTheList: Story = {
  render: () => <AtEditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Botol");
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=minyak");
  },
};

export const AnEditReachedByALinkReturnsToTheList: Story = {
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

export const BackFromANewOneReturnsToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

/** BACK IS AT THE FOOT TOO, with its arrow, right beside Save — and goes where the top arrow goes. */
export const BackAtTheFootGoesWhereTheArrowGoes: Story = {
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const back = canvas.getByTestId("product-edit-back-foot");

    await expect(back).toHaveTextContent("Back");
    await expect(back.querySelector("svg")).not.toBeNull();
    // Beside it, not across the page: the two share a parent and Back comes first.
    const save = canvas.getByTestId("product-edit-save");
    await expect(back.parentElement).toBe(save.parentElement);
    await expect(back.nextElementSibling).toBe(save);
    await expect(save.querySelector("svg")).not.toBeNull();

    await userEvent.click(back);
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
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
