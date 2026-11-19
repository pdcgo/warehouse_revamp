import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { formatRupiahNumber } from "../../lib/money";
import type {
  CustomShipment,
  CustomShipmentDraft,
  CustomShipmentKind,
  CustomShipmentLog,
  CustomShipmentPick,
  CustomShipmentStatus,
  ReshipOption,
} from "./customShipments";
import { reshipLeft } from "./customShipments";

// ⚠ THE CUSTOM SHIPMENTS' PROTOTYPE GATE — STORYBOOK ONLY (backlog #88, awaiting the owner's design accept).
//
// One provider that PLAYS THE SERVER in memory — the parcels, a sample's stock take, the reship options — in the assumed
// API's shape (customShipments.ts heads it), and answers the five screens: the selling team's *Kirim Paket* list, its
// create form and its detail; the warehouse's queue and its pick page. Live, nothing mounts it, so
// `useCustomShipmentPrototype()` is null and each page draws only a one-line "not available" — no route and no menu
// item reaches them (the shape of the restock tags' Storybook gate, backlog #87). On the accept, the build
// pass deletes this file: the proto gains the messages and RPCs, the pages read them through `features/customShipment/
// queries.ts`, and the routes and the menu lines are added where the owner placed them.

/** What a story hands the provider. */
export interface CustomShipmentsAnswer {
  shipments: CustomShipment[];
  reshipOptions: ReshipOption[];
  /**
   * The racks holding each team's product in each warehouse, OLDEST BATCH FIRST — what a sample's take draws, keyed
   * `${warehouseId}:${productId}`. The real take reads batches and placements; this is its answer, flattened.
   */
  shelves: Record<string, { rackId: bigint; rackCode: string; quantity: bigint }[]>;
  /** A unit's value at its batch, by product id — what a sample's line is worth (a-sample-is-a-stock-out-at-batch-value). */
  unitValue: Record<string, number>;
}

/** A write the screens would send — recorded for the stories, in the assumed RPCs' words. */
export type CustomShipmentCall =
  | { rpc: "CustomShipmentCreate"; draft: CustomShipmentDraft }
  | { rpc: "CustomShipmentCancel"; id: bigint }
  | { rpc: "CustomShipmentCostSet"; id: bigint; financeAccountId: bigint; shippingCost: number }
  | { rpc: "CustomShipmentPicked"; id: bigint }
  | { rpc: "CustomShipmentHandover"; id: bigint; shippingCost?: number; resi: string };

interface Played {
  shipments: CustomShipment[];
  reshipOptions: ReshipOption[];
  create: (draft: CustomShipmentDraft) => CustomShipment;
  cancel: (id: bigint) => boolean;
  costSet: (id: bigint, financeAccountId: bigint, shippingCost: number) => boolean;
  picked: (id: bigint) => boolean;
  handover: (id: bigint, shippingCost: number | undefined, resi: string) => boolean;
}

const CustomShipmentsContext = createContext<Played | null>(null);

const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

