import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { regionTree, regions } from "../../../.storybook/fixtures";
import { AddressPicker, type AddressValue, description, emptyAddress } from "./AddressPicker";

const filled: AddressValue = {
  provinsiCode: "32",
  provinsiName: "Jawa Barat",
  kabupatenCode: "3273",
  kabupatenName: "Kota Bandung",
  kecamatanCode: "327301",
  kecamatanName: "Sukajadi",
  desaCode: "3273011001",
  desaName: "Sukawarna",
  kodePos: "40162",
  addressLine: "Jl. Sukajadi No. 12, RT 03/RW 05",
};

const meta = {
  title: "Components/Customers/AddressPicker",
  component: AddressPicker,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: emptyAddress, onChange: fn() },
  decorators: [
    (Story) => (
      <Box w="lg">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof AddressPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { args: { value: filled } };

export const Disabled: Story = { args: { value: filled, disabled: true } };

// The levels CASCADE: a kabupaten cannot be chosen before its provinsi, because the list is loaded
// by `parentCode`. Until then the field is disabled rather than showing every kabupaten in Indonesia.
export const LevelsAreDisabledUntilTheirParentIsChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const provinsi = within(canvas.getByTestId("address-provinsi")).getByRole("combobox");
    const kabupaten = within(canvas.getByTestId("address-kabupaten")).getByRole("combobox");

    await expect(provinsi).toBeEnabled();
    await expect(kabupaten).toBeDisabled();
  },
};

export const ProvinsiLoadsTheTopLevel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(within(canvas.getByTestId("address-provinsi")).getByRole("combobox"));

    // Portalled listbox. The top level is everything with no parent.
    const option = await screen.findByTestId("address-provinsi-option-32");
    await waitFor(() => expect(option).toBeVisible());
    await expect(option).toHaveTextContent("Jawa Barat");
  },
};

// ⚠ PICKING A LEVEL CLEARS EVERY LEVEL BELOW IT — and the kode pos with them. A kabupaten left over
// from the previous provinsi is a WRONG ADDRESS THAT STILL LOOKS FILLED IN, which is worse than an
// empty one. `addressLine` survives: it is free text, not derived from the region.
export const PickingAProvinsiClearsTheLevelsBelow: Story = {
  args: { value: filled },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(within(canvas.getByTestId("address-provinsi")).getByRole("combobox"));
    const option = await screen.findByTestId("address-provinsi-option-33");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      ...emptyAddress,
      addressLine: filled.addressLine,
      provinsiCode: "33",
      provinsiName: regionTree.find((r) => r.code === "33")!.name,
    });
  },
};

// ⚠ THE POSTCODE IS THE ENTRY POINT, and that is the design decision worth pinning (#117). It
// replaced a search over region NAMES: names are spelled three ways, hundreds of desa are called
// "Sukamaju", and the person typing the order cannot tell the right one from a list. Five digits
// copied off a message have no such problem — and picking one BACK-FILLS ALL FOUR LEVELS.
//
// ⚠ Two things this story had to get right, both easy to get wrong:
//   - `address-kodepos` is on the Combobox ROOT, not the input — typing into the div does nothing.
//   - the picker is CONTROLLED, so the story must hold real state. With a static `value` arg the
//     typed digits never come back down, `q` stays empty and the search never runs.
export const PostcodeBackFillsEveryLevel: Story = {
  render: (args) => {
    const [value, setValue] = useState<AddressValue>(emptyAddress);

    return (
      <>
        <AddressPicker {...args} value={value} onChange={setValue} />
        <pre data-testid="readout">
          {[value.provinsiName, value.kabupatenName, value.kecamatanName, value.desaName]
            .filter(Boolean)
            .join(" › ")}
          {` | ${value.kodePos}`}
        </pre>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const kodePos = within(canvas.getByTestId("address-kodepos")).getByRole("combobox");
    // ⚠ `delay` is required. The input's text is CONTROLLED (`inputValue={typed ?? value}`), so each
    // keystroke has to round-trip through React state before the next one lands. Typing at machine
    // speed drops characters — "40162" arrives as "4062" — and the search then finds nothing, which
    // reads as a broken picker rather than a too-fast test.
    await userEvent.type(kodePos, "40162", { delay: 40 });

    const hit = await screen.findByTestId(`address-kodepos-option-${regions[0]!.desaCode}`, undefined, {
      timeout: 3000,
    });
    await waitFor(() => expect(hit).toBeVisible());
    await userEvent.click(hit);

    // One postcode fills provinsi, kabupaten, kecamatan AND desa.
    await waitFor(() =>
      expect(canvas.getByTestId("readout")).toHaveTextContent(
        "Jawa Barat › Kota Bandung › Sukajadi › Sukawarna | 40162",
      ),
    );
  },
};

// Below three digits it does not ask at all — the floor the proto enforces. One digit covers a tenth
// of the country's desa, and twenty rows out of thousands is a lottery, not a suggestion.
export const PostcodeDoesNotSearchBelowThreeDigits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(within(canvas.getByTestId("address-kodepos")).getByRole("combobox"), "40");

    await expect(screen.queryByTestId(`address-kodepos-option-${regions[0]!.desaCode}`)).toBeNull();
  },
};

