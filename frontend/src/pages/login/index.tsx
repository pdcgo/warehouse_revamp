import { useState } from "react";
import type { FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Flex,
  Heading,
  Input,
  Stack,
} from "@chakra-ui/react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "../../components/Logo";
import { PasswordInput } from "../../components/PasswordInput";
import { ForgotPasswordDialog } from "./components/ForgotPasswordDialog";
import { useAuth } from "../../features/auth/AuthContext";

export function LoginPage() {
  const { t } = useTranslation();
  const { identity, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (identity) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await login(username, password, remember);
      void navigate("/", { replace: true });
    } catch (err) {
      // The server returns the SAME message for an unknown user and a wrong password — do not
      // embellish it here, or the UI reintroduces the account-enumeration leak the API avoids.
      setError(err instanceof Error ? err.message : t("account.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack align="center" justify="center" minH="100dvh" p="page">
      <Card.Root maxW="sm" w="full">
        <Card.Body>
          <form onSubmit={onSubmit}>
            <Stack gap="section">
              <Logo size={40} justify="center" pb="1" />

              <Heading size="md">{t("account.signIn")}</Heading>

              {error && (
                <Alert.Root status="error" data-testid="login-error">
                  <Alert.Indicator />
                  <Alert.Content>{error}</Alert.Content>
                </Alert.Root>
              )}

              <Field.Root>
                <Field.Label>{t("account.username")}</Field.Label>
                <Input
                  value={username}
                  autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.password")}</Field.Label>
                <PasswordInput
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field.Root>

              <Checkbox.Root
                checked={remember}
                onCheckedChange={(e) => setRemember(!!e.checked)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{t("account.rememberMe")}</Checkbox.Label>
              </Checkbox.Root>

              <Button type="submit" colorPalette="brand" loading={busy}>
                {t("account.signIn")}
              </Button>

              <Flex justify="center">
                <ForgotPasswordDialog />
              </Flex>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
