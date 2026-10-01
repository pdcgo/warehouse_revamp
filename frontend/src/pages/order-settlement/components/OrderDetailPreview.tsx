import { useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "@bufbuild/protobuf";
import { Button, Flex, Heading, Icon, Spacer, Stack, Tabs } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import {
  OrderEventKind,
  OrderSchema,
  OrderStatus,
  type Order,
} from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge } from "../../../components/badges/OrderStatusBadge";
import { InfoPanel } from "../../order-detail/components/InfoPanel";
import { TimelinePanel } from "../../order-detail/components/TimelinePanel";
import { OrderLedgerPanel } from "./OrderLedgerPanel";
import type { EntryDraft } from "./AddEntryDialog";
import type { OrderSettlement, PostingRole } from "../model";

// THE SETTLEMENT LEDGER IN ITS REAL SEAT — `context.md` §What Frontend Expected 1:
// *"User can Manually add settlement entry from order detail page"*.
//
// ⚠ THIS IS A COPY OF THE ORDER DETAIL SHELL, NOT AN EDIT OF IT — and that is deliberate.
//
// `pages/order-detail/index.tsx` is a SHIPPED page on a live route (`/orders/:orderId`), reading a
// real order from a real server. Adding a Settlement tab to it before `design_accept` would put a
// fixture-fed prototype in front of anybody who opens a real order — a ledger showing money that does
// not exist, on a page that is otherwise true. The gate exists precisely so that a rejected design
// costs the prototype and nothing else.
//
// So this file rebuilds the shell — the back button, the header, the vertical tabs — and mounts the
// REAL `InfoPanel` and `TimelinePanel` beside the prototype ledger. Info and Timeline are the actual
// shipped components, so what the owner previews is the real page with one tab added, not a drawing
// of it. The only invented part is the tab under review.
//
// ⚠ WHEN THE DESIGN IS ACCEPTED, THIS FILE DIES. The third tab moves into
// `pages/order-detail/index.tsx` and this shell is deleted — it must never become a second order
// detail page that drifts from the first.
export interface OrderDetailPreviewProps {
  settlement: OrderSettlement;
  /** Whether this viewer may add or reverse rows — `the-write-set-is-cs-and-up`. */
  canPost?: boolean;
  /** Which of the write set. Only decides whether the sale figure is offered on the form. */
  role?: PostingRole;
  /** Which tab opens. `settlement` is the point of the preview, so it is the default. */
  defaultTab?: "info" | "timeline" | "settlement";
  onAddEntry?: (draft: EntryDraft) => void;
  today?: string;
}

export function OrderDetailPreview({
  settlement,
  canPost = true,
  role = "team_admin",
  defaultTab = "settlement",
  onAddEntry,
  today = "2026-01-10",
}: OrderDetailPreviewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const order = orderFor(settlement);

  return (
    <Stack gap="section" data-testid="order-detail-preview">
      <Button size="xs" variant="ghost" alignSelf="flex-start">
        <Icon as={ArrowLeft} boxSize="4" />
        {t("orders.backToOrders")}
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md" data-testid="preview-title">
          {t("orders.orderTitle", { id: order.id.toString() })}
        </Heading>
        <OrderStatusBadge status={order.status} />
        <Spacer />
      </Flex>

      {/* THE TAB GOES THIRD, and the order is an argument. Info is what the order IS and Timeline is
          what has happened to it — both are settled by the time the money starts arriving. Settlement
          is the only tab that keeps changing for days after the order is otherwise finished
          (`a-residual-balance-is-normal`), so it reads last: the record, then its history, then what
          it actually earned. */}
      <Tabs.Root defaultValue={defaultTab} orientation="vertical" data-testid="preview-tabs">
        <Tabs.List minW="40">
          <Tabs.Trigger value="info" data-testid="preview-tab-info">
            {t("orders.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline" data-testid="preview-tab-timeline">
            {t("orders.detail.tab.timeline")}
          </Tabs.Trigger>
          <Tabs.Trigger value="settlement" data-testid="preview-tab-settlement">
            {t("orderSettlement.tab")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* minW="0" on every panel — a vertical Tabs.Root is a flex ROW, and without it the wide
            tables inside widen the panel instead of scrolling within it. Same reason as the real
            page. */}
        <Tabs.Content value="info" flex="1" minW="0">
          <InfoPanel order={order} teamId={12n} />
        </Tabs.Content>

        <Tabs.Content value="timeline" flex="1" minW="0">
          <TimelinePanel order={order} actorFallback={() => ""} />
        </Tabs.Content>

        <Tabs.Content value="settlement" flex="1" minW="0">
          <OrderLedgerPanel
            settlement={settlement}
            canPost={canPost}
            role={role}
            today={today}
            onAddEntry={(draft) => {
              setEntries((prev) => [...prev, draft]);
              onAddEntry?.(draft);
            }}
          />
          {/* The prototype writes nothing, so a submitted draft is surfaced here rather than
              vanishing — the story asserts on it, and a person clicking through can see that the
              form produced the signed figure it promised. */}
          {entries.length > 0 && (
            <Stack gap="1" mt="card" data-testid="preview-drafts">
              {entries.map((draft, i) => (
                <div key={i} data-testid="preview-draft">
                  {draft.settlementType}:{String(draft.change)}:{draft.occurredOn}
                </div>
              ))}
            </Stack>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

// ── The order behind the settlement ─────────────────────────────────────────────────────────────
//
// ⚠ `marketplaceTotal` IS `initialTotal`, and the preview exists partly to make that visible.
// `the-sale-is-recorded-once-and-copied-verbatim` says settlement opens its account from a frozen
// copy of `order.marketplace_total` — so the figure the Info tab prints as "Marketplace total" and
// the figure the Settlement tab measures every loss against are the SAME NUMBER seen twice. On one
// screen, a disagreement between them is a bug anybody can spot.
//
// `total` is ours and `marketplaceTotal` is the platform's, and they differ on purpose: the buyer
// pays the platform's figure, we quoted our own. Neither is wrong.
function orderFor(settlement: OrderSettlement): Order {
  return create(OrderSchema, {
    id: settlement.orderId,
    teamId: 12n,
    shopId: 21n,
    warehouseId: 11n,
    status: OrderStatus.SHIPPED,
    customerName: "Bu Ani",
    customerPhone: "0812-3456-0001",
    shippingCode: "jne",
    orderExternalRefId: settlement.orderRef,
    subtotal: settlement.initialTotal > 0n ? settlement.initialTotal - 15_000n : 0n,
    shippingCost: 15_000n,
    total: settlement.initialTotal,
    marketplaceTotal: settlement.initialTotal,
    cogs: settlement.cogs,
    note: "",
    items: [
      {
        id: 1n,
        productId: 301n,
        sku: "SKU-301",
        name: "Kaos Polos Hitam",
        quantity: 2,
        unitPrice: settlement.initialTotal > 0n ? (settlement.initialTotal - 15_000n) / 2n : 0n,
        unitCost: settlement.cogs / 2n,
      },
    ],
    events: [
      { id: 1n, kind: OrderEventKind.PLACED, actorUserId: 61n, atUnix: 1_767_225_600n },
      { id: 2n, kind: OrderEventKind.CONFIRMED, actorUserId: 62n, atUnix: 1_767_232_800n },
      { id: 3n, kind: OrderEventKind.SHIPPED, actorUserId: 62n, atUnix: 1_767_312_000n },
    ],
    createdAtUnix: 1_767_225_600n,
  });
}
