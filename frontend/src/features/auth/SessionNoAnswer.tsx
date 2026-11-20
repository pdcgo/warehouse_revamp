import { Alert, Button, Card, Icon, Stack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";

import { Logo } from "../../components/chrome/Logo";
import { useAuth } from "./AuthContext";

// THE PAGE LOAD'S SIGN-IN CHECK GOT NO ANSWER (#96) — shown by AuthGate in place of the app, never the Sign in form.
//
// A token is stored and every try of the load's CheckAccess failed without the server's verdict (aborted, the network, a
// 5xx — tokenVerdict.ts), after the short waits of `checkRetry`. Nobody is known to be signed out, so the form would be a
// lie: the token is kept, and the next answer opens the app as the person left it. The way on is Try Again; the
// connection coming back or the window regaining focus also asks again by itself (AuthContext.tsx).
//
// It is the order form's no-answer panel (pages/order-create/components/NoAnswerPanel.tsx, the-form-lock-and-try-again-
// are-accepted) — a warning Alert, its title, one line of help and Try Again — framed by the login page's card.
export function SessionNoAnswer() {
  const { t } = useTranslation();
  const { retry, checking } = useAuth();

  return (
    <Stack align="center" justify="center" minH="100dvh" p={{ base: "card", md: "page" }}>
      <Card.Root maxW="sm" w="full">
        <Card.Body>
          <Stack gap="section">
            <Logo size={40} justify="center" pb="1" />

            <Alert.Root status="warning" data-testid="auth-no-answer" alignItems="start">
              <Alert.Indicator />
              <Alert.Content>
                <Stack gap="card">
                  <Stack gap="1">
                    <Alert.Title data-testid="auth-no-answer-title">{t("account.noAnswer.title")}</Alert.Title>
                    <Alert.Description>{t("account.noAnswer.help")}</Alert.Description>
                  </Stack>

                  <Button
                    colorPalette="brand"
                    alignSelf="start"
                    loading={checking}
                    onClick={retry}
                    data-testid="auth-no-answer-try-again"
                  >
                    <Icon as={RotateCcw} boxSize="4" />
                    {t("account.noAnswer.tryAgain")}
                  </Button>
                </Stack>
              </Alert.Content>
            </Alert.Root>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
