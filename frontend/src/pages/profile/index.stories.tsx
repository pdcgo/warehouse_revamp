import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { SELF_ID, userStub } from "../../../.storybook/userStub";
import { userClient } from "../../api/clients";
import { ProfilePage } from "./index";

// MY PROFILE (/profile) — the signed-in person editing THEMSELVES. The stub signs in as Ani; her email is in the
// fixtures, and each story gives her a phone first, so a save that blanked either would show.
//
// The form starts from ProfileDetail (her OWN row, email and phone included) and a save sends only what changed:
// UpdateProfile reads an absent field as "leave alone".

const STORED_PHONE = "+6281211112222";

function aniHasAPhone() {
  userStub.updateUser({ userId: SELF_ID, phoneNumber: STORED_PHONE });
}

const meta = {
  title: "Pages/Profile/ProfilePage",
  component: ProfilePage,
  parameters: { signedIn: true },
  beforeEach: aniHasAPhone,
} satisfies Meta<typeof ProfilePage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const name = await canvas.findByTestId("profile-name", {}, { timeout: 4000 });
  await waitFor(() => expect(name).toHaveValue("Ani Rahayu"));
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** The form shows what is stored — the name, and the email and phone no other screen reads back to her. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("profile-email")).toHaveValue("ani@example.test");
    await expect(canvas.getByTestId("profile-phone")).toHaveValue(STORED_PHONE);
  },
};

export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** A name-only save keeps the email and the phone — the phone is where a forgotten password's code goes. */
export const ANameOnlySaveKeepsEmailAndPhone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const name = canvas.getByTestId("profile-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Ani R", { delay: 40 });
    await userEvent.click(canvas.getByTestId("save-profile"));

    await waitFor(() => expect(userStub.profileDetail().user?.name).toBe("Ani R"));

    const stored = userStub.profileDetail().user;
    await expect(stored?.email).toBe("ani@example.test");
    await expect(stored?.phoneNumber).toBe(STORED_PHONE);

    // The form still shows them after the save.
    await expect(canvas.getByTestId("profile-email")).toHaveValue("ani@example.test");
    await expect(canvas.getByTestId("profile-phone")).toHaveValue(STORED_PHONE);
  },
};

// A story-only control standing in for "something made the profile stale" — it invalidates the `users` cache, as a
// write to a person does, so ProfileDetail answers again under the open form.
function StoryReread() {
  const client = useQueryClient();

  return (
    <Button size="xs" mt="4" data-testid="story-reread" onClick={() => void client.invalidateQueries({ queryKey: ["users"] })}>
      Read the profile again
    </Button>
  );
}

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

/**
 * A RE-READ NEVER OVERWRITES WHAT IS BEING TYPED (#122, useSeedOnce). ProfileDetail is a query now, always fresh: it
 * answers again under the open form — and the name and phone being typed stay exactly as typed.
 */
export const ARereadKeepsWhatWasTyped: Story = {
  name: "A re-read of the profile keeps what was typed",
  beforeEach: () => {
    const spy = spyOn(userClient, "profileDetail");

    return () => spy.mockRestore();
  },
  render: () => (
    <>
      <ProfilePage />
      <StoryReread />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const name = canvas.getByTestId("profile-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Ani Baru", { delay: 40 });
    const phone = canvas.getByTestId("profile-phone");
    await userEvent.clear(phone);
    await userEvent.type(phone, "08123", { delay: 40 });

    await userEvent.click(canvas.getByTestId("story-reread"));
    await waitFor(() => expect(callsOf(userClient.profileDetail)).toBe(2));
    // The answer is in: give it a render to land on the form.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.getByTestId("profile-name")).toHaveValue("Ani Baru");
    await expect(canvas.getByTestId("profile-phone")).toHaveValue("08123");
  },
};