// The street detail is the part NO dataset can supply, so it is plain free text and is never
// cleared by a region change.
export const StreetDetailIsFreeText: Story = {
  args: { value: filled },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("address-line"), "!");

    await expect(args.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ addressLine: `${filled.addressLine}!` }),
    );
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<AddressValue>(emptyAddress);

    return (
      <>
        <AddressPicker {...args} value={value} onChange={setValue} />
        <pre data-testid="readout">{[value.provinsiName, value.kabupatenName, value.kecamatanName, value.desaName].filter(Boolean).join(" › ")}</pre>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // `delay` for the same controlled-input reason as PostcodeBackFillsEveryLevel.
    await userEvent.type(
      within(canvas.getByTestId("address-kodepos")).getByRole("combobox"),
      "40173",
      { delay: 40 },
    );

    const hit = await screen.findByTestId(`address-kodepos-option-${regions[1]!.desaCode}`, undefined, {
      timeout: 3000,
    });
    await waitFor(() => expect(hit).toBeVisible());
    await userEvent.click(hit);

    await waitFor(() =>
      expect(canvas.getByTestId("readout")).toHaveTextContent("Jawa Barat › Kota Bandung › Cicendo › Pajajaran"),
    );
  },
};

// ── THE SECOND WAY IN: THE KECAMATAN (owner) ────────────────────────────────────────────────────

// It is OFF unless asked for, and that is what keeps every screen already using this picker exactly
// as it was. A second search box appearing on the order form, the warehouse form and the user profile
// because one screen wanted it is the change nobody asked for.
export const KecamatanSearchIsOptIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("address-kecamatan-search")).toBeNull();
    // The kode pos path is untouched and still on top.
    await expect(canvas.getByTestId("address-kodepos")).toBeInTheDocument();
  },
};

// ⚠ THE RULE THIS PAIR EXISTS FOR: A KODE POS BELONGS TO A DESA, NOT A KECAMATAN.
//
// Cicendo holds one desa, so its postcode is not a guess — it is the only answer, and filling it
// saves the person a pick. Sukajadi holds two desa with DIFFERENT codes (40162, 40163), and there the
// field is left EMPTY on purpose: picking one of them would put orders in the wrong kelurahan and
// give nobody a way to see it happen. The desa select below is what settles it.
export const KecamatanWithOnePostcodeFillsIt: Story = {
  args: { kecamatanSearch: true },
  render: function Render(args) {
    const [value, setValue] = useState<AddressValue>(emptyAddress);

    return (
      <>
        <AddressPicker {...args} value={value} onChange={setValue} />
        <pre data-testid="readout">
          {[value.provinsiName, value.kabupatenName, value.kecamatanName].filter(Boolean).join(" › ")}
          {` | ${value.kodePos || "—"}`}
        </pre>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(
      within(canvas.getByTestId("address-kecamatan-search")).getByRole("combobox"),
      "cice",
      { delay: 40 },
    );

    const hit = await screen.findByTestId("address-kecamatan-option-327302", undefined, {
      timeout: 3000,
    });
    await waitFor(() => expect(hit).toBeVisible());
    await userEvent.click(hit);

    // Everything above the kecamatan, and the one postcode its desa share.
    await waitFor(
      () =>
        expect(canvas.getByTestId("readout")).toHaveTextContent(
          "Jawa Barat › Kota Bandung › Cicendo | 40173",
        ),
      { timeout: 3000 },
    );
  },
};

export const KecamatanWithSeveralPostcodesLeavesItEmpty: Story = {
  args: { kecamatanSearch: true },
  render: KecamatanWithOnePostcodeFillsIt.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(
      within(canvas.getByTestId("address-kecamatan-search")).getByRole("combobox"),
      "sukaj",
      { delay: 40 },
    );

    const hit = await screen.findByTestId("address-kecamatan-option-327301", undefined, {
      timeout: 3000,
    });
    await waitFor(() => expect(hit).toBeVisible());
    await userEvent.click(hit);

    // Sukajadi's two desa carry 40162 and 40163 — so the code is the person's to settle, not ours.
    await waitFor(
      () =>
        expect(canvas.getByTestId("readout")).toHaveTextContent(
          "Jawa Barat › Kota Bandung › Sukajadi | —",
        ),
      { timeout: 3000 },
    );
  },
};
