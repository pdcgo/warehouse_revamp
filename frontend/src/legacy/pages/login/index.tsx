import { useState } from "react";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { Alert } from "../../components/display/Alert";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { PasswordInput } from "../../../components/inputs/PasswordInput";
import { TextInput } from "../../components/inputs/TextInput";
import { AuthShell } from "../_auth/AuthShell";

// The sign-in screen.
//
// Two things it does that a bare form does not:
//
//  1. IT SUBMITS ON ENTER, from either field. Signing in is a two-field form people do every morning
//     without looking; reaching for the mouse to submit it is friction on the most-repeated action
//     in the app.
//  2. ITS ERROR IS ONE MESSAGE FOR BOTH FIELDS. "No account with that username" tells an attacker
//     which usernames exist, so a failed sign-in never says WHICH half was wrong — and the message
//     sits above the form rather than under a field, because it belongs to neither.
export const description =
  "The sign-in screen. Submits on Enter from either field, and reports one message for both — never which half was wrong, since that would confirm which usernames exist.";

export interface LoginPageProps {
  onSubmit?(values: { username: string; password: string }): void;
  // A failed attempt. Deliberately not per-field — see above.
  error?: string;
  busy?: boolean;
}

export function LoginPage({ onSubmit, error, busy }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => onSubmit?.({ username, password });

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the account your team owner set up for you."
      footer={
        <Link asChild>
          <RouterLink to="/forgot-password">Forgotten your password?</RouterLink>
        </Link>
      }
    >
      {error && (
        <Alert tone="error" data-testid="login-error">
          {error}
        </Alert>
      )}

      <Stack gap="card">
        <Field label="Username" required>
          <TextInput
            value={username}
            onChange={setUsername}
            onEnter={submit}
            autoComplete="username"
            data-testid="login-username"
          />
        </Field>

        <Field label="Password" required>
          {/* The live app's PasswordInput — the show/hide toggle matters most on a warehouse floor,
              where the password is typed on a phone with gloves on. */}
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete="current-password"
            data-testid="login-password"
          />
        </Field>

        <Button onClick={submit} loading={busy} w="full" data-testid="login-submit">
          Sign in
        </Button>
      </Stack>
    </AuthShell>
  );
}
