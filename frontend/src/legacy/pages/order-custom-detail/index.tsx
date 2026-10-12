import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Ban, CircleCheck, Pencil } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { PriceText } from "../../components/text/PriceText";
import { DateText } from "../../components/text/DateText";
import { RefIdBadge } from "../../components/badges/RefIdBadge";
import type { OrderLine, OrderRow } from "../../fixtures";
import { OrderStatusBadge } from "../_orders/OrderStatusBadge";

// One custom order.
//
// What distinguishes it from the marketplace order detail is the NOTE. A hand-raised order has no
// marketplace record behind it to explain itself, so the reason it exists lives only in whatever the
// person typed when they raised it — and that reason is what somebody reconciling the books three
// weeks later is actually looking for.
//
// So the note is displayed prominently rather than as a field among fields, and an order with no
// note says so plainly instead of leaving a blank where the explanation should be.
export const description =
  "One hand-raised order. The NOTE is prominent, because a custom order has no marketplace record to explain itself — the reason it exists is only whatever was typed when it was raised.";

export interface OrderCustomDetailPageProps {
  order: OrderRow;
  lines: OrderLine[];
  source?: string;
  raisedBy?: string;
  note?: string;
}

export function OrderCustomDetailPage({
  order,
  lines,
  source = "Phone",
  raisedBy = "Ani Rahayu",
  note,
}: OrderCustomDetailPageProps) {
  const columns: Array<TableColumn<OrderLine>> = [
    {
      name: "Product",
      render: (line) => (
        <Stack gap="1" lineHeight="short">
          <Text fontWeight="medium">{line.productName}</Text>
          <RefIdBadge refId={line.refId} />
        </Stack>
      ),
    },
    { name: "Qty", key: "qty", align: "end" },
    { name: "Price", align: "end", render: (line) => <PriceText amount={line.price} /> },
  ];

  return (
    <Stack gap="section" data-testid="order-custom-detail-page">
      <Breadcrumb
        items={[{ href: "/order-customs", name: "Custom orders" }, { name: order.code }]}
      />

      <HStack justify="space-between" wrap="wrap" gap="card">
        <HStack gap="3">
          <Heading size="md">{order.code}</Heading>
          <OrderStatusBadge status={order.status} />
        </HStack>
        <HStack gap="2">
          <Button tone="plain" variant="outline" icon={Pencil}>
            Edit
          </Button>
          <Button tone="success" variant="subtle" icon={CircleCheck}>
            Complete
          </Button>
          <Button tone="error" variant="subtle" icon={Ban}>
            Cancel
          </Button>
        </HStack>
      </HStack>

      {/* The note, first and prominent — it is the only record of WHY this order exists. */}
      {note ? (
        <Alert tone="info" title="Why this order was raised" data-testid="custom-note-shown">
          {note}
        </Alert>
      ) : (
        <Alert tone="warning" data-testid="custom-note-missing">
          No note was left. Nobody reconciling this later will know why it was raised by hand.
        </Alert>
      )}

      <Card>
        <HStack gap="section" wrap="wrap">
          <Stack gap="0.5" minW="40">
            <Text fontSize="xs" color="fg.muted">
              Buyer
            </Text>
            <Text>{order.customer}</Text>
          </Stack>
          <Stack gap="0.5" minW="32">
            <Text fontSize="xs" color="fg.muted">
              Source
            </Text>
            <Text>{source}</Text>
          </Stack>
          <Stack gap="0.5" minW="32">
            <Text fontSize="xs" color="fg.muted">
              Raised by
            </Text>
            <Text>{raisedBy}</Text>
          </Stack>
          <Stack gap="0.5" minW="40">
            <Text fontSize="xs" color="fg.muted">
              Raised
            </Text>
            <DateText value={order.createdAt} variant="datetime" />
          </Stack>
        </HStack>
      </Card>

      <DataTable columns={columns} items={lines} size="sm" aria-label="Order lines" />

      <Card>
        <HStack justify="flex-end" gap="6">
          <Text color="fg.muted">Total</Text>
          <PriceText amount={order.total} fontSize="lg" fontWeight="black" />
        </HStack>
      </Card>
    </Stack>
  );
}
