import { Button, CloseButton, Dialog, Flex, Icon, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { CircleAlert, TriangleAlert } from "lucide-react";

import type { CheckFinding } from "../checks";
import { hasBlocking } from "../checks";

// WHAT THE ORDER'S CHECKS FOUND, BEFORE IT IS PLACED (owner).
//
// ⚠ ONE DIALOG FOR ALL OF THEM, and one that changes its OFFER rather than its shape. An order can
// fail several checks at once — a tracking number that is also the order id, on a thin margin, from
// a courier whose format does not match — and answering those one modal at a time is three
// interruptions to place one order.
//
//   any ERROR  → the only way out is Back. Placing is not offered, because the finding is a
//                transcription mistake rather than a decision somebody is entitled to make.
//   WARNINGS   → "Place Anyway" sits beside Back. The person taking the order knows things the
//                checker does not, and a warning that cannot be overruled is a blocker in disguise.
//
// It is deliberately NOT `ConfirmDialog`: that component asks ONE question and this one reports a
// list, and its confirm button is always available — which is exactly what must not happen here.
export function OrderChecksDialog({
  findings,
  onClose,
  onPlaceAnyway,
  placing,
}: {
  /** Empty = closed. The page holds them, because it is the page that ran the checks. */
  findings: CheckFinding[];
  onClose: () => void;
  onPlaceAnyway: () => void;
  placing: boolean;
}) {
  const { t } = useTranslation();
  const blocked = hasBlocking(findings);

  return (
    <Dialog.Root
      open={findings.length > 0}
      onOpenChange={(e) => !e.open && onClose()}
      role="alertdialog"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="order-checks-dialog">
            <Dialog.Header>
              <Dialog.Title>
                {blocked ? t("orderForm.checks.blockedTitle") : t("orderForm.checks.warnTitle")}
              </Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" aria-label={t("common.close")} />
              </Dialog.CloseTrigger>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {blocked ? t("orderForm.checks.blockedLead") : t("orderForm.checks.warnLead")}
                </Text>

                <Stack gap="2">
                  {findings.map((finding) => (
                    <Flex
                      key={finding.id}
                      gap="2"
                      align="start"
                      data-testid={`order-check-${finding.id}`}
                    >
                      {/* The two severities are told apart by SHAPE as well as colour — a circle for
                          what refuses, a triangle for what asks. */}
                      <Icon
                        as={finding.level === "error" ? CircleAlert : TriangleAlert}
                        boxSize="4"
                        color={finding.level === "error" ? "error.fg" : "warning.fg"}
                        mt="0.5"
                        flexShrink="0"
                      />
                      <Text fontSize="sm">
                        {t(`orderForm.checks.${finding.id}`, finding.values ?? {})}
                      </Text>
                    </Flex>
                  ))}
                </Stack>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Button variant="outline" onClick={onClose} data-testid="order-checks-back">
                {t("orderForm.checks.back")}
              </Button>

              {/* ⚠ OFFERED ONLY WHEN EVERY FINDING IS A WARNING. */}
              {!blocked && (
                <Button
                  colorPalette="brand"
                  loading={placing}
                  onClick={onPlaceAnyway}
                  data-testid="order-checks-place"
                >
                  {t("orderForm.checks.placeAnyway")}
                </Button>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
