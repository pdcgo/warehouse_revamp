import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { LoginPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Login",
  component: LoginPage,
  parameters: { docs: { description: { component: description } } },
  args: { onSubmit: fn() },
} satisfies Meta<typeof LoginPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("username")).toBeVisible();
  },
};

// ⚠ NO "REMEMBER ME", AND THE ABSENCE IS STATED. On a tablet a whole shift uses, staying signed in
// records the next person's picks against you — so it is not a missing feature somebody should add
// back "for convenience".
export const NoStaySignedIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("checkbox")).toBeNull();
    await expect(canvas.getByTestId("no-remember-me")).toHaveTextContent("shared tablet");
  },
};

// ⚠ A HANDLE, NOT AN EMAIL. Requiring an email address here is a design that has never watched
// somebody type one wearing gloves, on glass, in a hurry.
export const AHandleNotAnEmail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Username")).toBeVisible();
    await expect(canvas.getByTestId("username")).not.toHaveAttribute("type", "email");
    await expect(canvas.getByTestId("username")).toHaveAttribute("autocapitalize", "none");
  },
};

// ⚠ WHO IS ALREADY SIGNED IN, BEFORE YOU SIGN IN. Taking over from the last shift is the most common
// reason to be on this screen, and knowing whose session you are replacing is what stops you working
// under it by accident.
export const TakingOverFromTheLastShift: Story = {
  args: { currentUser: "Budi Santoso" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("current-user")).toHaveTextContent("Budi Santoso");
    await expect(canvas.getByTestId("current-user")).toHaveTextContent("anything recorded after this is yours");
  },
};

export const Submits: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("username"), "ani");
    await userEvent.type(canvas.getByTestId("password"), "hunter2");
    await userEvent.click(canvas.getByTestId("sign-in"));

    await expect(args.onSubmit).toHaveBeenCalledWith("ani", "hunter2");
  },
};

export const WrongCredentials: Story = {
  args: { error: "That username and password do not match." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("login-error")).toBeVisible();
  },
};

export const Loading: Story = { args: { loading: true } };
