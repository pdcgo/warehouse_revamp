import { Button, CloseButton, Dialog, Flex, Icon, Link, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { ExternalLink, TriangleAlert } from "lucide-react";

import { OrderStatusBadge } from "../../../components/badges/OrderStatusBadge";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDate } from "../../../lib/datetime";
import { type DuplicateFinding, warns } from "./duplicateRef";

export const description =
  "The order form's duplicate marketplace-ref warning: names each live order (and draft) already on this shop + ref, as links that open in a new tab, with Create Anyway and Go Back. A warning, never a refusal. With `retry` it is Try Again's warning after a Create that got no answer: it always opens — naming the order, or saying the last Create may still be finishing (Send Again).";

// THE SHOP + REF IS ALREADY RECORDED (a-duplicate-ref-is-warned-not-refused, the-duplicate-warning-reads-drafts-too).
//
// ⚠ A QUESTION WITH A WAY THROUGH. The server creates the order whatever its ref, and a double is sometimes meant
// (a cancelled order re-created, and reasons the owner keeps out of the repo) — so Create Anyway is always offered.
// Not `ConfirmDialog`: that asks one question, and this one reports a list the person reads before answering.
//
// ⚠ EVERY FOUND ROW IS A LINK THAT OPENS IN A NEW TAB. The form behind the dialog is real work (lines, a buyer on
// the phone); following the link in this tab would meet the leave-guard, or lose the form. A new tab lets the person
// look, come back and decide.
//
// ⚠ TRY AGAIN REUSES IT (`retry`, a-try-again-always-warns). After a Create that got NO answer the first submit may have
// landed, so the re-check usually finds it: the lead says so. When it finds nothing the dialog still opens — the first
// Create may still be finishing, and the warning can only see what has committed — with a link to the orders list and
// Send Again. Closing it any other way than Go Back (`onDismiss`: the X, Escape, the backdrop) leaves the form locked
// on what was sent; Go Back is the one answer that gives the form back.
export function DuplicateRefDialog({
  finding,
  onCreateAnyway,
  onGoBack,
  onDismiss,
  placing,
  retry = false,
}: {
  /** null = closed. The page holds it, because the page ran the check. */
  finding: DuplicateFinding | null;
  onCreateAnyway: () => void;
  onGoBack: () => void;
  /** Closed without an answer (the X, Escape, the backdrop) — defaults to Go Back. */
  onDismiss?: () => void;
  placing: boolean;
  /** Try Again's warning, after a Create that got no answer — it opens even when nothing is found. */
  retry?: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // Try Again found nothing (and the lookup itself ran): the last Create may still be finishing.
  const nothingYet = retry && finding !== null && finding.error === undefined && !warns(finding);

  return (
    <Dialog.Root
      open={finding !== null}
      onOpenChange={(e) => !e.open && (onDismiss ?? onGoBack)()}
      role="alertdialog"
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="duplicate-ref-dialog" mx={isMobile ? "card" : undefined}>
            <Dialog.Header>
              <Flex align="center" gap="2" minW="0">
                <Icon as={TriangleAlert} boxSize="5" color="warning.fg" flexShrink="0" />
                <Dialog.Title>
                  {t(nothingYet ? "orderForm.lock.retryNoneTitle" : "orderForm.duplicate.title")}
                </Dialog.Title>
              </Flex>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" aria-label={t("common.close")} />
              </Dialog.CloseTrigger>
            </Dialog.Header>

            <Dialog.Body>
              {finding && (
                <Stack gap="card">
                  {finding.error !== undefined ? (
                    <Text fontSize="sm" data-testid="duplicate-ref-failed">
                      {t("orderForm.duplicate.failed", { ref: finding.ref, error: finding.error })}
                    </Text>
                  ) : nothingYet ? (
                    <Stack gap="2" align="start">
                      <Text fontSize="sm" data-testid="duplicate-ref-lead" data-retry="nothing">
                        {t("orderForm.lock.retryNoneLead", { ref: finding.ref })}
                      </Text>
                      <Link asChild colorPalette="brand" fontSize="sm" fontWeight="bold">
                        <RouterLink
                          to="/orders"
                          target="_blank"
                          rel="noopener"
                          data-testid="duplicate-ref-check-orders"
                          aria-label={`${t("orderForm.lock.checkOrders")}, ${t("orderForm.duplicate.newTab")}`}
                        >
                          {t("orderForm.lock.checkOrders")}
                          <Icon as={ExternalLink} boxSize="3.5" />
                        </RouterLink>
                      </Link>
                    </Stack>
                  ) : (
                    <Text
                      fontSize="sm"
                      color={retry ? undefined : "fg.muted"}
                      data-testid="duplicate-ref-lead"
                      data-retry={retry ? "found" : undefined}
                    >
                      {t(retry ? "orderForm.lock.retryFoundLead" : "orderForm.duplicate.lead", { ref: finding.ref })}
                    </Text>
                  )}

                  <Stack gap="2" data-testid="duplicate-ref-found">
                    {finding.orders.map((order) => (
                      <Flex
                        key={`order-${order.id}`}
                        gap="2"
                        align="center"
                        wrap="wrap"
                        data-testid={`duplicate-ref-order-${order.id}`}
                      >
                        <Link asChild colorPalette="brand" fontSize="sm" fontWeight="bold">
                          <RouterLink
                            to={`/orders/${order.id}`}
                            target="_blank"
                            rel="noopener"
                            data-testid={`duplicate-ref-order-link-${order.id}`}
                            aria-label={`${t("orderForm.duplicate.order", { id: order.id.toString() })}, ${t("orderForm.duplicate.newTab")}`}
                          >
                            {t("orderForm.duplicate.order", { id: order.id.toString() })}
                            <Icon as={ExternalLink} boxSize="3.5" />
                          </RouterLink>
                        </Link>
                        <OrderStatusBadge status={order.status} />
                        <Text fontSize="sm" color="fg.muted">
                          {t("orderForm.duplicate.created", { date: formatUnixDate(order.createdAtUnix) })}
                        </Text>
                      </Flex>
                    ))}

                    {finding.drafts.map((draft) => (
                      <Flex
                        key={`draft-${draft.id}`}
                        gap="2"
                        align="center"
                        wrap="wrap"
                        data-testid={`duplicate-ref-draft-${draft.id}`}
                      >
                        <Link asChild colorPalette="brand" fontSize="sm" fontWeight="bold">
                          <RouterLink
                            to={`/orders/new?draft=${draft.id}`}
                            target="_blank"
                            rel="noopener"
                            data-testid={`duplicate-ref-draft-link-${draft.id}`}
                            aria-label={`${t("orderForm.duplicate.draft", { id: draft.id.toString() })}, ${t("orderForm.duplicate.newTab")}`}
                          >
                            {t("orderForm.duplicate.draft", { id: draft.id.toString() })}
                            <Icon as={ExternalLink} boxSize="3.5" />
                          </RouterLink>
                        </Link>
                        <Text fontSize="sm" color="fg.muted">
                          {t("orderForm.duplicate.created", { date: formatUnixDate(draft.createdAtUnix) })}
                        </Text>
                      </Flex>
                    ))}
                  </Stack>

                </Stack>
              )}
            </Dialog.Body>

            {/* A PHONE STACKS THE TWO full width, Create Anyway on top — the thumb's reach, and no label cut. */}
            <Dialog.Footer flexDirection={isMobile ? "column-reverse" : "row"} alignItems="stretch">
              <Button
                variant="outline"
                onClick={onGoBack}
                data-testid="duplicate-ref-go-back"
                w={isMobile ? "full" : undefined}
              >
                {t("orderForm.duplicate.goBack")}
              </Button>
              <Button
                colorPalette="brand"
                loading={placing}
                onClick={onCreateAnyway}
                data-testid="duplicate-ref-create-anyway"
                w={isMobile ? "full" : undefined}
              >
                {t(nothingYet ? "orderForm.lock.sendAgain" : "orderForm.duplicate.createAnyway")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