/** Mount the prototype. `actorUserId` is who the screens' writes are by; `onCall` hears every write (the recorder). */
export function CustomShipmentsPrototype({
  initial,
  actorUserId = 65n,
  onCall,
  children,
}: {
  initial: CustomShipmentsAnswer;
  actorUserId?: bigint;
  onCall?: (call: CustomShipmentCall) => void;
  children: ReactNode;
}) {
  const [shipments, setShipments] = useState<CustomShipment[]>(() => initial.shipments.map(copyOf));
  const [reshipOptions, setReshipOptions] = useState<ReshipOption[]>(() =>
    initial.reshipOptions.map((option) => ({ ...option, lines: option.lines.map((line) => ({ ...line })) })),
  );
  // The shelves as they stand — a take lowers them, a cancel puts the units back where they came from.
  const shelves = useRef(
    Object.fromEntries(Object.entries(initial.shelves).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))])),
  );
  const live = useRef(shipments);
  const nextId = useRef(initial.shipments.reduce((max, s) => (s.id > max ? s.id : max), 0n) + 1n);
  const nextLog = useRef(9000n);

  const commit = useCallback((next: CustomShipment[]) => {
    live.current = next;
    setShipments(next);
  }, []);

  const log = useCallback(
    (from: CustomShipmentLog["fromStatus"], to: CustomShipmentStatus, description = ""): CustomShipmentLog => {
      nextLog.current += 1n;

      return { id: nextLog.current, fromStatus: from, toStatus: to, actorUserId, atUnix: nowUnix(), isOverride: false, description };
    },
    [actorUserId],
  );

  // A reship's lines reserve their units on the restock line, so a second reship cannot send them again.
  const reserve = useCallback((restockId: bigint, lines: { restockItemId: bigint; quantity: bigint }[], sign: 1n | -1n) => {
    setReshipOptions((prev) =>
      prev.map((option) =>
        option.restockId !== restockId
          ? option
          : {
              ...option,
              lines: option.lines.map((line) => {
                const sent = lines.find((l) => l.restockItemId === line.restockItemId);

                return sent ? { ...line, alreadySent: line.alreadySent + sign * sent.quantity } : line;
              }),
            },
      ),
    );
  }, []);

  const create = useCallback(
    (draft: CustomShipmentDraft): CustomShipment => {
      onCall?.({ rpc: "CustomShipmentCreate", draft });

      const id = nextId.current;
      nextId.current += 1n;

      // A SAMPLE TAKES ITS STOCK NOW, the system picking the racks oldest batch first — it is recorded before anyone is
      // at the shelf (a-sample-names-the-rack-it-was-taken-from's principle row, as an order and a transfer out).
      const picks: CustomShipmentPick[] = [];
      if (draft.kind === "SAMPLE") {
        for (const line of draft.lines) {
          let wanted = line.quantity;
          for (const shelf of shelves.current[`${draft.warehouseId}:${line.productId}`] ?? []) {
            if (wanted === 0n) break;
            const take = shelf.quantity < wanted ? shelf.quantity : wanted;
            if (take === 0n) continue;
            shelf.quantity -= take;
            wanted -= take;
            picks.push({ productId: line.productId, rackId: shelf.rackId, rackCode: shelf.rackCode, quantity: take });
          }
        }
      } else {
        reserve(draft.restockId, draft.lines, 1n);
      }

      const items = draft.lines.map((line, i) => ({
        id: id * 100n + BigInt(i + 1),
        productId: line.productId,
        productCode: line.productCode,
        name: line.name,
        quantity: line.quantity,
        total: draft.kind === "SAMPLE" ? Number(line.quantity) * (initial.unitValue[line.productId.toString()] ?? 0) : 0,
        restockItemId: line.restockItemId,
        brokenNote: line.brokenNote,
      }));

      const shipment: CustomShipment = {
        id,
        teamId: draft.teamId,
        warehouseId: draft.warehouseId,
        kind: draft.kind,
        status: "REQUESTED",
        restockId: draft.restockId,
        supplierId: draft.supplierId,
        recipient: { ...draft.recipient },
        shipmentChannelId: draft.shipmentChannelId,
        payer: draft.payer,
        financeAccountId: draft.payer === "TEAM" ? draft.financeAccountId : 0n,
        shippingCost: draft.payer === "TEAM" ? draft.shippingCost : 0,
        resi: "",
        note: draft.note,
        items,
        picks,
        total: items.reduce((sum, item) => sum + item.total, 0),
        logs: [log("NONE", "REQUESTED")],
        createdByUserId: actorUserId,
        createdAtUnix: nowUnix(),
      };

      commit([shipment, ...live.current]);

      return shipment;
    },
    [actorUserId, commit, initial.unitValue, log, onCall, reserve],
  );

  const change = useCallback(
    (id: bigint, apply: (s: CustomShipment) => CustomShipment | null): boolean => {
      const found = live.current.find((s) => s.id === id);
      const next = found ? apply(found) : null;
      if (!found || !next) return false;

      commit(live.current.map((s) => (s.id === id ? next : s)));

      return true;
    },
    [commit],
  );

  // CANCEL — the selling team's, only while nobody has touched the goods: a sample's take is released onto the racks it
  // came from (as an order's cancel); a reship's units are free for another reship.
  const cancel = useCallback(
    (id: bigint) => {
      onCall?.({ rpc: "CustomShipmentCancel", id });

      return change(id, (s) => {
        if (s.status !== "REQUESTED") return null;

        if (s.kind === "SAMPLE") {
          for (const pick of s.picks) {
            const shelf = (shelves.current[`${s.warehouseId}:${pick.productId}`] ?? []).find((r) => r.rackId === pick.rackId);
            if (shelf) shelf.quantity += pick.quantity;
          }
        } else {
          reserve(s.restockId, s.items.map((item) => ({ restockItemId: item.restockItemId, quantity: item.quantity })), -1n);
        }

        return { ...s, status: "CANCELLED", logs: [...s.logs, log(s.status, "CANCELLED")] };
      });
    },
    [change, log, onCall, reserve],
  );

  // UBAH ONGKIR — *Kami bayar* only, until the handover: the account and the cost, as a transfer's Edit Cost. The trail
  // keeps a row whose from equals its to, saying what moved.
  const costSet = useCallback(
    (id: bigint, financeAccountId: bigint, shippingCost: number) => {
      onCall?.({ rpc: "CustomShipmentCostSet", id, financeAccountId, shippingCost });

      return change(id, (s) => {
        if (s.payer !== "TEAM" || (s.status !== "REQUESTED" && s.status !== "PICKED")) return null;

        const moved = `${formatRupiahNumber(s.shippingCost)} → ${formatRupiahNumber(shippingCost)}`;

        return { ...s, financeAccountId, shippingCost, logs: [...s.logs, log(s.status, s.status, moved)] };
      });
    },
    [change, log, onCall],
  );

  const picked = useCallback(
    (id: bigint) => {
      onCall?.({ rpc: "CustomShipmentPicked", id });

      return change(id, (s) =>
        s.status !== "REQUESTED" ? null : { ...s, status: "PICKED", logs: [...s.logs, log("REQUESTED", "PICKED")] },
      );
    },
    [change, log, onCall],
  );

  // THE HANDOVER — *Gudang bayar*: the cost the warehouse paid is REQUIRED (0 allowed) and owed back through Team
  // Balance; *Kami bayar*: no cost is taken, the team's stands.
  const handover = useCallback(
    (id: bigint, shippingCost: number | undefined, resi: string) => {
      onCall?.({ rpc: "CustomShipmentHandover", id, shippingCost, resi });

      return change(id, (s) => {
        if (s.status !== "PICKED") return null;
        if (s.payer === "WAREHOUSE" && shippingCost === undefined) return null;
        if (s.payer === "TEAM" && shippingCost !== undefined) return null;

        return {
          ...s,
          status: "HANDED_OVER",
          shippingCost: s.payer === "WAREHOUSE" ? shippingCost! : s.shippingCost,
          resi,
          logs: [...s.logs, log("PICKED", "HANDED_OVER")],
        };
      });
    },
    [change, log, onCall],
  );

  const value = useMemo(
    () => ({ shipments, reshipOptions, create, cancel, costSet, picked, handover }),
    [shipments, reshipOptions, create, cancel, costSet, picked, handover],
  );

  return <CustomShipmentsContext.Provider value={value}>{children}</CustomShipmentsContext.Provider>;
}

