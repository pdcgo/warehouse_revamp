import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { ScanStation, description } from "./ScanStation";
import { SCAN_IDLE_MS } from "./useScanListener";

// A scanner is a keyboard that types fast and presses Enter. Dispatching the events directly is
// deliberate: `userEvent.type` inserts a human-scale delay between keys, which is exactly what the
// listener is built to REJECT — a test using it would prove the opposite of what it looks like.
function scan(code: string) {
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
}

// Type the same code the way a person would — slower than the idle window between characters.
async function typeSlowly(code: string) {
  for (const key of code) {
    document.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
    await new Promise((r) => setTimeout(r, SCAN_IDLE_MS + 40));
  }
  document.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
}

const PACKED = ["JX0001", "JX0002", "JX0003"];
const KNOWN_BUT_UNPACKED = ["JX0900"];

const meta = {
  title: "LegacyWarehouse/Components/Scan/ScanStation",
  component: ScanStation,
  parameters: { docs: { description: { component: description } } },
  args: {
    title: "Dispatch scan",
    gate: "Packed only",
    resolve: (code: string) => {
      if (PACKED.includes(code)) return { outcome: "accepted" as const, detail: "Order ready for the courier" };
      if (KNOWN_BUT_UNPACKED.includes(code))
        return { outcome: "wrong_status" as const, detail: "Still being packed" };
      return { outcome: "not_found" as const, detail: "Not in this batch" };
    },
  },
} satisfies Meta<typeof ScanStation>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ THE STATION HAS NO INPUT TO FOCUS. This is the load-bearing behaviour of the whole floor app:
// the operator is holding a parcel and a scanner, and cannot click anything to place a cursor.
export const ScansWithNothingFocused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("textbox")).toBeNull();

    scan("JX0001");

    await waitFor(async () => {
      await expect(canvas.getAllByTestId("scan-result")).toHaveLength(1);
    });
    await expect(canvas.getByTestId("tally-accepted")).toHaveTextContent("Accepted 1");
  },
};

// ⚠ A SECOND SCAN OF THE SAME PARCEL IS NORMAL, NOT AN ERROR. Losing your place in a stack and
// re-scanning is ordinary; answering it with the error sound trains the operator to ignore the error
// sound. It gets its own outcome, and the original row is NOT replaced — its position is how the
// operator finds it again.
export const RepeatScanIsItsOwnOutcome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("JX0002");
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("scan-result")).toHaveLength(1);
    });

    scan("JX0002");
    await waitFor(async () => {
      await expect(canvas.getByTestId("tally-duplicate")).toHaveTextContent("Already scanned 1");
    });

    // Still one row, and still accepted — a repeat does not demote what was already banked.
    await expect(canvas.getAllByTestId("scan-result")).toHaveLength(1);
    await expect(canvas.getByTestId("tally-accepted")).toHaveTextContent("Accepted 1");
  },
};

// ⚠ "IN THE BATCH BUT NOT READY" IS NOT "NOT FOUND". Handing the courier a parcel the packer has not
// finished loses it, and the operator has to be told which of the two problems they have.
export const UnpackedIsDistinctFromUnknown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("JX0900");
    scan("ZZ9999");

    await waitFor(async () => {
      await expect(canvas.getAllByTestId("scan-result")).toHaveLength(2);
    });
    await expect(canvas.getByTestId("tally-wrong_status")).toHaveTextContent("Wrong status 1");
    await expect(canvas.getByTestId("tally-not_found")).toHaveTextContent("Not found 1");
  },
};

// The discriminator between a scanner and a person is the GAP between keystrokes, not the content.
// Typed at human speed the buffer is cleared before Enter ever arrives, so nothing fires.
export const TypingByHandNeverFires: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await typeSlowly("JX0001");

    // Give the component the same beat a real scan would have had to register.
    await new Promise((r) => setTimeout(r, 100));
    await expect(canvas.queryAllByTestId("scan-result")).toHaveLength(0);
  },
};

// ⚠ SOUND IS OFF UNTIL IT IS ARMED, AND THE STATION SAYS SO. Browsers block audio until the page has
// been interacted with — so the FIRST scan of a session would be silent, and a silent scan reads as
// an accepted one. Arming is a control the operator presses, not a side effect.
export const SoundIsArmedDeliberately: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);

    const arm = canvas.getByTestId("scan-arm");
    await expect(arm).toHaveAccessibleName("Sound off");

    await userEvent.click(arm);
    await expect(canvas.getByTestId("scan-arm")).toHaveAccessibleName("Sound on");
  },
};

// The gate is what the station will accept. It is visible and switchable because the same station is
// used for a batch that has already been packed and for one being packed as it is scanned.
export const TheGateIsVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("scan-gate")).toHaveTextContent("Packed only");
  },
};

export const Paused: Story = {
  args: { enabled: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("scan-buffer")).toHaveTextContent("Scanning paused");

    scan("JX0001");
    await new Promise((r) => setTimeout(r, 50));
    await expect(canvas.queryAllByTestId("scan-result")).toHaveLength(0);
  },
};
