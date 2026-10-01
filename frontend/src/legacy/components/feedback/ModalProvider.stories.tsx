import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { ModalProvider, description, useModal } from "./ModalProvider";

const meta = {
  title: "Legacy/Components/Feedback/ModalProvider",
  component: ModalProvider,
  parameters: { docs: { description: { component: description } } },
  args: { children: null },
} satisfies Meta<typeof ModalProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

// The shape the imperative API exists for: the question arises INSIDE the handler, and the answer is
// needed at the very next line. Expressing this declaratively means hoisting state, a dialog and two
// callbacks into the component just to ask one question.
function Consumer() {
  const { confirm, setLoading } = useModal();
  const [outcome, setOutcome] = useState<string>("—");

  return (
    <Stack gap="3" align="flex-start">
      <Button
        data-testid="delete"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete Product",
            content: "This removes the product and its stock history. It cannot be undone.",
            confirmLabel: "Delete",
            tone: "error",
          });

          setOutcome(ok ? "confirmed" : "cancelled");
        }}
      >
        Delete product
      </Button>

      <Button
        data-testid="save"
        onClick={async () => {
          setLoading(true, "Saving…");
          await new Promise((r) => setTimeout(r, 300));
          setLoading(false, "Saving…");
        }}
      >
        Save (blocking)
      </Button>

      <Text data-testid="outcome">{outcome}</Text>
    </Stack>
  );
}

const Harness = () => (
  <ModalProvider>
    <Consumer />
  </ModalProvider>
);

export const ConfirmResolvesTrue: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("delete"));

    await waitFor(async () => {
      await expect(screen.getByTestId("confirm-accept")).toBeVisible();
    });
    await userEvent.click(screen.getByTestId("confirm-accept"));

    await waitFor(async () => {
      await expect(screen.getByTestId("outcome")).toHaveTextContent("confirmed");
    });
  },
};

// Cancelling resolves FALSE — and so does Escape, and so does the backdrop. Treating a dismissal as
// consent is how a delete happens to somebody who was trying to get OUT of the dialog.
export const DismissingResolvesFalse: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("delete"));

    await waitFor(async () => {
      await expect(screen.getByTestId("confirm-cancel")).toBeVisible();
    });

    await userEvent.keyboard("{Escape}");

    await waitFor(async () => {
      await expect(screen.getByTestId("outcome")).toHaveTextContent("cancelled");
    });
  },
};

// The blocking overlay: shown while an operation runs, and gone when it finishes. It has no close
// affordance on purpose — it is not something you dismiss, it is something you wait out.
export const BlockingLoading: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("save"));

    await waitFor(async () => {
      await expect(screen.getByTestId("modal-loading")).toBeVisible();
    });

    await waitFor(
      async () => {
        await expect(screen.queryByTestId("modal-loading")).toBeNull();
      },
      { timeout: 3000 },
    );
  },
};
