import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { SettingsPage } from "../index";

// SETTINGS — THE TEAM PICTURE SPEAKS THE PAGE'S LANGUAGE (backlog #155): its button and the line under it were written in
// English on every language; they are i18n keys now (`account.teamPicture*`, beside the profile picture's
// `account.pictureHint`), with Indonesian in the register of the Settings page around them. Toko Anggrek (15).

const ANGGREK = 15n;

const meta = {
  title: "Pages/Settings/SettingsPage/TeamPicture",
  component: SettingsPage,
  parameters: { signedIn: true },
  beforeEach: () => {
    asTeam(ANGGREK)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function picture(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("change-team-picture")).toBeVisible(), { timeout: 5000 });
  return canvas;
}

/** IN INDONESIAN — *Ubah foto* and the hint under it, the Owner may change it. */
export const InIndonesian: Story = {
  name: "Indonesian",
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = await picture(canvasElement);

    await expect(canvas.getByTestId("change-team-picture")).toHaveTextContent("Ubah foto");
    await expect(canvas.getByTestId("change-team-picture")).toBeEnabled();
    await expect(canvas.getByTestId("team-picture-hint")).toHaveTextContent("JPG atau PNG, ditampilkan di seluruh aplikasi.");
    await expect(canvasElement).not.toHaveTextContent("Change picture");
  },
};

/** IN INDONESIAN, CS — the line says only the Owner or the Admin may change it, and the button is off. */
export const CustomerServiceInIndonesian: Story = {
  name: "Indonesian, CS",
  globals: { locale: "id" },
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await picture(canvasElement);

    await expect(canvas.getByTestId("change-team-picture")).toBeDisabled();
    await expect(canvas.getByTestId("team-picture-hint")).toHaveTextContent(
      "Hanya pemilik tim atau admin yang dapat mengubah foto tim.",
    );
  },
};

/** IN ENGLISH — the words as they were. */
export const InEnglish: Story = {
  name: "English",
  play: async ({ canvasElement }) => {
    const canvas = await picture(canvasElement);

    await expect(canvas.getByTestId("change-team-picture")).toHaveTextContent("Change picture");
    await expect(canvas.getByTestId("team-picture-hint")).toHaveTextContent("JPG or PNG, shown across the app.");
  },
};
