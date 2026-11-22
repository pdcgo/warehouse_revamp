import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, fn, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { supplierFixtures } from "../../../.storybook/supplierFixtures";
import { supplierClient } from "../../api/clients";
import { useSaveSupplier } from "../../features/suppliers/queries";
import { SupplierSelect, description } from "./SupplierSelect";

// Team 12 is a selling team — only a selling team has suppliers (only-a-selling-team-has-suppliers). Other
// teams' suppliers are in the fixtures too, and so is a deleted one of team 12's: neither is ever offered here.
const TEAM = 12n;
const suppliers = supplierFixtures.filter((s) => s.teamId === TEAM && !s.deleted);
const otherTeams = supplierFixtures.filter((s) => s.teamId !== TEAM);
const deleted = supplierFixtures.filter((s) => s.teamId === TEAM && s.deleted);

const meta = {
  title: "Components/Pickers/SupplierSelect",
  component: SupplierSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { teamId: TEAM, onChange: fn() },
} satisfies Meta<typeof SupplierSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: suppliers[0]!.id } };

export const Disabled: Story = { args: { value: suppliers[0]!.id, disabled: true } };

// The whole list is loaded rather than searched server-side, and that is deliberate: a server-side
// search starts empty by design, so a supplier already selected on an edit form would not be in the
// collection to resolve into display text.
export const OpensOnClickWithTheWholeList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    for (const supplier of suppliers) {
      const option = await screen.findByTestId(`supplier-select-option-${supplier.id}`);
      await waitFor(() => expect(option).toBeVisible());
    }
    for (const supplier of otherTeams) {
      await expect(screen.queryByTestId(`supplier-select-option-${supplier.id}`)).toBeNull();
    }
    // a-deleted-supplier-is-kept-for-its-figures: it leaves every picker.
    await expect(deleted.length).toBeGreaterThan(0);
    for (const supplier of deleted) {
      await expect(screen.queryByTestId(`supplier-select-option-${supplier.id}`)).toBeNull();
    }
  },
};

// Matches on the NAME — a supplier has no code any more (the-supplier-has-no-code).
export const SearchesByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "Cahaya", { delay: 40 });

    await waitFor(() => expect(screen.getByTestId(`supplier-select-option-${suppliers[1]!.id}`)).toBeVisible(), { timeout: 5000 });
    await expect(screen.queryByTestId(`supplier-select-option-${suppliers[0]!.id}`)).toBeNull();
  },
};

// ⚠ CLEARING EMITS 0n — it does not do nothing (#131).
//
// "No supplier" is a legitimate value: a restock need not name one. Swallowing the empty case is
// what made this picker's predecessor WRITE-ONCE — a supplier recorded by mistake could never be
// removed, though the contract, the handler and its test all supported clearing it.
export const ClearingEmitsZero: Story = {
  args: { value: suppliers[0]!.id },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const clear = await canvas.findByRole("button", { name: /clear/i });
    await userEvent.click(clear);

    await expect(args.onChange).toHaveBeenCalledWith(0n);
  },
};

// The #131 regression, guarded: an edit form mounts this with a supplier ALREADY set while the list
// is still in flight. Zag derives the input's display text when the machine initialises, so a
// collection that fills in later never re-derives it — the field would read blank while a supplier
// is in fact selected. The component re-keys on load for exactly this.
export const PrefilledValueShowsItsName: Story = {
  args: { value: suppliers[1]!.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByDisplayValue(new RegExp(suppliers[1]!.name))).toBeInTheDocument();
  },
};

