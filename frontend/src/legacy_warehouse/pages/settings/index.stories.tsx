import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { WAREHOUSE } from "../../fixtures";
import { SettingsPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Settings",
  component: SettingsPage,
  parameters: { docs: { description: { component: description } } },
  args: {
    name: "Ani Rahmawati",
    email: "ani@example.test",
    warehouseName: WAREHOUSE.name,
    address: WAREHOUSE.address,
    phone: WAREHOUSE.phone,
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("profile-form")).toBeVisible();
    await expect(canvas.getByTestId("warehouse-form")).toBeVisible();
  },
};

// ⚠ THE ADDRESS IS PRINTED ON EVERY RETURN LABEL. A typo sends returns to the wrong building and the
// failure surfaces weeks later, so the field carries the consequence rather than being a bare input.
export const TheAddressCarriesItsConsequence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("address-warning")).toHaveTextContent("every return label");
  },
};

// On a shared tablet the name is not vanity — it is what appears against every movement recorded
// during your shift.
export const TheNameIsAttribution: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("profile-form")).toHaveTextContent("Shown against everything you record");
  },
};

// ⚠ THE BANK FORM IS DELIBERATELY NOT PORTED, and the screen says so rather than leaving a reader to
// wonder whether it was missed. This repository is public, and payment details on a shared floor
// tablet is a decision for the owner, not one to inherit by copying.
export const TheOmissionIsStated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("not-ported-note")).toHaveTextContent("not ported");
    await expect(canvas.queryByLabelText(/account number/i)).toBeNull();
  },
};

// Two forms, two save buttons. Saving the warehouse address and saving your own name are unrelated
// acts — one submit for both means a typo in one blocks the other.
export const EachFormSavesSeparately: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("save-profile")).toBeVisible();
    await expect(canvas.getByTestId("save-warehouse")).toBeVisible();
  },
};

export const Saving: Story = { args: { saving: true } };

export const Blank: Story = {
  args: { name: undefined, email: undefined, warehouseName: undefined, address: undefined, phone: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("field-name")).toHaveValue("");
  },
};
