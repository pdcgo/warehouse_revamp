import { useState } from "react";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { Alert } from "../../components/display/Alert";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { PasswordInput } from "../../../components/inputs/PasswordInput";
import { AuthShell } from "../_auth/AuthShell";

// Choosing the new password, from a link.
//
// The EXPIRED case is a first-class state, not an error banner over a form. A reset link that has
// timed out cannot be salvaged by anything typed into the fields, so leaving them on screen invites
// somebody to fill the form in and press a button that was never going to work. The screen replaces
// itself with the one action that helps: request another link.
export const description =
  "Sets a new password from a reset link. An expired link REPLACES the form rather than bannering over it — nothing typed in could have worked, so the only action offered is requesting a new link.";

export interface ForgotPasswordResetPageProps {
  onSubmit?(password: string): void;
  // The link is no longer valid — see above.
  expired?: boolean;
  busy?: boolean;
}

export function ForgotPasswordResetPage({ onSubmit, expired, busy }: ForgotPasswordResetPageProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && confirm !== password;

  if (expired) {
    return (
      <AuthShell title="This link has expired" subtitle="Reset links are valid for one hour.">
        <Stack gap="card" data-testid="reset-expired">
          <Alert tone="warning">Request a new link and use the most recent message.</Alert>
          <Button href="/forgot-password" w="full">
            Request a new link
          </Button>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link asChild>
          <RouterLink to="/login">Back to sign in</RouterLink>
        </Link>
      }
    >
      <Stack gap="card">
        <Field label="New password" required>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            data-testid="reset-password"
          />
        </Field>

        <Field
          label="Confirm new password"
          required
          error={mismatch ? "The two passwords do not match." : undefined}
        >
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            data-testid="reset-confirm"
          />
        </Field>

        <Button
          disabled={mismatch || password.length === 0}
          loading={busy}
          onClick={() => onSubmit?.(password)}
          w="full"
          data-testid="reset-submit"
        >
          Set password
        </Button>
      </Stack>
    </AuthShell>
  );
}
