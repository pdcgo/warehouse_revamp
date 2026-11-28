import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { LEDGER_KINDS, MovementKindSelect, description } from "./MovementKindSelect";

// THE LEDGER'S KEGIATAN FILTER (riwayat-filters-by-one-kind) — every kind, or one: StockHistory's filter takes one kind at
// a time, so this is a single choice, never a set of checkboxes the read cannot answer. A search select whose options are
// the kinds' badges, with an × back to every kind (owner: *"selectnya pakai badge seperti sebelumnya, ada search juga,
// lalu ada closeable"*).

function Controlled({ onChange, sheetOnPhone }: { onChange: (kind: MovementKind) => void; sheetOnPhone?: boolean }) {
  const [kind, setKind] = useState<MovementKind>(MovementKind.UNSPECIFIED);

  return (
    <Box w={sheetOnPhone ? "full" : "14rem"}>
      <MovementKindSelect
        value={kind}
        sheetOnPhone={sheetOnPhone}
        onChange={(next) => {
          setKind(next);
          onChange(next);
        }}
      />
      <Text mt="2" data-testid="picked">
        {String(kind)}
      </Text>
    </Box>
  );
}

const meta = {
  title: "Features/Inventory/MovementKindSelect",
  component: MovementKindSelect,
  parameters: { docs: { description: { component: description } } },
  args: { value: MovementKind.UNSPECIFIED, onChange: fn() },
  render: (args) => <Controlled onChange={args.onChange} sheetOnPhone={args.sheetOnPhone} />,
} satisfies Meta<typeof MovementKindSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

async function open(input: HTMLElement) {
  await userEvent.click(input);
  const first = await screen.findByTestId(`movement-kind-select-${LEDGER_KINDS[0]}`);
  await waitFor(() => expect(first).toBeVisible());
}

// Empty, it reads *All activities* — no such option to pick. Open, every kind, each as its BADGE in the ledger's colour.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByTestId("movement-kind-select");
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("placeholder", "All activities");
    // Named as the ledger's column it narrows (*Kegiatan* / *What*).
    await expect(input).toHaveAccessibleName("What");

    await open(input);
    for (const kind of LEDGER_KINDS) {
      await expect(screen.getByTestId(`movement-kind-select-${kind}`)).toBeInTheDocument();
    }
    await expect(screen.queryByTestId(`movement-kind-select-${MovementKind.UNSPECIFIED}`)).toBeNull();
    const moved = within(screen.getByTestId(`movement-kind-select-${MovementKind.MOVE}`)).getByText("Moved");
    await expect(moved.className).toMatch(/badge/);
  },
};

// Typing narrows the kinds by their words.
export const Searches: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByTestId("movement-kind-select");
    await open(input);
    await userEvent.type(input, "trans", { delay: 30 });

    await waitFor(() => expect(screen.queryByTestId(`movement-kind-select-${MovementKind.RECEIVE}`)).toBeNull());
    await expect(screen.getByTestId(`movement-kind-select-${MovementKind.TRANSFER_IN}`)).toBeVisible();
    await expect(screen.getByTestId(`movement-kind-select-${MovementKind.TRANSFER_OUT}`)).toBeVisible();
  },
};

// One kind picked, then its × — back to every kind, emitted as UNSPECIFIED.
export const PicksOneKindAndClears: Story = {
  name: "Picks one kind and clears",
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("movement-kind-select");

    await open(input);
    await userEvent.click(screen.getByTestId(`movement-kind-select-${MovementKind.MOVE}`));
    await waitFor(() => expect(input).toHaveValue("Moved"));
    await expect(args.onChange).toHaveBeenLastCalledWith(MovementKind.MOVE);

    await userEvent.click(canvas.getByTestId("movement-kind-select-clear"));
    await waitFor(() => expect(input).toHaveValue(""));
    await expect(args.onChange).toHaveBeenLastCalledWith(MovementKind.UNSPECIFIED);
    await expect(canvas.getByTestId("picked")).toHaveTextContent(String(MovementKind.UNSPECIFIED));
  },
};

// ON A PHONE, A DRAWER FROM THE BOTTOM (sheetOnPhone, a-phone-filter-opens-from-the-bottom) — the control is the picked
// kind's badge; a tap opens the search and the kinds as rows a thumb can hit; a tap on one picks it and closes the drawer;
// the control's × goes back to every kind.
export const OnAPhoneASheetFromTheBottom: Story = {
  name: "On a phone, a sheet from the bottom",
  globals: { viewport: { value: "mobile1" } },
  args: { sheetOnPhone: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId("movement-kind-select");
    await expect(trigger).toHaveTextContent("All activities");

    await userEvent.click(trigger);
    const sheet = await screen.findByTestId("movement-kind-select-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(window.innerHeight);
    // It opens on its close button, never the search — a focused field throws a phone's keyboard up over the list.
    await waitFor(() => expect(screen.getByTestId("movement-kind-select-close")).toHaveFocus());
    await expect(screen.getByTestId("movement-kind-select-search")).not.toHaveFocus();
    // Each kind a row a thumb can hit — 44px — its words a step over a ledger's badge, 14px, to be read on a phone.
    await expect(Math.round(screen.getByTestId(`movement-kind-select-${MovementKind.RECEIVE}`).getBoundingClientRect().height)).toBe(44);
    await expect(getComputedStyle(screen.getByTestId(`movement-kind-select-${MovementKind.RECEIVE}-badge`)).fontSize).toBe("14px");

    await userEvent.type(screen.getByTestId("movement-kind-select-search"), "trans", { delay: 30 });
    await waitFor(() => expect(screen.queryByTestId(`movement-kind-select-${MovementKind.RECEIVE}`)).toBeNull());
    await userEvent.click(screen.getByTestId(`movement-kind-select-${MovementKind.TRANSFER_IN}`));

    await expect(args.onChange).toHaveBeenLastCalledWith(MovementKind.TRANSFER_IN);
    await waitFor(() => expect(screen.queryByTestId("movement-kind-select-sheet")).toBeNull());
    await expect(canvas.getByTestId("movement-kind-select-picked")).toHaveTextContent("Transferred in");

    await userEvent.click(canvas.getByTestId("movement-kind-select-clear"));
    await expect(args.onChange).toHaveBeenLastCalledWith(MovementKind.UNSPECIFIED);
    await waitFor(() => expect(trigger).toHaveTextContent("All activities"));
  },
};
