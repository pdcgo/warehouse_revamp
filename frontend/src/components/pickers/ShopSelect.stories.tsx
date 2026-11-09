import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../../.storybook/fixtures";
import { closeShopForStory, setShopWriter } from "../../../.storybook/shopStub";
import { ShopSelect, description } from "./ShopSelect";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ShopStatus } from "../../gen/warehouse/selling/v1/selling_pb";

const meta = {
  title: "Components/Pickers/ShopSelect",
  component: ShopSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  // The fixture selling team — its shops come back from the stubbed ShopList.
  args: { teamId: 12n, onChange: fn() },
} satisfies Meta<typeof ShopSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: shops[0]!.id } };

export const Disabled: Story = { args: { value: shops[0]!.id, disabled: true } };

// Each option carries the shop's name AND its marketplace as the standard-coloured MarketplaceBadge
// — two shops with similar names ("Melati Official" / "Melati Store") stay distinguishable, and a
// shop's marketplace reads the same here as in every table.
export const OptionsCarryTheMarketplaceBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    const option = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());

    await expect(option).toHaveTextContent(shops[0]!.name);
    await expect(
      within(option).getByTestId(`marketplace-badge-${shops[0]!.marketplace}`),
    ).toBeInTheDocument();
  },
};

// ⚠ NOT portalled: this Select is used inside RecordExpenseDialog, and a portalled listbox renders
// OUTSIDE the dialog where the modal marks it inert — invisible to the a11y tree and unclickable.
// Finding the option INSIDE the canvas is what proves it stayed inline.
export const ListboxRendersInline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    await expect(await canvas.findByTestId(`shop-select-option-${shops[1]!.id}`)).toBeInTheDocument();
  },
};

export const EmitsTheShopId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${shops[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith(shops[1]!.id);
  },
};

/**
 * OPENED AGAIN AFTER A PICK, EVERY SHOP IS THERE (owner) — the picked name in the field is not a search.
 * It used to filter the list by that name, so the panel reopened with one option.
 */
export const ReopeningAfterAPickShowsEveryShop: Story = {
  render: (args) => {
    const [value, setValue] = useState<bigint>(0n);

    return <ShopSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const teamShops = shops.filter((s) => s.teamId === 12n && s.status === ShopStatus.OPEN);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${teamShops[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue(teamShops[1]!.name));

    await userEvent.click(canvas.getByRole("button", { name: /toggle/i }));
    for (const shop of teamShops) {
      await waitFor(() => expect(canvas.getByTestId(`shop-select-option-${shop.id}`)).toBeVisible());
    }
  },
};

// A team with no shops shows the placeholder rather than an error — a selling team that has not
// connected a storefront yet is a normal state, not a failure.
export const TeamWithNoShops: Story = {
  args: { teamId: 999n },
};

// NARROWED TO ONE STOREFRONT (owner) — the order form names the marketplace first, and the shop list
// below it is cut to that storefront's shops. Melati runs one shop per marketplace, so Shopee leaves
// exactly one option and hides the Tokopedia and Lazada ones.
export const NarrowedToOneMarketplace: Story = {
  args: { marketplace: Marketplace.SHOPEE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    const shopee = shops.find((s) => s.marketplace === Marketplace.SHOPEE)!;
    const tokopedia = shops.find((s) => s.marketplace === Marketplace.TOKOPEDIA)!;

    await expect(await canvas.findByTestId(`shop-select-option-${shopee.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`shop-select-option-${tokopedia.id}`)).not.toBeInTheDocument();
  },
};

// A FILTER THAT EXCLUDES THE CURRENT VALUE CLEARS IT. The trigger goes blank when the option
// disappears, but the id would still be held — so the form would place a Shopee order against a
// Tokopedia storefront with nothing on screen saying so.
export const AShopOutsideTheFilterIsCleared: Story = {
  args: {
    value: shops.find((s) => s.marketplace === Marketplace.TOKOPEDIA)!.id,
    marketplace: Marketplace.SHOPEE,
  },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith(0n));
  },
};

// …and the same guard must NOT fire without a filter. Every other caller (the expense dialog, the
// orders list) passes no marketplace, and a value cleared on them would be a picker that empties
// itself.
export const UnfilteredNeverClearsTheValue: Story = {
  args: { value: shops[0]!.id },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue(shops[0]!.name));
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// A team on no shops for the chosen storefront says WHICH storefront it found none on. "Select a
// shop" over an empty dropdown reads as a broken control.
export const NoShopsOnThatMarketplace: Story = {
  args: { marketplace: Marketplace.BUKALAPAK },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("shop-select")).toHaveAttribute("placeholder", "No Bukalapak shops"),
    );
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0n);

    return <ShopSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${shops[2]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(canvas.getByTestId("shop-select")).toHaveValue(shops[2]!.name);
  },
};

// THE PICKER OF A WRITE offers only the shops this person may write on (a-write-needs-a-grant-or-a-manager). Eko is a
// CS granted Melati Grosir alone: the order form shows him that one, never Melati Official or Melati Store — which the
// server would refuse him anyway.
export const WritableOffersOnlyTheGrantedShops: Story = {
  args: { writable: true },
  beforeEach: () => {
    setShopWriter(65n);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    await expect(await canvas.findByTestId(`shop-select-option-${shops[2]!.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`shop-select-option-${shops[0]!.id}`)).not.toBeInTheDocument();
    await expect(canvas.queryByTestId(`shop-select-option-${shops[1]!.id}`)).not.toBeInTheDocument();
  },
};

// A shop held from before — a draft pushed onto a shop this person may not write on — is CLEARED, not kept invisibly
// until the create is refused.
export const WritableClearsAShopThePersonMayNotWriteOn: Story = {
  args: { writable: true, value: shops[0]!.id },
  beforeEach: () => {
    setShopWriter(65n);
  },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith(0n));
  },
};

