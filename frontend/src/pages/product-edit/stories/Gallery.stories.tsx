import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { liveProducts } from "../../../../.storybook/productStub";
import { AtEditMinyak, PRODUCT_FORM_META, attach, loaded, loadedMinyak, picture } from "./kit";

// PRODUCT FORM — the gallery, a cover and four (the-gallery-is-a-cover-and-four): files dropped in order, the cover and
// the ★, five at most — and a picture from the web (owner: *"di produk aku seret file dari intertet untuk gambar tidak
// bisa"*, a-picture-comes-from-the-web-by-drag-or-paste), dragged from a page or pasted. The page's stories are grouped
// by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/Gallery",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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

/**
 * Drop a picture FROM A WEB PAGE on the gallery — no file, only the page's HTML for it and the address it links to, as a
 * browser carries a drag from another tab.
 */
function dropFromPage(canvasElement: HTMLElement, src: string, link = "https://toko.example/produk/42") {
  const zone = canvasElement.querySelector<HTMLElement>('[data-testid="product-images-dropzone"]')!;
  const data = new DataTransfer();
  data.setData("text/html", `<a href="${link}"><img src="${src}" alt="produk"></a>`);
  data.setData("text/uri-list", link);
  for (const type of ["dragenter", "dragover", "drop"]) {
    zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
}

/** A picture as a page would show it — a data: address, which the browser can always read. */
async function pictureUrl(colour: string): Promise<string> {
  const file = await picture("web.png", colour);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

/** A NEW PRODUCT'S GALLERY: one big box asking for a drop, four small empty ones (the-gallery-is-a-cover-and-four). */
export const AnEmptyGalleryAsksForADrop: Story = {
  name: "Empty, asks for a drop",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const add = canvas.getByTestId("add-product-image");

    await expect(add).toHaveAttribute("data-slot", "cover");
    await expect(add).toHaveTextContent("Drop or paste (Ctrl+V) images here, or click to choose");
    for (const i of [1, 2, 3, 4]) {
      await expect(canvas.getByTestId(`product-image-empty-${i}`)).toHaveAttribute("data-slot", "small");
    }
  },
};

/** FILES DROPPED ON THE GALLERY fill the boxes in order — the first one the cover, the next the first small box. And
 * THE BOXES KEEP THEIR SIZE (owner: *"ukurannya tidak konsisten, saat kosong, loading upload dan setelahnya"*): the
 * gallery is the card's width empty, while uploading and filled, so nothing jumps as a picture lands. */
export const DroppedFilesFillTheBoxes: Story = {
  name: "Dropped files fill the boxes",
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
  name: "Star makes the cover",
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

/** Removing the cover makes the next picture the cover — and the product's cover follows once saved. */
export const RemovingTheCoverPromotesTheNext: Story = {
  name: "Remove the cover",
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
  name: "Holds five",
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

/** A PICTURE DRAGGED FROM A WEB PAGE carries no file — its <img> is fetched and uploaded, and fills the cover. The
 * <img>'s address is used, not the link around it, which is a page. */
export const APictureFromAWebPageDrops: Story = {
  name: "From a web page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    dropFromPage(canvasElement, await pictureUrl("#0ea5e9"));

    await waitFor(() => expect(canvas.getByTestId("product-image-0")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("product-images-help")).toHaveTextContent("1/5");
  },
};

/** A SITE THAT WILL NOT HAND ITS PICTURE OVER is answered with the way round it — copy the picture, paste it here. */
export const ABlockedPictureSaysHowToCopyIt: Story = {
  name: "Blocked, copy it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    dropFromPage(canvasElement, "https://blocked-shop.invalid/foto.jpg");

    // The toast slides in — visible once it has arrived.
    const title = await screen.findByText("That site does not let its picture be taken", {}, { timeout: 8000 });
    await waitFor(() => expect(title).toBeVisible());
    await expect(screen.getByText("Right-click the picture, choose Copy image, then paste it here with Ctrl+V.")).toBeVisible();
    await expect(canvas.queryByTestId("product-image-0")).toBeNull();
  },
};

/** A COPIED PICTURE PASTES with Ctrl+V — from any page, since the browser copies the picture itself. */
export const APastedPictureFillsABox: Story = {
  name: "Pasted",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const data = new DataTransfer();
    data.items.add(await picture("salin.png", "#f59e0b"));

    document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));

    await waitFor(() => expect(canvas.getByTestId("product-image-0")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("product-images-help")).toHaveTextContent("1/5");
  },
};
