import type { Meta, StoryObj } from "@storybook/react-vite";

import { asTeam } from "../../../../.storybook/pageStory";
import { ACCOUNT_DETAIL_META, AtKasGudang, AtShopeePay, AtUnknown } from "./kit";

// ACCOUNT DETAIL — below zero, an unknown account, a warehouse's cash box. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/States",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BelowZero: Story = { render: () => <AtShopeePay /> };

export const Unknown: Story = { render: () => <AtUnknown /> };

export const AWarehouseCashBox: Story = {
  name: "Warehouse cash box",
  beforeEach: asTeam(11n),
  render: () => <AtKasGudang />,
};
