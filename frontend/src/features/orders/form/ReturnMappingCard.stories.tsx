import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../../../.storybook/fixtures";
import { returnMapOf, seedReturnMap } from "../../../../.storybook/returnConfigurationStub";
import { ReturnMappingCard } from "./ReturnMappingCard";
import type { CrossLine, MappedProduct } from "./ReturnMappingCard";

// WHERE A BORROWED PRODUCT'S RETURN LANDS — mapped on the order form
// (a-borrowed-product-is-mapped-on-the-order-form), to one of the team's OWN products only
// (a-return-never-clones-a-product), written by ProductReturnMapCreate the moment the pick is confirmed
// (the-map-is-written-when-it-is-picked) and locked from then on (a-return-map-is-written-once).
//
// The card stands as Gudang Pusat (11), whose own products are Kopi (71) and Teh (72); the borrowed ones are real
// fixtures of other teams, so the stub's write applies the server's ownership rules to them. Team 11 maps nothing
// until a story says so (preview.tsx resets the stub's maps per story).
const BERAS: CrossLine = {
  productId: 74n,
  sku: "SKU-BERAS-5K",
  name: "Beras Pandan Wangi 5kg",
  ownerTeamId: 12n,
  ownerName: "Toko Melati",
};
const GULA: CrossLine = {
  productId: 73n,
  sku: "SKU-GULA-1K",
  name: "Gula Pasir 1kg",
  ownerTeamId: 13n,
  ownerName: "Toko Kenanga",
};
// Team 11's OWN Teh, passed off as borrowed — the write refuses it, as the server does.
const NOT_BORROWED: CrossLine = {
  productId: 72n,
  sku: "SKU-TEH-100",
  name: "Teh Melati 100g",
  ownerTeamId: 12n,
  ownerName: "Toko Melati",
};

// The card is controlled, so a story that picks needs real state behind it.
function Stateful({ lines, initial }: { lines: CrossLine[]; initial: [string, MappedProduct][] }) {
  const [mapping, setMapping] = useState(new Map(initial));

  return (
    <ReturnMappingCard
      teamId={11n}
      lines={lines}
      mapping={mapping}
      onMap={(id, mapped) => setMapping((prev) => new Map(prev).set(id.toString(), mapped))}
    />
  );
}

