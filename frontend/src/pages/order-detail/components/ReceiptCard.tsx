import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";

import { documentClient, rpcError } from "../../../api/clients";
import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { toaster } from "../../../components/feedback/Toaster";

// The shipping receipt attached to the order, when one was — the courier's slip or the marketplace's
// PDF. Stays a CARD in the Info tab rather than becoming a Documents tab of its own (owner): an order
// has exactly one attachment today, and a tab holding one row is a click in front of a single fact.
//
// A PRIVATE document, so there is nothing to render inline from a stored URL — the row names the file
// and opens it through a short-lived signed URL fetched on the click.
export function ReceiptCard({ order, teamId }: { order: Order; teamId: bigint | undefined }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  // The URL is fetched at the moment somebody asks for it rather than when the page loads. Resolving
  // it up front would mean a link that quietly expires while the page sits open, and a signed URL
  // minted for every order anybody merely looked at.
  async function openReceipt() {
    const documentId = order.receipt?.documentId;

    if (teamId === undefined || !documentId) return;

    setOpening(true);

    try {
      const res = await documentClient.getDownloadUrl({ teamId, documentId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setOpening(false);
    }
  }

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            {t("orders.receipt")}
          </Text>
          <Flex align="center" gap="2" data-testid="order-detail-receipt">
            <Icon
              as={order.receipt?.mimeType === "application/pdf" ? FileText : ImageIcon}
              boxSize="4"
              color="fg.muted"
            />
            <Text fontSize="sm" lineClamp={1} flex="1">
              {order.receipt?.filename}
            </Text>
            <Button
              size="xs"
              variant="outline"
              loading={opening}
              data-testid="order-receipt-open"
              onClick={() => void openReceipt()}
            >
              <Icon as={ExternalLink} boxSize="4" />
              {t("orders.receiptOpen")}
            </Button>
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
