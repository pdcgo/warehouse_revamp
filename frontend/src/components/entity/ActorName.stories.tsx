import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack, Table, Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ActorName, RootTeamBadge, description } from "./ActorName";

// THE "BY ROOT TEAM" BADGE (an-override-shows-a-root-team-badge, the-override-badge-is-accepted-as-by-root-team) — the
// person's name, and beside it, on a record Root or the System Administrator wrote inside a team they are not in, the one
// shared badge. The live screens that draw it, fed `is_override` through the stubs, are under Pages/RootTeamBadge.

const meta = {
  title: "Components/Entity/ActorName",
  component: ActorName,
  parameters: { docs: { description: { component: description } }, layout: "padded" },
  args: { name: "Fajar Nugroho" },
} satisfies Meta<typeof ActorName>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Open the badge's sentence the way the device does: a hover on a desktop (a tooltip), a tap on a phone (the badge is a
 * button there). Returns the sentence's element.
 */
async function explainBadge(badge: HTMLElement): Promise<HTMLElement> {
  if (badge.tagName === "BUTTON") {
    await userEvent.click(badge);
  } else {
    await userEvent.hover(badge);
  }

  const hint = await screen.findByTestId("root-team-badge-hint", {}, { timeout: 3000 });
  await waitFor(() => expect(hint).toBeVisible());

  return hint;
}

// A member's record: the name alone — nothing new beside it.
export const AMembersRecord: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Fajar Nugroho")).toBeInTheDocument();
    await expect(canvas.queryByTestId("root-team-badge")).toBeNull();
  },
};

// An override: the name, then the badge — and the badge says what it means.
export const AnOverride: Story = {
  args: { isOverride: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Fajar Nugroho")).toBeInTheDocument();

    const badge = canvas.getByTestId("root-team-badge");
    // A word, not the key — a missing catalogue entry would render "override.byRootTeam".
    await expect(badge).toHaveTextContent("by Root team");

    const hint = await explainBadge(badge);
    await expect(hint).toHaveTextContent("Root or the System Administrator did this inside this team");
  },
};

// The same in Bahasa Indonesia.
export const InIndonesian: Story = {
  args: { isOverride: true },
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByTestId("root-team-badge");
    await expect(badge).toHaveTextContent("oleh tim Root");

    const hint = await explainBadge(badge);
    await expect(hint).toHaveTextContent("Root atau System Administrator melakukannya di dalam tim ini");
  },
};

// IN A TABLE CELL — a "By" column: the badge only on the row the root team wrote, and in a narrow cell it drops under
// the name rather than squeezing it.
export const InATableCell: Story = {
  render: () => (
    <Table.Root size="sm" maxW="md" data-testid="cell-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>What</Table.ColumnHeader>
          <Table.ColumnHeader>By</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Change</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row data-testid="cell-row-member">
          <Table.Cell>Received</Table.Cell>
          <Table.Cell>
            <ActorName name="Ani Rahayu" />
          </Table.Cell>
          <Table.Cell textAlign="end">+12</Table.Cell>
        </Table.Row>
        <Table.Row data-testid="cell-row-override">
          <Table.Cell>Adjusted</Table.Cell>
          <Table.Cell w="32">
            <ActorName name="Fajar Nugroho" isOverride />
          </Table.Cell>
          <Table.Cell textAlign="end">−2</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByTestId("cell-row-member")).queryByTestId("root-team-badge")).toBeNull();

    const badge = within(canvas.getByTestId("cell-row-override")).getByTestId("root-team-badge");
    await expect(canvas.getAllByTestId("root-team-badge")).toHaveLength(1);

    // Wrapped under the name in the narrow cell, never over it.
    const name = within(canvas.getByTestId("cell-row-override")).getByText("Fajar Nugroho");
    await expect(badge.getBoundingClientRect().top).toBeGreaterThanOrEqual(name.getBoundingClientRect().top - 1);
  },
};

// IN A PHONE BLOCK OR A MUTED META LINE — the small size, in the line's own colour and size.
export const InAMetaLine: Story = {
  render: () => (
    <Box w="80" borderWidth="1px" borderRadius="md" p="3">
      <Text fontWeight="medium">Order confirmed</Text>
      <Text fontSize="xs" color="fg.muted" data-testid="meta-line">
        {"10 Nov 2026, 14.20 · Warehouse · "}
        <ActorName name="Fajar Nugroho" isOverride size="xs" />
      </Text>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByTestId("meta-line");
    await expect(line).toHaveTextContent("Fajar Nugroho");
    await expect(within(line).getByTestId("root-team-badge")).toBeInTheDocument();
  },
};

// AFTER A SENTENCE that already names the person — the member log's way: the badge alone.
export const AfterASentence: Story = {
  render: () => (
    <Stack gap="2">
      <Text textStyle="sm" data-testid="sentence-member">
        dewi added budi as Warehouse Admin
      </Text>
      <Text textStyle="sm" data-testid="sentence-override">
        fajar removed Former user #69 (Warehouse Staff) <RootTeamBadge />
      </Text>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByTestId("sentence-member")).queryByTestId("root-team-badge")).toBeNull();
    await expect(within(canvas.getByTestId("sentence-override")).getByTestId("root-team-badge")).toHaveTextContent(
      "by Root team",
    );
  },
};