async function pickFirstProduct(canvasElement: HTMLElement) {
  const input = within(canvasElement).getByPlaceholderText("Search your products");

  await userEvent.click(input);
  await userEvent.type(input, "kopi");

  const option = await screen.findByTestId(`product-select-option-${products[0]!.sku}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

const meta = {
  title: "Features/Orders/ReturnMappingCard",
  component: ReturnMappingCard,
} satisfies Meta<typeof ReturnMappingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// A pair written before this order (locked, and says so) above a row still waiting for its answer.
export const Default: Story = {
  args: { teamId: 11n, lines: [], mapping: new Map(), onMap: () => {} },
  render: () => (
    <Stateful
      lines={[BERAS, GULA]}
      initial={[["74", { productId: 71n, name: "Kopi Arabika 250g", remembered: true }]]}
    />
  ),
};

/** The standing pairs are still being read: an unanswered row is a placeholder, not a question — and not counted. */
export const WhileThePairsAreRead: Story = {
  ...Default,
  render: () => (
    <ReturnMappingCard teamId={11n} lines={[BERAS, GULA]} mapping={new Map()} onMap={() => {}} checking />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("return-map-checking-73")).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-map-needs-73")).toBeNull();
    await expect(canvas.queryByTestId("return-map-unmapped")).toBeNull();
    await expect(canvas.queryByPlaceholderText("Search your products")).toBeNull();
  },
};

/** A pair whose product name is still being read shows a placeholder — never an id, never a blank. */
export const ANameStillBeingReadIsAPlaceholder: Story = {
  ...Default,
  render: () => <Stateful lines={[GULA]} initial={[["73", { productId: 71n, remembered: true }]]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("return-map-name-loading-73")).toBeInTheDocument();
    await expect(canvas.getByTestId("return-map-locked-73")).not.toHaveTextContent("71");
  },
};

export const ARememberedPairIsLockedAndSaysSo: Story = {
  ...Default,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("return-map-locked-74")).toBeVisible();
    await expect(canvas.getByTestId("return-map-remembered-74")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /change/i })).toBeNull();
  },
};

export const APickAsksFirstAndIsThenLocked: Story = {
  ...Default,
  render: () => <Stateful lines={[GULA]} initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickFirstProduct(canvasElement);

    // Nothing is written until the person confirms — the map cannot be re-pointed afterwards.
    const dialog = await screen.findByRole("alertdialog");
    // The dialog animates in — until then its controls refuse the click.
    await waitFor(() => expect(within(dialog).getByText("Map for Returns")).toBeVisible());
    await expect(canvas.getByTestId("return-map-needs-73")).toBeVisible();
    await expect(returnMapOf(11n, 73n)).toBe(0n);

    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("return-map-locked-73")).toBeVisible());
    await expect(canvas.getByTestId("return-map-locked-73")).toHaveTextContent(products[0]!.name);
    // WRITTEN, by its own call — before any order exists.
    await expect(returnMapOf(11n, 73n)).toBe(products[0]!.id);
    // Picked on this order, so not "from last time" — but locked all the same.
    await expect(canvas.queryByTestId("return-map-remembered-73")).toBeNull();
    await expect(canvas.queryByTestId("return-map-not-saved-73")).toBeNull();
    await expect(canvas.queryByRole("button", { name: /change/i })).toBeNull();
  },
};

// ⚠ SOMEBODY MAPPED IT FIRST (the-map-is-unique-on-its-source). Gula is already mapped to Teh by a colleague; this pick
// of Kopi comes back `created = false` with THAT pair — and the row shows the pair that stands, says the pick was not
// saved, and the stored pair is untouched.
export const APairAlreadyStandingWinsAndSaysSo: Story = {
  ...Default,
  beforeEach: () => seedReturnMap(11n, 73n, 72n),
  render: () => <Stateful lines={[GULA]} initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickFirstProduct(canvasElement);

    const confirm = within(await screen.findByRole("alertdialog")).getByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const locked = await canvas.findByTestId("return-map-locked-73");
    await waitFor(() => expect(locked).toHaveTextContent("Teh Melati 100g"));
    await expect(locked).not.toHaveTextContent(products[0]!.name);
    await expect(canvas.getByTestId("return-map-not-saved-73")).toHaveTextContent(
      `Someone mapped it first — ${products[0]!.name} was not saved.`,
    );
    await expect(returnMapOf(11n, 73n)).toBe(72n);
  },
};

// A REFUSED WRITE LEAVES THE ROW UNMAPPED. Team 11's own Teh offered as borrowed: the server refuses it, the toast says
// so, and the row is still asking — nothing was written.
export const AFailedWriteLeavesTheRowUnmapped: Story = {
  ...Default,
  render: () => <Stateful lines={[NOT_BORROWED]} initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickFirstProduct(canvasElement);

    const confirm = within(await screen.findByRole("alertdialog")).getByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expect(await screen.findByText("The map was not saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(canvas.getByTestId("return-map-needs-72")).toBeVisible();
    await expect(canvas.queryByTestId("return-map-locked-72")).toBeNull();
    await expect(returnMapOf(11n, 72n)).toBe(0n);
  },
};

export const ACancelledPickWritesNothing: Story = {
  ...Default,
  render: () => <Stateful lines={[GULA]} initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickFirstProduct(canvasElement);

    const dialog = await screen.findByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toBeVisible());
    await userEvent.click(cancel);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(canvas.getByTestId("return-map-needs-73")).toBeVisible();
    await expect(canvas.getByPlaceholderText("Search your products")).toHaveValue("");
  },
};

export const AnUnmappedRowOffersOnlyOurOwnProducts: Story = {
  ...Default,
  render: () => <Stateful lines={[GULA]} initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("return-map-needs-73")).toBeVisible();
    await expect(canvas.getByTestId("return-map-unmapped")).toHaveTextContent("1 not mapped");
    // Nothing is ever cloned: the only answer is the picker over this team's catalogue.
    await expect(canvas.queryByRole("button", { name: /duplicate/i })).toBeNull();
    await expect(canvas.getByPlaceholderText("Search your products")).toBeVisible();
  },
};
