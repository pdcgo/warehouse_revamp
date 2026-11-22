import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { shipmentChannels } from "../../../.storybook/fixtures";
import { DESKTOP, PHONE, TAG_VIEWPORTS } from "../../../.storybook/restockTagKit";
import { channelTrackingUrls, trackingLinkScenario, trackingLinksForStory } from "../../../.storybook/trackingLinkStub";
import { ShipmentChannelsPage } from "./index";

// THE CHANNELS SCREEN — EACH COURIER'S TRACKING LINK (the-tracking-link-prototype-is-accepted,
// a-tracking-link-must-carry-the-resi). Root keeps ONE link per channel (a-channel-is-a-courier, only-root-manages-channels
// — this screen is root's already), the courier's tracking page with `{resi}` where the number goes, sent as
// `tracking_url` by Create and Update. OPTIONAL — a courier with none leaves its orders' resi copy-only. The form refuses
// a link that is not https, holds no `{resi}` or is no address once the field is left, and Save stays off until it is
// fixed. The table has a *Tracking link* column after Description.
//
// Against the real stub: the couriers start each story with the links of `.storybook/trackingLinkStub.ts` (JNE, J&T, the
// deleted POS; SiCepat none), and `trackingLinkScenario.saved` is what a Create / Update SENT.

const meta = {
  title: "Pages/Shipment/ShipmentChannels/Tracking link",
  component: ShipmentChannelsPage,
  parameters: { viewport: { options: TAG_VIEWPORTS } },
  globals: DESKTOP,
  beforeEach: () => trackingLinksForStory(),
} satisfies Meta<typeof ShipmentChannelsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const [jne, , sicepat] = shipmentChannels;
const JNE_LINK = channelTrackingUrls.find((c) => c.code === "jne")!.trackingUrl;

/** user-event reads `{` and `[` as key names — doubled, they are typed as themselves. */
const literally = (text: string) => text.replace(/[{[]/g, (c) => c + c);

/** Opens the edit dialog of a channel and answers its tracking-link field. */
async function editLinkOf(canvasElement: HTMLElement, code: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId(`edit-${code}`, {}, { timeout: 4000 }));
  const field = await screen.findByTestId("shipment-channel-tracking-url");
  await waitFor(() => expect(field).toBeVisible());
  return field;
}

/** Types a link into the field and leaves it, as a person does before reading what it says. */
async function typeLink(field: HTMLElement, link: string) {
  await userEvent.clear(field);
  if (link !== "") await userEvent.type(field, literally(link), { delay: 15 });
  await userEvent.tab();
}

/** THE COLUMN — each courier's link after Description; SiCepat has none and reads `—`. */
export const TheLinksColumn: Story = {
  name: "The Tracking link column",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByTestId(`shipment-channel-tracking-${jne!.code}`, {}, { timeout: 4000 });

    await expect(cell).toHaveTextContent(JNE_LINK);
    await expect(canvas.getByTestId(`shipment-channel-tracking-${sicepat!.code}`)).toHaveTextContent("—");
    const headers = [...canvasElement.querySelectorAll("thead th")].map((th) => th.textContent);
    await expect(headers).toEqual(["Code", "Name", "Description", "Tracking link", "Status", "Updated", "Actions"]);
  },
};

/** NO COURIER HAS A LINK YET — what the migration leaves (no backfill): the column is there, every row reads `—`. */
export const NoLinksYet: Story = {
  name: "No courier has a link yet — every row reads —",
  beforeEach: () => trackingLinksForStory({}),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId(`shipment-channel-row-${jne!.code}`, {}, { timeout: 4000 });

    const cells = canvas.getAllByTestId(/^shipment-channel-tracking-/);
    await expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) await expect(cell).toHaveTextContent("—");
  },
};

/** EDIT OPENS WITH THE LINK — JNE's link in the field, and the hint saying where `{resi}` goes. Read-only (the picture). */
export const EditShowsTheLink: Story = {
  name: "Edit — the link in its field, with the {resi} hint",
  play: async ({ canvasElement }) => {
    const field = await editLinkOf(canvasElement, jne!.code);

    await expect(field).toHaveValue(JNE_LINK);
    await expect(screen.getByTestId("shipment-channel-tracking-url-help")).toHaveTextContent("{resi}");
    await expect(screen.getByTestId("shipment-channel-save")).toBeEnabled();
  },
};

/** NOT HTTPS — refused: the field says so, Save stays off, nothing is sent. */
export const RefusesALinkThatIsNotHttps: Story = {
  name: "Refuses a link that is not https",
  play: async ({ canvasElement }) => {
    const field = await editLinkOf(canvasElement, sicepat!.code);
    await typeLink(field, "http://www.sicepat.com/checkAwb?awb={resi}");

    const error = await screen.findByTestId("shipment-channel-tracking-url-error");
    await expect(error).toHaveAttribute("data-problem", "notHttps");
    await expect(error).toHaveTextContent("https://");
    await expect(screen.getByTestId("shipment-channel-save")).toBeDisabled();
    await expect(trackingLinkScenario.saved).toEqual([]);
  },
};

