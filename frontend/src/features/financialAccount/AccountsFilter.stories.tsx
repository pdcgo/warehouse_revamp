import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AccountsFilter } from "./AccountsFilter";

// The Finance metrics' Account filter (finance-filters-by-account): one account or several of the team's own, archived
// and Lainnya included — a report reads the past. Fixtures: Toko Melati (12) holds BCA Operasional, BCA Gaji, ShopeePay
// Melati, an unknown account, BNI Lama (archived), Kas Melati and Mandiri Usaha; Gudang Pusat (11) Kas Gudang and BCA
// Gudang.

// Controlled for real — a value pinned to a constant would snap back after every pick.
function Controlled({ teamId, initial = [] }: { teamId: bigint; initial?: string[] }) {
  const [value, setValue] = useState<string[]>(initial);

  return (
    <div style={{ width: "16rem" }}>
      <AccountsFilter teamId={teamId} value={value} onChange={setValue} />
      <p data-testid="picked">{value.join(",")}</p>
    </div>
  );
}

const meta = {
  title: "Features/FinancialAccount/AccountsFilter",
  component: Controlled,
  args: { teamId: 12n },
  parameters: { signedIn: true },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked is every account; two ticked in one opening — the panel stays open — and the field says how many. */
export const PicksSeveral: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("accounts-filter-input");
    await waitFor(() => expect(input).toHaveAttribute("placeholder", "All accounts"));

    await userEvent.click(input);
    await userEvent.click(await within(document.body).findByTestId("accounts-filter-option-1301"));
    await userEvent.click(within(document.body).getByTestId("accounts-filter-option-1303"));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("1301,1303"));
    await expect(input).toHaveAttribute("placeholder", "2 accounts");

    // The archived account is offered too — its past happened.
    await expect(within(document.body).getByTestId("accounts-filter-option-1305")).toHaveTextContent("BNI Lama");
  },
};

/** One picked reads its name; clearing reads every account again. */
export const OneThenCleared: Story = {
  args: { initial: ["1309"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("accounts-filter-input");
    await waitFor(() => expect(input).toHaveAttribute("placeholder", "Kas Melati"));

    await userEvent.click(canvas.getByTestId("accounts-filter-clear"));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(""));
    await expect(input).toHaveAttribute("placeholder", "All accounts");
  },
};

/** A warehouse filters by its own accounts (every-team-reads-its-own-finance). */
export const AWarehousesOwnAccounts: Story = {
  args: { teamId: 11n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("accounts-filter-input"));

    const kas = await within(document.body).findByTestId("accounts-filter-option-1306");
    await expect(kas).toHaveTextContent("Kas Gudang");
    await expect(within(document.body).queryByTestId("accounts-filter-option-1301")).toBeNull();
  },
};
