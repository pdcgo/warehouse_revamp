import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Stack } from "@chakra-ui/react";
import { create } from "@bufbuild/protobuf";
import { expect, within } from "storybook/test";

import {
  OpnameDraftSchema,
  OpnameDraftType,
  OpnamePlan,
  OpnameRowStatus,
  OpnameSessionStatus,
} from "../../gen/warehouse/inventory/v1/opname_pb";
import {
  OpnameDifference,
  OpnameDrafts,
  OpnamePlanBadge,
  OpnameRowStateBadge,
  OpnameSessionStatusBadge,
  description,
} from "./OpnameBadges";

function Vocabulary() {
  return (
    <Stack gap="4">
      <HStack gap="2">
        <OpnameSessionStatusBadge status={OpnameSessionStatus.ACTIVE} />
        <OpnameSessionStatusBadge status={OpnameSessionStatus.FINISH} />
        <OpnameSessionStatusBadge status={OpnameSessionStatus.CANCEL} />
      </HStack>
      <HStack gap="2">
        <OpnamePlanBadge plan={OpnamePlan.ALL} />
        <OpnamePlanBadge plan={OpnamePlan.TEAM} />
        <OpnamePlanBadge plan={OpnamePlan.PRODUCT} />
        <OpnamePlanBadge plan={OpnamePlan.PLACEMENT} />
      </HStack>
      <HStack gap="2">
        <OpnameRowStateBadge row={{ status: OpnameRowStatus.CREATED, revealed: false }} />
        <OpnameRowStateBadge row={{ status: OpnameRowStatus.CREATED, revealed: true }} />
        <OpnameRowStateBadge row={{ status: OpnameRowStatus.COUNTED, revealed: true }} />
      </HStack>
      <HStack gap="4">
        <OpnameDifference value={-2n} testId="difference-short" />
        <OpnameDifference value={1n} testId="difference-over" />
        <OpnameDifference value={0n} testId="difference-match" />
      </HStack>
      <OpnameDrafts
        testId="drafts"
        drafts={[
          create(OpnameDraftSchema, { type: OpnameDraftType.BROKEN, stockCount: 1n, note: "Karung sobek, dibuang" }),
          create(OpnameDraftSchema, { type: OpnameDraftType.LOST, stockCount: 1n, note: "" }),
        ]}
      />
    </Stack>
  );
}

const meta = {
  title: "Features/Opname/OpnameBadges",
  component: Vocabulary,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Vocabulary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // A difference is signed with a real minus, never a hyphen.
    await expect(canvas.getByTestId("difference-short")).toHaveTextContent("−2");
    await expect(canvas.getByTestId("difference-over")).toHaveTextContent("+1");
    await expect(canvas.getByTestId("difference-match")).toHaveTextContent("0");
    // A draft with no reason says so — the row cannot be marked counted like that.
    await expect(within(canvas.getByTestId("drafts")).getByText("Reason not written yet")).toBeInTheDocument();
  },
};
