import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { TRACKED_PARCELS } from "../../fixtures";
import { TrackBeforeSendPage, description } from "./index";

function scan(code: string) {
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
}

const meta = {
  title: "LegacyWarehouse/Pages/TrackBeforeSend",
  component: TrackBeforeSendPage,
  parameters: { docs: { description: { component: description } } },
  args: { parcels: TRACKED_PARCELS },
} satisfies Meta<typeof TrackBeforeSendPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Three of the four are not yet accounted for; one was already handed over.
    await expect(canvas.getByTestId("unaccounted")).toHaveTextContent("3");
  },
};

// ⚠ THE HEADLINE IS THE ABSENCE, NOT THE PROGRESS. "12 scanned" is a number about the operator;
// "3 unaccounted for" is a number about the parcels, and only the second decides whether the courier
// can leave.
export const TheHeadlineIsWhatIsMissing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("unaccounted")).toHaveTextContent("Unaccounted for");
    await expect(canvas.getByTestId("unaccounted")).toHaveTextContent("not yet in the pile");
  },
};

// The scan is not the output — it is how the screen learns what is present. The answer is the
// residue, and it shrinks as the pile is worked through.
export const ScanningShrinksTheResidue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("JX0002");
    await waitFor(async () => {
      await expect(canvas.getByTestId("unaccounted")).toHaveTextContent("2");
    });

    scan("JX0003");
    await waitFor(async () => {
      await expect(canvas.getByTestId("unaccounted")).toHaveTextContent("1");
    });
  },
};

// ⚠ A PARCEL IN THE PILE THAT IS NOT ON THE MANIFEST IS ALSO A PROBLEM. Loading it onto this van
// loses it just as surely as leaving one behind, so the refusal says what to do about it.
export const AParcelThatIsNotOnTheManifest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("ZZ9999");
    await waitFor(async () => {
      await expect(canvas.getByTestId("scan-result")).toHaveTextContent("do not load it");
    });
  },
};

// ⚠ PACKED, ON THE MANIFEST, AND NOT IN THE PILE — the case the screen exists for. Found now, it is
// a two-minute search; found tomorrow, it is a claim with nobody able to say whether it left.
export const PackedButNotFound: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("missing-alert")).toHaveTextContent("packed and on the");
    const missing = canvas.getAllByTestId("parcel-state").filter((s) => s.getAttribute("data-state") === "missing");
    await expect(missing).toHaveLength(1);
  },
};

// The clear-to-go state is stated, not implied by an empty list. "Nothing left" and "the screen has
// not loaded" look identical otherwise, and this is the moment somebody acts on it.
export const EverythingAccountedFor: Story = {
  args: { parcels: TRACKED_PARCELS.filter((p) => p.status === "handed_over") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("all-clear")).toHaveTextContent("The courier can go");
  },
};

export const NothingOnTheManifest: Story = {
  args: { parcels: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("manifest-table")).toHaveTextContent("Nothing on this manifest");
  },
};

export const Loading: Story = { args: { parcels: [], loading: true } };