function copyOf(s: CustomShipment): CustomShipment {
  return {
    ...s,
    recipient: { ...s.recipient },
    items: s.items.map((item) => ({ ...item })),
    picks: s.picks.map((pick) => ({ ...pick })),
    logs: s.logs.map((row) => ({ ...row })),
  };
}

/** Which end of the parcel the current team is. */
export type CustomShipmentSide = "selling" | "warehouse";

export interface CustomShipmentListArgs {
  status?: CustomShipmentStatus;
  kind?: CustomShipmentKind;
  q: string;
  /** The selling list's warehouse filter — 0 = every warehouse. */
  warehouseId: bigint;
}

/** What a screen gets from the prototype — null live. */
export interface CustomShipmentsApi {
  side: CustomShipmentSide | null;
  /** The current team's parcels, newest first, narrowed as the list's one predicate would (the server's, in the build). */
  list: (args: CustomShipmentListArgs) => CustomShipment[];
  /** One parcel as the current team may read it, or null (another team's / another warehouse's reads as not found). */
  detail: (id: bigint) => CustomShipment | null;
  /** The team's problem restocks a reship can pick from (Diterima, *Barang rusak*), only lines with units left. */
  reshipOptions: ReshipOption[];
  create: (draft: CustomShipmentDraft) => CustomShipment;
  cancel: (id: bigint) => boolean;
  costSet: (id: bigint, financeAccountId: bigint, shippingCost: number) => boolean;
  picked: (id: bigint) => boolean;
  handover: (id: bigint, shippingCost: number | undefined, resi: string) => boolean;
}

