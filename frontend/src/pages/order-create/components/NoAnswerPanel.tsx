import { useEffect, useRef } from "react";
import { Alert, Button, Flex, Icon, Link, Stack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { ExternalLink, RotateCcw } from "lucide-react";

import { useIsMobile } from "../../../layouts/shell";

// NO ANSWER FROM THE SERVER (no-answer-is-only-a-lost-connection, the-form-locks-until-it-is-answered).
//
// The connection dropped before the server answered, so the order may or may not exist. The form behind stays locked
// on what was sent, and the one way on is a PERSON pressing Try Again — never an automatic resend (the browser's side of
// the-take-is-never-retried). Try Again re-checks the shop + ref first and always warns (a-try-again-always-warns).
//
// The orders list is the quieter answer: a link, opening in a new tab so the locked form survives the look.
//
// ⚠ IT SCROLLS ITSELF INTO VIEW when it appears: Create sits at the foot of the rail (and of the page, on a phone), far
// from the top where this lands, and the only change the person would otherwise see is the spinner stopping.
export function NoAnswerPanel({ onTryAgain, checking }: { onTryAgain: () => void; checking: boolean }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <Alert.Root status="warning" ref={ref} data-testid="order-create-no-answer" alignItems="start">
      <Alert.Indicator />
      <Alert.Content>
        <Stack gap="card">
          <Stack gap="1">
            <Alert.Title data-testid="order-create-no-answer-title">{t("orderForm.lock.noAnswerTitle")}</Alert.Title>
            <Alert.Description>{t("orderForm.lock.noAnswerHelp")}</Alert.Description>
          </Stack>

          <Flex
            direction={isMobile ? "column" : "row"}
            align={isMobile ? "stretch" : "center"}
            gap={isMobile ? "2" : "card"}
          >
            <Button
              colorPalette="brand"
              loading={checking}
              onClick={onTryAgain}
              data-testid="order-create-try-again"
              w={isMobile ? "full" : undefined}
            >
              <Icon as={RotateCcw} boxSize="4" />
              {t("orderForm.lock.tryAgain")}
            </Button>
            <Link
              asChild
              fontSize="sm"
              color="fg.muted"
              justifyContent={isMobile ? "center" : undefined}
              py={isMobile ? "2" : undefined}
            >
              <RouterLink
                to="/orders"
                target="_blank"
                rel="noopener"
                data-testid="order-create-check-orders"
                aria-label={`${t("orderForm.lock.checkOrders")}, ${t("orderForm.duplicate.newTab")}`}
              >
                {t("orderForm.lock.checkOrders")}
                <Icon as={ExternalLink} boxSize="3.5" />
              </RouterLink>
            </Link>
          </Flex>
        </Stack>
      </Alert.Content>
    </Alert.Root>
  );
}