// ⚠ THE REGRESSION GUARD for a bug these stories found: picking a supplier used to leave the field
// BLANK.
//
// The selection was always correct — `onChange` fired with the right id — but the DISPLAY TEXT
// vanished: on selection the combobox writes itemToString back into the input, which re-runs the filter
// with the WHOLE label as the query, and the filter of the day did not match the label. The label is now
// the bare name and the filter matches `itemText`, so this story asserts BOTH halves: the value
// round-trips AND the name is on screen. Asserting only the value is what let the bug exist.
export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0n);

    return (
      <>
        <SupplierSelect {...args} value={value} onChange={setValue} />
        <p data-testid="picked">{value.toString()}</p>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    const option = await screen.findByTestId(`supplier-select-option-${suppliers[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    // The value round-trips …
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(suppliers[0]!.id.toString()));
    // … and the picked supplier is READABLE in the field, which is the half that used to break.
    await waitFor(() =>
      expect(canvas.getByRole("combobox")).toHaveValue(suppliers[0]!.name),
    );
  },
};

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

// A picker mounted after the first — a second restock form, the same form opened again.
function ASecondPickerLater(props: { onChange: (id: bigint) => void }) {
  const [second, setSecond] = useState(false);

  return (
    <Stack gap="3">
      <SupplierSelect teamId={TEAM} onChange={props.onChange} />
      <Button data-testid="story-mount-second" onClick={() => setSecond(true)}>
        Open Another Form
      </Button>
      {second && <SupplierSelect teamId={TEAM} onChange={props.onChange} />}
    </Stack>
  );
}

// THE LIST IS READ ONCE (#121). Through the query cache (`useSupplierOptions`, referenceQuery), so a picker mounted
// later offers the suppliers the first one read — no second SupplierList. Each mount used to fetch its own.
export const APickerMountedLaterReadsTheCache: Story = {
  name: "A picker mounted later reads the cached list — no second SupplierList",
  beforeEach: () => {
    const spy = spyOn(supplierClient, "supplierList");

    return () => spy.mockRestore();
  },
  render: (args) => <ASecondPickerLater onChange={args.onChange ?? (() => {})} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    await waitFor(() => expect(screen.getByTestId(`supplier-select-option-${suppliers[0]!.id}`)).toBeVisible(), {
      timeout: 5000,
    });
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId("story-mount-second"));
    await waitFor(() => expect(canvas.getAllByRole("combobox")).toHaveLength(2));
    const secondInput = canvas.getAllByRole("combobox")[1]!;
    await userEvent.click(secondInput);
    // The first picker's options stay in the document, hidden, after it closes — so the second one's are found in ITS
    // listbox.
    await waitFor(
      () => {
        const listbox = document.getElementById(secondInput.getAttribute("aria-controls") ?? "");
        expect(listbox).not.toBeNull();
        expect(within(listbox!).getByTestId(`supplier-select-option-${suppliers[0]!.id}`)).toBeVisible();
      },
      { timeout: 5000 },
    );

    await expect(callsOf(supplierClient.supplierList)).toBe(1);
  },
};

// A supplier added on My Supplier (its write invalidates `suppliers`).
function AddThenPick(props: { onChange: (id: bigint) => void }) {
  const save = useSaveSupplier();
  const [added, setAdded] = useState(false);

  return (
    <Stack gap="3">
      <SupplierSelect teamId={TEAM} onChange={props.onChange} />
      <Button
        data-testid="story-add-supplier"
        onClick={async () => {
          await save.mutateAsync({ teamId: TEAM, name: "Sumber Baru", contact: "", address: "", description: "" });
          setAdded(true);
        }}
      >
        Add Supplier Elsewhere
      </Button>
      {added && <Text data-testid="story-supplier-added">added</Text>}
    </Stack>
  );
}

// A SUPPLIER ADDED ON MY SUPPLIER IS OFFERED. The list is cached, but under the team's `suppliers` — the write's
// invalidation re-reads the picker on screen, so the new supplier is pickable without a reload.
export const ASupplierAddedElsewhereIsOffered: Story = {
  name: "A supplier added on My Supplier is offered in the picker",
  render: (args) => <AddThenPick onChange={args.onChange ?? (() => {})} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    await waitFor(() => expect(screen.getByTestId(`supplier-select-option-${suppliers[0]!.id}`)).toBeVisible(), {
      timeout: 5000,
    });
    await expect(screen.queryByRole("option", { name: /Sumber Baru/ })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId("story-add-supplier"));
    await canvas.findByTestId("story-supplier-added", {}, { timeout: 5000 });

    await userEvent.click(canvas.getByRole("combobox"));
    await waitFor(() => expect(screen.getByRole("option", { name: /Sumber Baru/ })).toBeVisible(), { timeout: 5000 });
  },
};