// A WAREHOUSE READS NO SELLER MONEY (a-warehouse-sees-no-seller-money) and not the ongkir the team pays itself — *"dibayar
// selling kita tidak perlu tahu"* (the-warehouse-sees-the-ongkir-it-paid): the goods' value, the team's account and its
// cost are left unset for it, as the server will leave them.
function forWarehouse(s: CustomShipment): CustomShipment {
  return {
    ...s,
    total: 0,
    items: s.items.map((item) => ({ ...item, total: 0 })),
    financeAccountId: 0n,
    shippingCost: s.payer === "TEAM" ? 0 : s.shippingCost,
  };
}

export function useCustomShipmentPrototype(): CustomShipmentsApi | null {
  const played = useContext(CustomShipmentsContext);
  const { current } = useTeam();

  return useMemo(() => {
    if (!played) return null;

    const side: CustomShipmentSide | null =
      current?.teamType === TeamType.SELLING ? "selling" : current?.teamType === TeamType.WAREHOUSE ? "warehouse" : null;
    const teamId = current?.teamId ?? 0n;
    const mine = (s: CustomShipment) =>
      side === "selling" ? s.teamId === teamId : side === "warehouse" ? s.warehouseId === teamId : false;
    const read = (s: CustomShipment) => (side === "warehouse" ? forWarehouse(s) : s);

    return {
      side,
      list: ({ status, kind, q, warehouseId }) => {
        const needle = q.trim().toLowerCase();

        return played.shipments
          .filter(mine)
          .filter((s) => status === undefined || s.status === status)
          .filter((s) => kind === undefined || s.kind === kind)
          .filter((s) => warehouseId === 0n || s.warehouseId === warehouseId)
          .filter(
            (s) =>
              needle === "" ||
              `#${s.id}`.includes(needle) ||
              s.recipient.name.toLowerCase().includes(needle) ||
              s.items.some((item) => item.productCode.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle)),
          )
          .sort((a, b) => (a.createdAtUnix === b.createdAtUnix ? Number(b.id - a.id) : Number(b.createdAtUnix - a.createdAtUnix)))
          .map(read);
      },
      detail: (id) => {
        const found = played.shipments.find((s) => s.id === id && mine(s));

        return found ? read(found) : null;
      },
      reshipOptions:
        side === "selling"
          ? played.reshipOptions
              .filter((option) => option.teamId === teamId)
              .map((option) => ({ ...option, lines: option.lines.filter((line) => reshipLeft(line) > 0n) }))
              .filter((option) => option.lines.length > 0)
          : [],
      create: played.create,
      cancel: played.cancel,
      costSet: played.costSet,
      picked: played.picked,
      handover: played.handover,
    };
  }, [played, current?.teamId, current?.teamType]);
}
