import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { ORDER_CREATE_META, RoutedFromDraft, RoutedFromDraft202, asMelatiWithMaps } from "./kit";

// ORDER CREATE — the draft's address: pre-filled when it matches one place, still editable, empty when it matches none.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Address",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The draft's address (the-cs-edits-the-whole-address-before-create) ─────────────────────────────────────────────

const levelInput = (canvasElement: HTMLElement, level: string) =>
  within(within(canvasElement).getByTestId(`address-${level}`)).getByRole("combobox");

// PRE-FILLED WHEN CERTAIN: draft 201's four names ("JAWA BARAT", Kota Bandung, Sukajadi, Sukawarna) match exactly one
// place, so the dropdowns open on it — in the region list's own spelling — with the draft's postcode and street. The
// draft's address stays beside them as the marketplace's text, in the hint's sand.
export const ADraftAddressThatMatchesOnePlaceOpensPrefilled: Story = {
  name: "One match, prefilled",
  render: () => <RoutedFromDraft />,
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukawarna"), { timeout: 4000 });
    await expect(levelInput(canvasElement, "provinsi")).toHaveValue("Jawa Barat");
    await expect(levelInput(canvasElement, "kabupaten")).toHaveValue("Kota Bandung");
    await expect(levelInput(canvasElement, "kecamatan")).toHaveValue("Sukajadi");
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40162");
    await expect(canvas.getByTestId("address-line")).toHaveValue("Jl. Sukajadi No. 45");

    const text = canvas.getByTestId("draft-address-text");
    await expect(text).toHaveTextContent("Address from the marketplace");
    await expect(canvas.getByTestId("draft-address-text-street")).toHaveTextContent("Jl. Sukajadi No. 45");
    await expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent(
      "Sukawarna, Sukajadi, Kota Bandung, JAWA BARAT 40162",
    );
    await expect(getComputedStyle(text).backgroundColor).toBe("rgb(251, 247, 239)");
    // Text, not a field.
    await expect(within(text).queryAllByRole("textbox")).toHaveLength(0);
  },
};

// …AND STILL EDITABLE: the pre-fill is where the form starts, never a lock. Another desa of the same kecamatan is picked
// over Sukawarna, and the draft's text beside it is unchanged.
export const APrefilledAddressStaysEditable: Story = {
  name: "Prefilled, still editable",
  render: () => <RoutedFromDraft />,
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukawarna"), { timeout: 4000 });

    await userEvent.click(levelInput(canvasElement, "desa"));
    const other = await screen.findByTestId("address-desa-option-3273011002");
    await waitFor(() => expect(other).toBeVisible());
    await userEvent.click(other);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukagalih"));
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40163");
    await expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent("Sukawarna");
  },
};

// ELSE EMPTY: draft 202's "Kab. Bandung" over Cicendo matches no place (Cicendo is Kota Bandung's — the prefix
// disagrees), so the four dropdowns open empty while the postcode and the street are seeded; the person reads the
// marketplace's text and picks, from the provinsi down.
export const ADraftAddressWithNoMatchOpensEmpty: Story = {
  name: "No match, empty",
  render: () => <RoutedFromDraft202 />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent(
      "Pajajaran, Cicendo, Kab. Bandung, Jawa Barat 40173",
    ), { timeout: 4000 });
    for (const level of ["provinsi", "kabupaten", "kecamatan", "desa"]) {
      await expect(levelInput(canvasElement, level)).toHaveValue("");
    }
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40173");
    await expect(canvas.getByTestId("address-line")).toHaveValue("Jl. Pajajaran No. 12");

    await userEvent.click(levelInput(canvasElement, "provinsi"));
    const jabar = await screen.findByTestId("address-provinsi-option-32");
    await waitFor(() => expect(jabar).toBeVisible());
    await userEvent.click(jabar);
    await waitFor(() => expect(levelInput(canvasElement, "provinsi")).toHaveValue("Jawa Barat"));
    await expect(levelInput(canvasElement, "kabupaten")).toBeEnabled();
  },
};
