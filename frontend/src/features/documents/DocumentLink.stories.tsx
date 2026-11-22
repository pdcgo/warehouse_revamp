import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { documentClient } from "../../api/clients";
import { GetDownloadUrlResponseSchema } from "../../gen/warehouse/document/v1/document_pb";
import { useDocumentLink } from "./queries";

// A DOCUMENT'S DOWNLOAD LINK, READ WHEN IT IS SHOWN (#122) — the order form's attached receipt reads it on mount
// (features/orders/form/ShippingReceiptCard). GetDownloadUrl signs a private file for a short while and says until
// when: the answer is reused within that life, less a minute's margin, and never after it.
//
// Here the link is drawn by a probe that a toggle unmounts and mounts again — the same file shown a second time.

let answers = 0;

/** The answer GetDownloadUrl gives: a signed link that expires `lifeMs` from now. */
function signedFor(lifeMs: number) {
  answers += 1;

  return create(GetDownloadUrlResponseSchema, {
    url: `https://example.invalid/signed/receipt-1?v=${answers}`,
    expiresAtUnix: BigInt(Math.floor((Date.now() + lifeMs) / 1000)),
    public: false,
  });
}

function LinkProbe() {
  const { url } = useDocumentLink({ teamId: 12n, documentId: "receipt-1" });

  return <Text data-testid="story-link">{url || "no link"}</Text>;
}

function ShownTwice() {
  const [shown, setShown] = useState(true);

  return (
    <Stack gap="3" align="start">
      <Button size="xs" data-testid="story-toggle" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide the file" : "Show the file again"}
      </Button>
      {shown && <LinkProbe />}
    </Stack>
  );
}

const meta = {
  title: "Features/Documents/DocumentLink",
  component: ShownTwice,
} satisfies Meta<typeof ShownTwice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

async function showAgain(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByTestId("story-toggle"));
  await waitFor(() => expect(canvas.queryByTestId("story-link")).toBeNull());
  await userEvent.click(canvas.getByTestId("story-toggle"));
  await waitFor(() => expect(canvas.getByTestId("story-link")).toBeVisible());

  return canvas;
}

/** WITHIN ITS LIFE: the file shown again draws the same signed link from the cache — no second GetDownloadUrl. */
export const ReusedWithinItsLife: Story = {
  name: "A link is reused within its life — showing the file again asks nothing",
  beforeEach: () => {
    answers = 0;
    // The server's own life for a signed link: 15 minutes.
    const spy = spyOn(documentClient, "getDownloadUrl").mockImplementation(async () => signedFor(15 * 60_000));

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("story-link")).toHaveTextContent("receipt-1?v=1"));

    await showAgain(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("story-link")).toHaveTextContent("receipt-1?v=1"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(callsOf(documentClient.getDownloadUrl)).toBe(1);
  },
};

/**
 * PAST ITS LIFE (less the margin): the file shown again asks for a fresh link and draws only that one — a link about
 * to expire is never handed out from the cache.
 */
export const AskedAgainPastItsLife: Story = {
  name: "A link past its life is asked again — the expired one is never drawn",
  beforeEach: () => {
    answers = 0;
    // A link with just over the margin left (the expiry is in whole seconds): usable for one to two seconds, then past
    // its life.
    const spy = spyOn(documentClient, "getDownloadUrl").mockImplementation(async () => signedFor(62_000));

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("story-link")).toHaveTextContent("receipt-1?v=1"));
    await new Promise((resolve) => setTimeout(resolve, 2500));

    await showAgain(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("story-link")).toHaveTextContent("receipt-1?v=2"), { timeout: 5000 });

    await expect(callsOf(documentClient.getDownloadUrl)).toBe(2);
  },
};