/** NO {resi} — refused (a-tracking-link-must-carry-the-resi): it would open the courier's page without the parcel. */
export const RefusesALinkWithoutResi: Story = {
  name: "Refuses a link without {resi}",
  play: async ({ canvasElement }) => {
    const field = await editLinkOf(canvasElement, sicepat!.code);
    await typeLink(field, "https://www.sicepat.com/checkAwb");

    const error = await screen.findByTestId("shipment-channel-tracking-url-error");
    await expect(error).toHaveAttribute("data-problem", "noResi");
    await expect(error).toHaveTextContent("{resi}");
    await expect(screen.getByTestId("shipment-channel-save")).toBeDisabled();
    await expect(trackingLinkScenario.saved).toEqual([]);
  },
};

/** NO ADDRESS — refused: a space where the host goes. Fixing it turns Save back on. */
export const RefusesTextThatIsNoAddress: Story = {
  name: "Refuses text that is no address — fixed, Save is back",
  play: async ({ canvasElement }) => {
    const field = await editLinkOf(canvasElement, sicepat!.code);
    await typeLink(field, "https:// www.sicepat.com/{resi}");

    const error = await screen.findByTestId("shipment-channel-tracking-url-error");
    await expect(error).toHaveAttribute("data-problem", "notAUrl");
    await expect(screen.getByTestId("shipment-channel-save")).toBeDisabled();

    await typeLink(field, "https://www.sicepat.com/{resi}");
    await waitFor(() => expect(screen.queryByTestId("shipment-channel-tracking-url-error")).toBeNull());
    await expect(screen.getByTestId("shipment-channel-save")).toBeEnabled();
  },
};

/** A GOOD LINK SAVES — on SiCepat, which had none: Update sends it, and the column shows it. */
export const SavesALink: Story = {
  name: "Saves a link — the column shows it",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = "https://www.sicepat.com/checkAwb?awb={resi}";
    const field = await editLinkOf(canvasElement, sicepat!.code);
    await typeLink(field, link);

    await expect(screen.queryByTestId("shipment-channel-tracking-url-error")).toBeNull();
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    await waitFor(() => expect(canvas.getByTestId(`shipment-channel-tracking-${sicepat!.code}`)).toHaveTextContent(link));
    await expect(trackingLinkScenario.saved).toEqual([{ channelId: sicepat!.id, trackingUrl: link }]);
  },
};

/** CLEARING A LINK — an emptied field saves: Update sends "", and the row reads `—` (its orders' resi copy-only). */
export const ClearsALink: Story = {
  name: "Clears a link — the row reads —",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await editLinkOf(canvasElement, jne!.code);
    await typeLink(field, "");

    await expect(screen.getByTestId("shipment-channel-save")).toBeEnabled();
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    await waitFor(() => expect(canvas.getByTestId(`shipment-channel-tracking-${jne!.code}`)).toHaveTextContent("—"));
    await expect(trackingLinkScenario.saved).toEqual([{ channelId: jne!.id, trackingUrl: "" }]);
  },
};

/** A NEW CHANNEL WITH ITS LINK — Create sends it too; the new row shows it. */
export const ANewChannelWithALink: Story = {
  name: "A new channel with its link",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = "https://anteraja.id/tracking/{resi}";

    await userEvent.click(await canvas.findByTestId("open-create-shipment-channel", {}, { timeout: 4000 }));
    const code = await screen.findByTestId("shipment-channel-code");
    await waitFor(() => expect(code).toBeVisible());
    await userEvent.type(code, "anteraja", { delay: 30 });
    await userEvent.type(screen.getByTestId("shipment-channel-name"), "AnterAja", { delay: 30 });
    await typeLink(screen.getByTestId("shipment-channel-tracking-url"), link);
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    await waitFor(() => expect(canvas.getByTestId("shipment-channel-tracking-anteraja")).toHaveTextContent(link));
    await expect(trackingLinkScenario.saved.map((s) => s.trackingUrl)).toEqual([link]);
  },
};

/** NO LINK IS FINE — the field is optional: a channel saves without one, and reads `—`. */
export const ALinkIsOptional: Story = {
  name: "A link is optional",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("open-create-shipment-channel", {}, { timeout: 4000 }));
    const code = await screen.findByTestId("shipment-channel-code");
    await waitFor(() => expect(code).toBeVisible());
    await userEvent.type(code, "gosend", { delay: 30 });
    await userEvent.type(screen.getByTestId("shipment-channel-name"), "GoSend", { delay: 30 });
    await expect(screen.getByTestId("shipment-channel-save")).toBeEnabled();
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    await waitFor(() => expect(canvas.getByTestId("shipment-channel-tracking-gosend")).toHaveTextContent("—"));
    await expect(trackingLinkScenario.saved.map((s) => s.trackingUrl)).toEqual([""]);
  },
};

/** THE FORM ON A PHONE (390) — root's screen, at the size it may be opened at. Read-only (the picture). */
export const EditOnAPhone: Story = {
  name: "Edit — phone",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const field = await editLinkOf(canvasElement, jne!.code);
    await expect(field).toHaveValue(JNE_LINK);
  },
};
