import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orderDrafts } from "../../../../.storybook/fixtures";
import { asTeam } from "../../../../.storybook/pageStory";
import { seedReturnMap } from "../../../../.storybook/returnConfigurationStub";
import { OrderCreatePage } from "../index";

// NO ORDER WITHOUT A COURIER (no-order-without-a-courier) — LIVE since the owner accepted its look
// (the-courier-required-look-is-accepted). The server refuses an order naming no shipment channel, on both doors; the
// FORM says so first: the courier field marked required (the red `*`), a line under it while none is picked, and Create
// held until one is.
//
//   | TheCourierIsMarkedRequired           | a new order: `*` on the courier, the line under it                  |
//   | ADraftsCourierIsSeededAndCreateIsOn  | draft 202 arrives with SiCepat: no line; mapped, Create on           |
//   | ClearingTheCourierHoldsCreate        | clear it: the line comes back, Create off; pick JNE: on again        |
//   | ADraftWithNoCourierWaitsForOne       | the app could not convert the courier: Create off until one is picked |

function routesFor() {
  return [
    { path: "/order-create", element: <OrderCreatePage /> },
    { path: "/orders", element: <Text data-testid="at-orders">Orders</Text> },
    { path: "/orders/:orderId", element: <Text data-testid="at-order-detail">Order detail</Text> },
    { path: "/order-drafts", element: <Text data-testid="at-drafts">Drafts</Text> },
  ];
}

function Routed({ entry }: { entry: string }) {
  const router = useMemo(() => createMemoryRouter(routesFor(), { initialEntries: [entry] }), [entry]);

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Order/OrderCreate/Courier",
  component: OrderCreatePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  render: () => <Routed entry="/order-create" />,
} satisfies Meta<typeof OrderCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Draft 202 — MEL-9002, Melati Store, placeable as it stands once Toko Melati has the return maps for Gudang Pusat's two
// products; its courier is SiCepat (93).
const DRAFT_202 = orderDrafts.find((d) => d.id === 202n)!;

function asMelatiWithMaps() {
  asTeam(12n)();
  seedReturnMap(12n, 71n, 74n);
  seedReturnMap(12n, 72n, 74n);
}

// The app could not convert the platform's courier: the draft arrives with none (the-app-converts-the-courier-to-a-channel-id).
function draft202WithoutACourier() {
  const was = DRAFT_202.shipmentChannelId;
  DRAFT_202.shipmentChannelId = 0n;

  return () => {
    DRAFT_202.shipmentChannelId = was;
  };
}

async function draftSeeded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), { timeout: 4000 });

  return canvas;
}

// A draft stores no mapping (a-draft-stores-no-mapping): the person picks our product — Toko Melati's own Beras (74).
async function mapTheLines(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-add-line"));
  const option = await screen.findByTestId("product-picker-option-74");
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
  await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
}

async function courierInput(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByTestId("shipment-channel-select")).getByRole("combobox");
}

export const TheCourierIsMarkedRequired: Story = {
  name: "Marked required",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByTestId("order-create-courier-field");

    await waitFor(() => expect(canvas.getByTestId("order-create-courier-required")).toBeVisible());
    await expect(canvas.getByTestId("order-create-courier-required")).toHaveTextContent("Pick the courier");
    await expect(within(field).getByText("*")).toBeVisible();
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

export const ADraftsCourierIsSeededAndCreateIsOn: Story = {
  name: "Draft's courier seeded",
  render: () => <Routed entry="/order-create?draft=202" />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = await draftSeeded(canvasElement);

    await waitFor(async () => expect(await courierInput(canvasElement)).toHaveValue("SiCepat"), { timeout: 4000 });
    await expect(canvas.queryByTestId("order-create-courier-required")).toBeNull();
    await mapTheLines(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("order-create-save")).toBeEnabled(), { timeout: 4000 });
  },
};

export const ClearingTheCourierHoldsCreate: Story = {
  name: "Cleared holds Create",
  render: () => <Routed entry="/order-create?draft=202" />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = await draftSeeded(canvasElement);
    await mapTheLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });

    const select = canvas.getByTestId("shipment-channel-select");
    await userEvent.click(within(select).getByRole("button", { name: /clear/i }));

    await waitFor(() => expect(canvas.getByTestId("order-create-courier-required")).toBeVisible());
    await expect(create).toBeDisabled();

    await userEvent.click(await courierInput(canvasElement));
    const jne = await screen.findByTestId("shipment-channel-option-jne");
    await waitFor(() => expect(jne).toBeVisible());
    await userEvent.click(jne);

    await waitFor(() => expect(canvas.queryByTestId("order-create-courier-required")).toBeNull());
    await waitFor(() => expect(create).toBeEnabled());
  },
};

export const ADraftWithNoCourierWaitsForOne: Story = {
  name: "Draft with no courier",
  render: () => <Routed entry="/order-create?draft=202" />,
  beforeEach: [asMelatiWithMaps, draft202WithoutACourier],
  play: async ({ canvasElement }) => {
    const canvas = await draftSeeded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-courier-required")).toBeVisible());
    await expect(await courierInput(canvasElement)).toHaveValue("");
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};
