import type { ReactNode } from "react";
import { Badge, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";

import { ShopItem } from "../../components/entity/ShopItem";
import { TeamItem } from "../../components/entity/TeamItem";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import {
  formatMarginPct,
  orderMargin,
  orderMarginPct,
  orderSpend,
} from "./margin";
import type { Urgency } from "./deadlineMock";
import { deadlineUrgency, hoursFromNow } from "./deadlineMock";
import { CopyText } from "../../components/chrome/CopyText";

// THE CELLS THE ORDER TABLE HAS NO SHARED COMPONENT FOR.
//
// TWO RULES FROM THE OWNER GOVERN EVERY ONE OF THEM (2026-09-28):
//
//   1. NO CELL IS MORE THAN TWO LINES. A three-line cell made the whole table read as dense, and one
//      row of the table should be one row of reading.
//   2. ONE CONTEXT PER CELL. Pairing is for ONE FACT READ TWICE, never for two questions — Toko and
//      Gudang were paired and that was wrong.
//
// ⚠ WHAT COUNTS AS "ONE FACT" IS THE OWNER'S CALL, AND IT MOVED THREE TIMES. The pairs now are:
//
//   `#109`                               alone, in its own column — it is not a pair
//   `LZ-4471955` / `Diproses`            the marketplace's name for the order, and where it has got to
//   `27 Sep 16:05` / `3 hari lagi`       the marketplace's clock: when they ordered, when it must ship
//   `Rp 258.000` / `Rp 92.720 · 35,9%`   what the platform paid, and what is left of it
//   `27 Sep 17:19` / `oleh Budi`         the creation: when we wrote it down, and who did
//
// The margin sits under TOTAL MP rather than under Beli because it is measured against that figure
// (`margin = harga MP − total beli`) — under Beli it looked like a share of the cost.
//
// ⚠ AN ABSENT FACT IN A ONE-LINE CELL RENDERS AN EM-DASH; an absent SECOND line renders nothing. A
// whole empty cell needs a mark or the column reads as broken; a missing half-cell is silence. A
// column of dashes down twenty rows is what trains people to stop reading a field.

/** A quiet second line under a cell's headline. */
function Under({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Text fontSize="xs" color="fg.muted" lineClamp={1} data-testid={testId}>
      {children}
    </Text>
  );
}

/** An em-dash for a one-line cell with nothing in it. */
function Nothing({ testId }: { testId?: string }) {
  return (
    <Text color="fg.subtle" data-testid={testId}>
      —
    </Text>
  );
}

/**
 * THE MARKETPLACE'S NAME FOR THE ORDER, and where it has got to.
 *
 * ⚠ THE STATUS LIVES HERE (owner: *"status di bawah order_id"*), not in a column of its own. It had one
 * briefly — the complaint that moved it out of the old `#id` cell was that the badges did not line up
 * down the page, and under the reference they do: this is line 2 on every row, whether or not line 1
 * has anything in it.
 *
 * ⚠ THE REFERENCE IS COPYABLE (owner). It is pasted into the platform's own dashboard, so it is carried
 * rather than read — see `CopyText`.
 *
 * "" renders an em-dash, not an empty `()`: an order taken over the phone has no marketplace reference
 * and never will (`order.proto`).
 */
export function OrderRefCell({
  orderRefId,
  statusBadge,
}: {
  orderRefId: string;
  statusBadge?: ReactNode;
}) {
  const value = orderRefId.trim();

  return (
    <Stack gap="0.5" minW="0" align="start">
      {value === "" ? (
        <Nothing testId="order-ref-none" />
      ) : (
        <CopyText value={value} testId="order-ref" />
      )}

      {statusBadge}
    </Stack>
  );
}

/**
 * THE COURIER'S TRACKING NUMBER — one line, and **every order has one** (owner: *"resi pasti ada"*).
 *
 * ⚠ IT IS NOT ISSUED AT HANDOVER, which an earlier version assumed. The marketplace prints the label
 * when the order is confirmed, so the number exists while the parcel is still on the shelf — which is
 * why the owner's action table offers *Edit Resi* on `created` and `process`.
 *
 * ⚠ COPYABLE, and the reason is the strongest of any field here: this is what a buyer chasing a parcel
 * quotes, and retyping thirteen characters is how the wrong parcel gets chased.
 */
export function ReceiptCell({ code }: { code?: string }) {
  const value = (code ?? "").trim();

  if (value === "") {
    return <Nothing testId="order-receipt-none" />;
  }

  return <CopyText value={value} mono testId="order-receipt" />;
}

/**
 * WHOSE ORDER THIS IS — one name.
 *
 * ⚠ ONE POSITION, ONE QUESTION, TWO ANSWERS. Only a SELLING team owns shops, so only there does a shop
 * name tell two rows apart. A warehouse sees many sellers' orders and holds no shops; root and admin
 * see everyone's. For all three the useful headline is the TEAM that sold it, and a Shop column would
 * be blank on every row.
 */
export function OwnerCell({
  shop,
  team,
}: {
  /** Resolved shop, for a selling team's list. `undefined` when the reader is not one. */
  shop?: { name?: string; marketplace?: Marketplace; shopId?: bigint };
  /** Resolved team, for every other reader. */
  team?: { teamName?: string; teamType?: TeamType; teamId?: bigint };
}) {
  if (team) {
    return <TeamItem team={team} />;
  }

  if (shop) {
    return <ShopItem shop={shop} />;
  }

  return <Nothing testId="order-owner-none" />;
}

/**
 * WHEN WE WROTE IT DOWN, and WHO — one event, so one cell.
 *
 * ⚠ THE SYSTEM'S DATE LEADS (owner) and it is the only real thing here: `Order` records no creator at
 * all, so the second line is mocked (`rowMock`).
 */
export function CreatedCell({ unix, by }: { unix: bigint; by?: string }) {
  const { t } = useTranslation();
  const author = (by ?? "").trim();

  return (
    <Stack gap="0.5" minW="0">
      <Text whiteSpace="nowrap" data-testid="order-placed-at">
        {formatUnixDateTime(unix)}
      </Text>

      {author !== "" && (
        <Under testId="order-placed-by">{t("orders.placedBy", { name: author })}</Under>
      )}
    </Stack>
  );
}

/**
 * THE MARKETPLACE'S CLOCK — when the buyer ordered, and when it has to be out (owner: *"deadline di
 * bawah tgl mp saja"*).
 *
 * ⚠ THE PAIRING IS CAUSAL, not just convenient: the ship-by window RUNS FROM the storefront's order
 * time, so the second line is the first plus the platform's SLA. That is what makes them one fact read
 * twice rather than two things sharing a cell — which is where the deadline sat for one round, under
 * the resi, until it was clear the resi exists from the start and answers a different question.
 *
 * ⚠ BOTH HALVES ARE INVENTED, for different reasons: `mp_created` has no field at all, and no deadline
 * exists anywhere in the contract. Two marks, on this one header.
 */
export function MpDateCell({ unix, deadline }: { unix?: bigint; deadline?: bigint }) {
  const has = unix !== undefined && unix > 0n;
  const hasDeadline = deadline !== undefined && deadline > 0n;

  return (
    <Stack gap="0.5" minW="0" align="start">
      {has ? (
        <Text whiteSpace="nowrap" data-testid="order-placed-mp">
          {formatUnixDateTime(unix)}
        </Text>
      ) : (
        <Nothing testId="order-placed-mp-none" />
      )}

      {hasDeadline && <DeadlineCell unix={deadline} />}
    </Stack>
  );
}

/**
 * A DATE ON ITS OWN — the status-transition date.
 *
 * ⚠ THE SHAPE EXISTS AND THE LIST CANNOT READ IT. `OrderEvent` is already `kind` + `at_unix`, which is
 * exactly this, but events are populated by `OrderDetail` only.
 */
export function DateCell({ unix, testId }: { unix?: bigint; testId?: string }) {
  if (unix === undefined || unix <= 0n) {
    return <Nothing testId={testId ? `${testId}-none` : undefined} />;
  }

  return (
    <Text whiteSpace="nowrap" data-testid={testId}>
      {formatUnixDateTime(unix)}
    </Text>
  );
}

/**
 * TOTAL BELI — what the order cost us, on one line.
 *
 * ```
 * total beli = subtotal produk (the COST) + biaya (the warehouse's fee)
 * ```
 *
 * ⚠ THE FEE HALF IS A SAMPLE. Nothing carries a warehouse fee per order: it is a liability row keyed by
 * `source_id = order id`, and `LiabilityLogListFilter` takes a counterparty and nothing else.
 *
 * ⚠ A `cogs` OF 0 IS UNKNOWN, NOT FREE (`order.proto`), so the cell refuses rather than printing a
 * fee-only figure that would read as a suspiciously cheap order.
 */
export function SpendCell({ cogs, fees }: { cogs: bigint; fees: bigint }) {
  const spend = orderSpend(cogs, fees, cogs > 0n);

  return (
    <Text whiteSpace="nowrap" data-testid="order-spend">
      {spend === null ? "—" : formatRupiah(spend)}
    </Text>
  );
}

/**
 * WHAT THE STOREFRONT TOOK, and WHAT IS LEFT OF IT (owner: *"margin ikut total mp saja"*).
 *
 * ```
 * margin     = harga MP − total beli
 * persentase = margin ÷ harga MP
 * ```
 *
 * ⚠ THE MARGIN BELONGS UNDER THIS FIGURE, NOT UNDER BELI, because this is what it is measured against.
 * Under Beli the percentage read as a share of the cost — a mark-up, which is a different number that
 * looks the same.
 *
 * ⚠ IT NEEDS TWO FACTS, SO IT HAS TWO WAYS TO BE UNKNOWN. A `marketplace_total` of 0 is NOT RECORDED,
 * not a sale of nothing, and a `cogs` of 0 is unknown rather than free — either one missing and the
 * margin refuses. A full-price order with no recorded platform payment would otherwise read as −100%.
 */
export function MpTotalCell({
  marketplaceTotal,
  cogs,
  fees,
}: {
  marketplaceTotal: bigint;
  cogs: bigint;
  fees: bigint;
}) {
  const spend = orderSpend(cogs, fees, cogs > 0n);
  const margin = orderMargin(marketplaceTotal, spend);
  const pct = formatMarginPct(orderMarginPct(marketplaceTotal, spend));

  return (
    <Stack gap="0.5" minW="0" align="end">
      {marketplaceTotal > 0n ? (
        <Text whiteSpace="nowrap" data-testid="order-total-mp">
          {formatRupiah(marketplaceTotal)}
        </Text>
      ) : (
        <Nothing testId="order-total-mp-none" />
      )}

      {margin !== null && (
        <Under testId="order-margin">
          {formatRupiah(margin)}
          {pct !== null && ` · ${pct}`}
        </Under>
      )}
    </Stack>
  );
}

const URGENCY_STYLE: Record<Urgency, { palette: string; solid: boolean }> = {
  overdue: { palette: "error", solid: true },
  urgent: { palette: "warning", solid: true },
  today: { palette: "warning", solid: false },
  later: { palette: "gray", solid: false },
};

/**
 * WHEN IT HAS TO BE OUT — and it is meant to be LOUD (owner: *"jika order punya deadline aku ingin dia
 * mencolok"*).
 *
 * ⚠ THE COLOUR IS A ROLE, NEVER A HUE — `error` / `warning`, so a palette change reaches it. This is
 * also the one place on the row where those roles are EARNED: every other cell states a fact about the
 * order, while this one is the app telling somebody to act.
 *
 * Four bands, because "late" and "late by four days" are not the same news:
 *
 * | band | when | how it reads |
 * | --- | --- | --- |
 * | overdue | past | SOLID error, and the row is tinted behind it |
 * | urgent | within 6 hours | SOLID warning |
 * | today | within 24 hours | quiet warning |
 * | later | beyond that | plain, in the gray of any other date |
 *
 * ⚠ NO ORDER HAS A DEADLINE FIELD. Every figure here is invented (`deadlineMock`) and the column
 * carries a mark. What it stands in for is the marketplace's ship-by clock, which is per storefront.
 */
export function DeadlineCell({ unix }: { unix: bigint }) {
  const { t } = useTranslation();

  const hours = hoursFromNow(unix);
  const band = deadlineUrgency(hours);
  const style = URGENCY_STYLE[band];

  // Whole hours under a day, whole days above it. "4 hari lagi" is what somebody plans around; "97 jam
  // lagi" is a number they would have to divide first.
  //
  // ⚠ REMAINING TIME ROUNDS DOWN AND LATENESS ROUNDS UP — never the other way. `Math.round` on 36 hours
  // left reads "2 days", which is time the person does not have; on 36 hours late it reads "1 day",
  // which is less trouble than they are in. Both errors point the same way, and it is the wrong way.
  const away = Math.abs(hours);
  const whole = hours < 0 ? Math.ceil : Math.floor;
  const amount = away < 24 ? Math.max(1, whole(away)) : Math.max(1, whole(away / 24));
  const unit = away < 24 ? "hours" : "days";
  const label = t(`orders.deadline.${band === "overdue" ? "late" : "left"}.${unit}`, {
    count: amount,
  });

  if (band === "later") {
    return (
      <Under testId="order-deadline">
        <span title={formatUnixDateTime(unix)}>{label}</span>
      </Under>
    );
  }

  return (
    <Badge
      colorPalette={style.palette}
      variant={style.solid ? "solid" : "subtle"}
      size="sm"
      gap="1"
      whiteSpace="nowrap"
      title={formatUnixDateTime(unix)}
      data-testid="order-deadline"
      data-urgency={band}
    >
      <Icon as={Clock} boxSize="3" />
      {label}
    </Badge>
  );
}
