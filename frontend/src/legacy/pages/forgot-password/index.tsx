import { useState } from "react";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { Alert } from "../../components/display/Alert";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { TextInput } from "../../components/inputs/TextInput";
import { AuthShell } from "../_auth/AuthShell";

// Requesting a reset link.
//
// ⚠ THE MESSAGE IS THE SAME WHETHER OR NOT THE ACCOUNT EXISTS. Saying "no account with that name"
// is an account-enumeration oracle — anybody can walk a list of names and learn which are
// registered. So the screen always reports the hedged form, "if that account exists, a link is on
// its way". The copy is deliberately non-committal, not vague by accident.
export const description =
  "Requests a reset link. Reports the SAME message whether or not the account exists — anything else lets anyone enumerate which accounts are registered.";

export interface ForgotPasswordPageProps {
  onSubmit?(username: string): void;
  // True once a request has been made — the screen then reports the neutral message above.
  sent?: boolean;
  busy?: boolean;
}

export function ForgotPasswordPage({ onSubmit, sent, busy }: ForgotPasswordPageProps) {
  const [username, setUsername] = useState("");

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will send a reset link to the address on your account."
      footer={
        <Link asChild>
          <RouterLink to="/login">Back to sign in</RouterLink>
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title="Check your messages" data-testid="forgot-sent">
          If that account exists, a reset link is on its way. The link expires in an hour.
        </Alert>
      ) : (
        <Stack gap="card">
          <Field label="Username" required>
            <TextInput
              value={username}
              onChange={setUsername}
              onEnter={() => onSubmit?.(username)}
              autoComplete="username"
              data-testid="forgot-username"
            />
          </Field>

          <Button
            onClick={() => onSubmit?.(username)}
            loading={busy}
            w="full"
            data-testid="forgot-submit"
          >
            Send reset link
          </Button>
        </Stack>
      )}
    </AuthShell>
  );
}