// The team's owner or admin writes on every shop, so the writable picker offers them all — the same list as a filter.
export const WritableOffersAManagerEveryShop: Story = {
  args: { writable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    for (const shop of shops.filter((s) => s.teamId === 12n)) {
      await expect(await canvas.findByTestId(`shop-select-option-${shop.id}`)).toBeInTheDocument();
    }
  },
};

// ── Closed shops (a-shop-is-closed-never-deleted, a-closed-shop-refuses-only-new-selling) ──────────────────────────────
// Melati Store (22) is closed in each of these.

/** A CLOSED SHOP IS NEVER OFFERED unless asked — the order form, an account link. */
export const AClosedShopIsNotOfferedByDefault: Story = {
  beforeEach: () => {
    closeShopForStory(22n);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    await waitFor(() => expect(canvas.getByTestId("shop-select-option-21")).toBeVisible());
    await expect(canvas.queryByTestId("shop-select-option-22")).toBeNull();
    await expect(canvas.queryAllByTestId(/^shop-select-closed-/)).toHaveLength(0);
  },
};

/** `withClosed` — the statement import, an expense, the order import: the closed shops AFTER the open ones, badged. */
export const WithClosedOffersTheClosedShopsLastBadged: Story = {
  args: { withClosed: true },
  beforeEach: () => {
    closeShopForStory(22n);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const closed = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(closed).toBeVisible());
    await expect(within(closed).getByTestId("shop-select-closed-22")).toHaveTextContent("Closed");
    await expect(canvas.getAllByTestId(/^shop-select-closed-/)).toHaveLength(1);

    const options = canvas.getAllByRole("option").map((o) => o.getAttribute("data-testid"));
    await expect(options[options.length - 1]).toBe("shop-select-option-22");
  },
};

/**
 * `asFilter` — a read filter (report-filters-offer-closed-shops): every shop, the closed ones LAST and badged; a picked
 * closed shop keeps its badge in the field, and an open pick shows none.
 */
export const AsFilterOffersTheClosedShopsLastAndBadgesAClosedPick: Story = {
  args: { asFilter: true },
  beforeEach: () => {
    closeShopForStory(22n);
  },
  render: (args) => {
    const [value, setValue] = useState<bigint>(0n);

    return (
      <ShopSelect
        {...args}
        value={value}
        onChange={(id) => {
          setValue(id);
          args.onChange?.(id);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // An open pick: no badge in the field.
    await userEvent.click(canvas.getByTestId("shop-select"));
    const open = await canvas.findByTestId("shop-select-option-21");
    await waitFor(() => expect(open).toBeVisible());
    await userEvent.click(open);
    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Official"));
    await expect(canvas.queryByTestId("shop-select-value-closed")).toBeNull();

    await userEvent.click(canvas.getByTestId("shop-select"));
    const closed = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(closed).toBeVisible());
    await expect(within(closed).getByTestId("shop-select-closed-22")).toHaveTextContent("Closed");
    await expect(canvas.getAllByTestId(/^shop-select-closed-/)).toHaveLength(1);
    const options = canvas.getAllByRole("option").map((o) => o.getAttribute("data-testid"));
    await expect(options[options.length - 1]).toBe("shop-select-option-22");

    await userEvent.click(closed);
    await expect(args.onChange).toHaveBeenCalledWith(22n);
    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"));
    await expect(canvas.getByTestId("shop-select-value-closed")).toHaveTextContent("Closed");
  },
};

/** `withClosed` — a write's picker: the closed shop is offered, but a pick shows no badge in the field. */
export const WithClosedShowsNoBadgeInTheField: Story = {
  args: { withClosed: true, value: 22n },
  beforeEach: () => {
    closeShopForStory(22n);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"));
    await expect(canvas.queryByTestId("shop-select-value-closed")).toBeNull();
  },
};

/**
 * `keepClosed` — the order form holding a waiting draft's CLOSED shop (a-close-leaves-the-drafts-waiting): the value is
 * kept, never cleared, and shows badged; no other closed shop is offered.
 */
export const KeepClosedKeepsTheClosedValueBadged: Story = {
  args: { writable: true, keepClosed: true },
  beforeEach: () => {
    closeShopForStory(22n);
    closeShopForStory(23n);
  },
  render: (args) => {
    const [value, setValue] = useState<bigint>(22n);

    return (
      <>
        <ShopSelect
          {...args}
          value={value}
          onChange={(id) => {
            setValue(id);
            args.onChange?.(id);
          }}
        />
        <span data-testid="held">{value.toString()}</span>
      </>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"));
    await expect(canvas.getByTestId("held")).toHaveTextContent("22");
    await expect(args.onChange).not.toHaveBeenCalledWith(0n);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const kept = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(kept).toBeVisible());
    await expect(within(kept).getByTestId("shop-select-closed-22")).toBeVisible();
    // Melati Grosir is closed too — and not offered.
    await expect(canvas.queryByTestId("shop-select-option-23")).toBeNull();
  },
};
