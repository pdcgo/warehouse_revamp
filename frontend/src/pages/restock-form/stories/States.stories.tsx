import type { Meta, StoryObj } from "@storybook/react-vite";

import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { EditAccepted, EditArrived, EditOngoing, FORM_META } from "./kit";

// RESTOCK FORM — the form as each person and each status opens it.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/States",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateAsCustomerService: Story = {
  name: "As customer service",
  beforeEach: () => {
    asRole(Role.SELLING_CS)();
  },
};

export const EditWhileOngoing: Story = { render: () => <EditOngoing /> };

export const EditWhileArrived: Story = { render: () => <EditArrived /> };

export const NotEditableOnceAccepted: Story = { render: () => <EditAccepted /> };
