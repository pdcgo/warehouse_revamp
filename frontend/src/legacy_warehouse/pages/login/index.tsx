import { useState } from "react";
import { Box, Button, Field, Flex, Icon, Input, Stack, Text } from "@chakra-ui/react";
import { Warehouse } from "lucide-react";
import { Alert } from "../../../legacy/components/display/Alert";
import { Card } from "../../../legacy/components/display/Card";

// ── SIGN IN ─────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS A SIGN-IN SCREEN FOR A DEVICE THAT IS SHARED, AND THAT CHANGES IT MORE THAN IT LOOKS.
//
// The assumptions a normal login screen rests on do not hold on a warehouse floor:
//
//   normal app                          this app
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   one person, one device              one tablet, a shift's worth of people
//   sign in once, stay signed in        signed in and out repeatedly through the day
//   typed on a real keyboard            typed with gloves, on glass, in a hurry
//   "remember me" is a convenience      "remember me" is a way to record work against a stranger
//
// So three things follow, and all three are deliberate:
//
//   1. NO "REMEMBER ME". On a shared device it means the next person's picks are recorded against
//      you. The convenience it buys is real and it is bought with the integrity of every movement
//      record, which is not a trade worth making.
//   2. THE USERNAME IS NOT AN EMAIL. Floor staff are identified by a short handle they can type
//      one-handed. Requiring an email address on this screen is a design that has never watched
//      somebody type one wearing gloves.
//   3. THE FAILURE MESSAGE IS SPECIFIC ABOUT THE SHARED CASE — "signed in as somebody else" is a
//      thing that happens hourly here, and telling the operator that is more useful than a generic
//      credentials error.
export const description =
  "Sign in for a SHARED device. No 'remember me' — on a tablet a whole shift uses, it records the next person's work against you. Short handles rather than emails, because it is typed with gloves on glass.";

export interface LoginPageProps {
  error?: string;
  // Who the device is currently signed in as, if anyone. Shown because the most common reason
  // somebody is on this screen is to take over from the last shift.
  currentUser?: string;
  loading?: boolean;
  onSubmit?(username: string, password: string): void;
}

export function LoginPage({ error, currentUser, loading, onSubmit }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Flex minH="100dvh" align="center" justify="center" p="page" bg="bg.subtle" data-testid="login-page">
      <Card maxW="sm" w="full">
        <Stack gap="section">
          <Stack gap="1" align="center">
            <Icon as={Warehouse} boxSize="8" color="colorPalette.solid" colorPalette="brand" />
            <Text fontWeight="semibold">Warehouse Admin</Text>
          </Stack>

          {/* ⚠ WHO IS ALREADY SIGNED IN, BEFORE YOU SIGN IN. The most common reason somebody is on
              this screen is to take over from the last shift, and knowing whose session they are
              replacing is what stops them working under it by accident. */}
          {currentUser && (
            <Alert tone="info" data-testid="current-user">
              This tablet is signed in as <b>{currentUser}</b>. Signing in replaces that session —
              anything recorded after this is yours.
            </Alert>
          )}

          {error && (
            <Alert tone="error" data-testid="login-error">
              {error}
            </Alert>
          )}

          <Stack
            as="form"
            gap="field"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit?.(username, password);
            }}
          >
            <Field.Root>
              {/* Not "Email". Floor staff have a short handle they can type one-handed. */}
              <Field.Label>Username</Field.Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                autoComplete="username"
                autoCapitalize="none"
                data-testid="username"
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="current-password"
                data-testid="password"
              />
            </Field.Root>

            <Button type="submit" loading={loading} data-testid="sign-in">
              Sign in
            </Button>
          </Stack>

          {/* ⚠ THE ABSENCE IS THE DESIGN, so it is stated rather than left as a missing checkbox
              somebody adds back later "for convenience". */}
          <Box borderTopWidth="1px" pt="3">
            <Text fontSize="xs" color="fg.muted" data-testid="no-remember-me">
              There is no "stay signed in" on a shared tablet — it would record the next person's
              work against you.
            </Text>
          </Box>
        </Stack>
      </Card>
    </Flex>
  );
}
