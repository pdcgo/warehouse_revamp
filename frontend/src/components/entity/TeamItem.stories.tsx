import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamItem, description } from "./TeamItem";

const meta = {
  title: "Components/Entity/TeamItem",
  component: TeamItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    team: { teamName: "Gudang Pusat", teamType: TeamType.WAREHOUSE, teamId: 11n },
  },
} satisfies Meta<typeof TeamItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Warehouse: Story = {};

export const Selling: Story = {
  args: { team: { teamName: "Toko Melati", teamType: TeamType.SELLING, teamId: 12n } },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Switch</Button> },
};

// The type badge is colour-coded per team type, and the four are only comparable side by side.
export const EveryTeamType: Story = {
  render: () => (
    <Stack gap="3" w="72">
      {[TeamType.ROOT, TeamType.ADMIN, TeamType.WAREHOUSE, TeamType.SELLING].map((type) => (
        <TeamItem key={type} team={{ teamName: `Team ${type}`, teamType: type, teamId: BigInt(type) }} />
      ))}
    </Stack>
  ),
};

// THE SMALL ONE — a small avatar and the name alone, no type badge: for a dense list of facts (Terima's Restok card).
export const Small: Story = {
  args: { size: "xs", team: { teamName: "Toko Melati", teamType: TeamType.SELLING, teamId: 12n } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Toko Melati")).toBeInTheDocument();
    await expect(canvas.queryByText("Selling")).toBeNull();
    await expect(canvasElement.querySelector(".chakra-avatar__root")!.getBoundingClientRect().height).toBeLessThanOrEqual(24);
  },
};

// AT A PRODUCT'S SIZE (the-owner-weighs-the-same-as-its-product) — beside a `ProductListItem` in one card, the team's
// avatar and name are the product's own (`lg`: 64px and 18px; `md`: 40px), a caption under the name where the product has
// its code, and no type badge.
export const AtAProductsSize: Story = {
  name: "At a product's size",
  render: () => (
    <Stack gap="4">
      <TeamItem size="lg" caption="Owner" team={{ teamName: "Toko Melati", teamType: TeamType.SELLING, teamId: 12n }} />
      <TeamItem size="md" caption="Owner" team={{ teamName: "Toko Kenanga", teamType: TeamType.SELLING, teamId: 13n }} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [large, medium] = [...canvasElement.querySelectorAll<HTMLElement>(".chakra-avatar__root")];

    await expect(Math.round(large!.getBoundingClientRect().height)).toBe(64);
    await expect(Math.round(medium!.getBoundingClientRect().height)).toBe(40);
    await expect(canvas.getAllByText("Owner")).toHaveLength(2);
    await expect(canvas.queryByText("Selling")).toBeNull();
  },
};

// ITS PICTURE OPENS (a-small-picture-opens-its-preview) — with `onImageClick`, a team's picture is a real button, named
// for the team; a team with initials only has nothing to open, and stays a plain avatar.
export const ItsPictureOpens: Story = {
  name: "Its picture opens",
  args: { onImageClick: fn() },
  render: (args) => (
    <Stack gap="4">
      <TeamItem
        size="lg"
        caption="Owner"
        onImageClick={args.onImageClick}
        team={{
          teamName: "Toko Melati",
          teamType: TeamType.SELLING,
          teamId: 12n,
          imageUrl:
            "data:image/svg+xml;utf8," +
            encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f43f5e"/></svg>'),
        }}
      />
      <TeamItem size="lg" caption="Owner" onImageClick={args.onImageClick} team={{ teamName: "Toko Kenanga", teamType: TeamType.SELLING, teamId: 13n }} />
    </Stack>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const picture = canvas.getByTestId("team-item-image-12");
    await expect(picture).toHaveAccessibleName("View the picture of Toko Melati");
    await userEvent.click(picture);
    await expect(args.onImageClick).toHaveBeenCalledTimes(1);
    await expect(canvas.queryByTestId("team-item-image-13")).toBeNull();
  },
};

// `imageUrl` is only present on shapes that carry it — a Team has one, a TeamAccessItem does not.
// The component takes a structural type rather than a concrete message for exactly that reason, so
// the initials fallback is a supported case, not a degraded one.
export const FallsBackToInitials: Story = {
  args: { team: { teamName: "Toko Kenanga", teamType: TeamType.SELLING, teamId: 13n } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Toko Kenanga")).toBeInTheDocument();
    await expect(canvas.getByText("Selling")).toBeInTheDocument();
  },
};

// A team with no name still has to render — the id is the last readable thing left, and a blank row
// in a team switcher is unpickable.
export const NamelessTeamShowsItsId: Story = {
  args: { team: { teamId: 99n, teamType: TeamType.WAREHOUSE } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Team #99")).toBeInTheDocument();
  },
};
