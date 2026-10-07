import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { account } from "../../../.storybook/financialAccountFixtures";
import { FinancialAccountSelect, description, type FinancialAccountSelectProps } from "./FinancialAccountSelect";

// docs/business/financial_account — accepted at design_accept (the-prototype-and-its-contract-are-accepted). The picker a restock's and an
// expense's *Paid from* will use, and the Transfer and Which Account Is This? dialogs use now.
//
// Fixtures: Toko Melati (12) has BCA Operasional and ShopeePay Melati marked operational, BCA Gaji not,
// an unknown account for Melati TikTok, and an archived BNI Lama. Gudang Pusat (11) has ONE operational
// account, Kas Gudang. Gudang Cabang (14) has none at all.

const BCA_OPS = account("BCA Operasional");
const BCA_GAJI = account("BCA Gaji");
const SHOPEEPAY = account("ShopeePay Melati");
const UNKNOWN = account("Unknown — shop #25");
const BNI = account("BNI Lama");
const KAS = account("Kas Gudang");

// Controlled for real — a value pinned to a constant would snap back after every pick.
function Controlled(props: Omit<FinancialAccountSelectProps, "value" | "onChange">) {
  const [value, setValue] = useState(0n);

  return (
    <div>
      <FinancialAccountSelect {...props} value={value} onChange={setValue} />
      <p data-testid="picked">{value.toString()}</p>
    </div>
  );
}

const meta = {
  title: "Components/Pickers/FinancialAccountSelect",
  component: Controlled,
  parameters: { docs: { description: { component: description } } },
  args: { teamId: 12n },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

async function open(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const trigger = await canvas.findByTestId("financial-account-select");
  await waitFor(() => expect(trigger).not.toBeDisabled());
  await userEvent.click(trigger);

  return canvas;
}

const option = (canvas: ReturnType<typeof within>, id: bigint) =>
  canvas.queryByTestId(`financial-account-select-option-${id}`);

export const Default: Story = {};

// Active, real accounts only: an archived account is out of every picker, and an unknown one is nobody's
// Paid from and no transfer's destination (a-shop-with-no-account-gets-an-unknown-one).
export const OffersActiveRealAccountsOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await waitFor(() => expect(option(canvas, BCA_OPS.id)).toBeVisible());
    await expect(option(canvas, BCA_GAJI.id)).toBeVisible();
    await expect(option(canvas, SHOPEEPAY.id)).toBeVisible();
    await expect(option(canvas, UNKNOWN.id)).toBeNull();
    await expect(option(canvas, BNI.id)).toBeNull();
  },
};

// A person picking the account that paid is recording a fact — no balance beside any option.
export const ShowsNoBalance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    const first = await waitFor(() => {
      const el = option(canvas, BCA_OPS.id);
      expect(el).toBeVisible();
      return el!;
    });
    await expect(first).toHaveTextContent("•••7890");
    await expect(first).not.toHaveTextContent("Rp");
  },
};

// operational-accounts-pay-for-operations: a restock's Paid from offers the operational ones only.
export const OperationalOnly: Story = {
  args: { operationalOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await waitFor(() => expect(option(canvas, BCA_OPS.id)).toBeVisible());
    await expect(option(canvas, SHOPEEPAY.id)).toBeVisible();
    await expect(option(canvas, BCA_GAJI.id)).toBeNull();
  },
};

// The restock form's pre-fill: ONE operational account is the answer, so it is picked for you.
export const PrePicksTheOnlyOption: Story = {
  args: { teamId: 11n, operationalOnly: true, autoPickSingle: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(KAS.id.toString()));
    await expect(canvas.getByTestId("financial-account-select")).toHaveTextContent(KAS.name);
  },
};

// No operational account: the field says why it is empty, and whose fix it is (my spec — marking one is
// admin and up).
export const NoOperationalAccountSaysWhatToDo: Story = {
  args: { teamId: 14n, operationalOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("financial-account-select")).toHaveTextContent("ask an admin to mark one"),
    );
  },
};

// A transfer's To leaves out its From.
export const ExcludesTheFromAccount: Story = {
  args: { excludeIds: [BCA_OPS.id] },
  play: async ({ canvasElement }) => {
    const canvas = await open(canvasElement);

    await waitFor(() => expect(option(canvas, BCA_GAJI.id)).toBeVisible());
    await expect(option(canvas, BCA_OPS.id)).toBeNull();
  },
};
