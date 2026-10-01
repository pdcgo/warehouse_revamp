import { Heading, HStack, Separator, Stack, Text } from "@chakra-ui/react";
import { Ban, CircleCheck, Pencil, RotateCcw, Truck } from "lucide-react";
import { DateText } from "../../components/text/DateText";
import { PriceText } from "../../components/text/PriceText";
import { ShopText } from "../../components/text/ShopText";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { CopyText } from "../../components/text/CopyText";
import { RefIdBadge } from "../../components/badges/RefIdBadge";
import type { OrderLine, OrderRow, OrderTimelineEntry } from "../../fixtures";
import { OrderStatusBadge } from "../_orders/OrderStatusBadge";

// The order detail — the one place in the order family that IS a page rather than a panel.
//
// It earns the route because it is a DESTINATION, not a step: it is what a link in a chat message
// points at when someone asks "what happened to 4471", and it is what gets opened from a courier's
// tracking complaint. Those arrive from outside the app, so the screen has to be addressable.
//
// The layout puts the TIMELINE beside the lines rather than under them. "What happened to this
// order" is answered by the timeline, and burying it below a variable-length item table means
// scrolling past the part you did not come for.
export const description =
  "One order, as a real page — it is a destination people link to from outside the app. The timeline sits beside the lines, because 'what happened' is the question that brought them here.";

export interface OrderDetailPageProps {
  order: OrderRow;
  lines: OrderLine[];
  timeline: OrderTimelineEntry[];
}

export function OrderDetailPage({ order, lines, timeline }: OrderDetailPageProps) {
  const columns: Array<TableColumn<OrderLine>> = [
    {
      name: "Product",
      render: (line) => (
        <Stack gap="1" lineHeight="short">
          <Text fontWeight="medium">{line.productName}</Text>
          <HStack gap="1.5">
            <RefIdBadge refId={line.refId} />
            <Text fontSize="xs" color="fg.muted">
              {line.variant}
            </Text>
          </HStack>
        </Stack>
      ),
    },
    { name: "Qty", key: "qty", align: "end" },
    { name: "Price", align: "end", render: (line) => <PriceText amount={line.price} /> },
    {
      name: "Subtotal",
      align: "end",
      render: (line) => <PriceText amount={line.price * BigInt(line.qty)} fontWeight="medium" />,
    },
  ];

  return (
    <Stack gap="section" data-testid="order-detail-page">
      <Breadcrumb
        items={[
          { href: "/orders", name: "Orders" },
          { name: order.code },
        ]}
      />

      <HStack justify="space-between" wrap="wrap" gap="card">
        <HStack gap="3">
          <Heading size="md">{order.code}</Heading>
          <OrderStatusBadge status={order.status} />
        </HStack>

        {/* The state transitions, inline rather than behind a kebab. On the detail page there is room,
            and these are the reason somebody opened it. */}
        <HStack gap="2" wrap="wrap">
          <Button tone="plain" variant="outline" icon={Pencil}>
            Edit
          </Button>
          <Button tone="info" variant="subtle" icon={Truck}>
            Mark shipped
          </Button>
          <Button tone="success" variant="subtle" icon={CircleCheck}>
            Finish
          </Button>
          <Button tone="warning" variant="subtle" icon={RotateCcw}>
            Return
          </Button>
          <Button tone="error" variant="subtle" icon={Ban}>
            Cancel
          </Button>
        </HStack>
      </HStack>

      <HStack align="flex-start" gap="section" wrap="wrap">
        <Stack flex="2" minW="80" gap="section">
          <Card>
            <Stack gap="card">
              <Text fontWeight="medium">Customer &amp; shipping</Text>
              <HStack gap="section" wrap="wrap" align="flex-start">
                <Stack gap="0.5" minW="40">
                  <Text fontSize="xs" color="fg.muted">
                    Customer
                  </Text>
                  <Text>{order.customer}</Text>
                </Stack>
                <Stack gap="0.5" minW="40">
                  <Text fontSize="xs" color="fg.muted">
                    Shop
                  </Text>
                  <ShopText name={order.shopName} marketplace={order.marketplace} />
                </Stack>
                <Stack gap="0.5" minW="40">
                  <Text fontSize="xs" color="fg.muted">
                    Courier
                  </Text>
                  <Text>{order.courier}</Text>
                </Stack>
                <Stack gap="0.5" minW="40">
                  <Text fontSize="xs" color="fg.muted">
                    Receipt
                  </Text>
                  {order.receipt ? (
                    <CopyText copyText={order.receipt} label="Copy receipt">
                      <Text>{order.receipt}</Text>
                    </CopyText>
                  ) : (
                    <Text color="fg.subtle">not yet issued</Text>
                  )}
                </Stack>
              </HStack>
            </Stack>
          </Card>

          <DataTable columns={columns} items={lines} size="sm" aria-label="Order lines" />

          <Card>
            <HStack justify="flex-end" gap="6">
              <Text color="fg.muted">Order total</Text>
              <PriceText amount={order.total} fontSize="lg" fontWeight="black" />
            </HStack>
          </Card>
        </Stack>

        {/* Beside, not below — the timeline is what most visitors came for. */}
        <Stack flex="1" minW="64">
          <Card>
            <Stack gap="card" data-testid="order-timeline">
              <Text fontWeight="medium">Timeline</Text>
              {timeline.map((entry, i) => (
                <Stack key={i} gap="0.5">
                  {i > 0 && <Separator />}
                  <HStack justify="space-between" gap="2">
                    <Text fontSize="sm" fontWeight="medium">
                      {entry.label}
                    </Text>
                    <DateText value={entry.at} variant="relative" fontSize="xs" color="fg.muted" />
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    {entry.actor}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </Text>
                </Stack>
              ))}
            </Stack>
          </Card>
        </Stack>
      </HStack>
    </Stack>
  );
}
