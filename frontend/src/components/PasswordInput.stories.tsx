import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Field, Stack } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { PasswordInput, description } from "./PasswordInput";

const meta = {
  title: "Components/PasswordInput",
  component: PasswordInput,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { placeholder: "Password" },
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = { args: { defaultValue: "rahasia123" } };

export const Disabled: Story = { args: { defaultValue: "rahasia123", disabled: true } };

// It renders a PLAIN Input rather than wrapping one in an InputGroup, specifically so it still
// consumes the surrounding Field's context — the label→control wiring, `required`, `aria-invalid`.
// An InputGroup would break that association silently, and the field would still look correct.
export const InsideAField: Story = {
  render: (args) => (
    <Field.Root required w="80">
      <Field.Label>
        Password <Field.RequiredIndicator />
      </Field.Label>
      <PasswordInput {...args} />
      <Field.HelperText>At least 8 characters.</Field.HelperText>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // getByLabelText only resolves if the Field actually wired the label to THIS input.
    //
    // `selector: "input"` is required, not tidiness: the show/hide toggle's own aria-label is
    // "Show password", so a loose /password/i match finds two elements and fails for the wrong
    // reason. The two labels living in the same component is exactly why this is pinned.
    // The label reads "Password *" once Field.RequiredIndicator is in it, hence the anchored regex.
    await expect(canvas.getByLabelText(/^Password/, { selector: "input" })).toBeInTheDocument();
  },
};

export const TogglesVisibility: Story = {
  args: { defaultValue: "rahasia123" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const input = canvas.getByPlaceholderText("Password");
    await expect(input).toHaveAttribute("type", "password");

    await userEvent.click(canvas.getByRole("button", { name: /show password/i }));
    await expect(input).toHaveAttribute("type", "text");

    await userEvent.click(canvas.getByRole("button", { name: /hide password/i }));
    await expect(input).toHaveAttribute("type", "password");
  },
};

// ⚠ Two easily-lost details, both invisible in a screenshot:
//
//   `type="button"` — inside a form a bare <button> defaults to SUBMIT, so revealing your password
//   would submit the login form.
//   `tabIndex={-1}` — tabbing a form should move field to field, not detour through the toggle.
export const ToggleNeitherSubmitsNorTakesFocus: Story = {
  render: (args) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        document.body.setAttribute("data-submitted", "yes");
      }}
    >
      <Stack gap="3" w="80">
        <PasswordInput {...args} />
        <Button type="submit">Sign in</Button>
      </Stack>
    </form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    document.body.removeAttribute("data-submitted");

    const toggle = canvas.getByRole("button", { name: /show password/i });
    await expect(toggle).toHaveAttribute("type", "button");
    await expect(toggle).toHaveAttribute("tabindex", "-1");

    await userEvent.click(toggle);
    await expect(document.body.getAttribute("data-submitted")).toBeNull();
  },
};
