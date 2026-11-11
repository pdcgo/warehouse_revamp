import type { Meta, StoryObj } from "@storybook/react-vite";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ACCOUNTS_META } from "./kit";

// ACCOUNTS — the screen as a warehouse sees it. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/States",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsAWarehouse: Story = {
  name: "As a warehouse",
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
};
