import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, Icon, IconButton } from "@chakra-ui/react";
import { ArrowLeft, Trash2 } from "lucide-react";

import { CompactActions } from "../../../components/chrome/CompactActions";
import type { OrderDraft } from "../../../gen/warehouse/selling/v1/order_draft_pb";

// THE PAGE'S HEADER — Back, the title, and on a draft which one it is and the way to drop it. Moved out of
// `OrderCreatePage` whole (#135) and memoised (memoCards.ts), so a key typed into the form does not render it: it reads
// only the draft, the layout, the lock and where Back returns to.
export function OrderCreateHeader({
  draft,
  isMobile,
  locked,
  openedFrom,
  onDelete,
}: {
  draft: OrderDraft | null;
  isMobile: boolean;
  locked: boolean;
  /** Where Back returns to — the product's page that opened the form, else the order screens. */
  openedFrom: string | undefined;
  /** Opens the delete-draft confirm. */
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Flex align="center" gap="card">
      <IconButton
        size="xs"
        variant="ghost"
        aria-label="Back"
        data-testid="order-create-back"
        onClick={() => navigate(openedFrom ?? "/orders")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
      </IconButton>
      <Heading size="md" truncate={isMobile} minW="0">
        {t("orders.newOrderTitle")}
      </Heading>
      {/* FROM A DRAFT — which one, and the way to drop it (the-draft-opens-in-the-order-form). */}
      {draft && (
        <>
          <Badge colorPalette="gray" flexShrink={0} data-testid="order-create-draft-ref">
            {t("orderForm.draft.badge", { ref: draft.externalId })}
          </Badge>
          <Box flex="1" />
          {isMobile ? (
            <CompactActions
              menuLabel={t("common.actions")}
              actions={[
                {
                  id: "delete",
                  label: t("orderForm.draft.delete"),
                  icon: Trash2,
                  danger: true,
                  disabled: locked,
                  testId: "order-create-delete-draft",
                  onClick: () => onDelete(),
                },
              ]}
            />
          ) : (
            <Button
              size="xs"
              variant="outline"
              colorPalette="error"
              disabled={locked}
              data-testid="order-create-delete-draft"
              onClick={() => onDelete()}
            >
              <Icon as={Trash2} boxSize="4" />
              {t("orderForm.draft.delete")}
            </Button>
          )}
        </>
      )}
    </Flex>
  );
}
