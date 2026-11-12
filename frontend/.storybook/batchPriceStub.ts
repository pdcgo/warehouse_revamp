// INVENTORYSERVICE.BATCHREVALUE as Storybook's stub — Koreksi Harga (the-correct-price-prototype-is-accepted), answered
// as inventory_v1/batch_revalue.go does, over the batch stubs' own rows: the warehouse's (batchStub.ts) and the owner's
// sample (productStub.ts). It writes batchPriceScenario.ts, which both stubs price their reads from, so the live reads
// — the warehouse's batch page and the owner's product page — show what a correction did.
//
// The rules it plays, each the server's:
//   who            Root, the Administrator, the owning team's Owner or Admin — anyone else PermissionDenied (the policy)
//   whose          the batch must be the scoped team's own — another team's NotFound (a-batch-carries-its-owner)
//   the reason     required (spaces are none), at most 200 — InvalidArgument
//   the price      finite and above 0 — InvalidArgument (a-corrected-price-is-above-zero)
//   no units left  FailedPrecondition — a correction changes only the units left
//   moved since    FailedPrecondition — the price the form showed is no longer the batch's (someone corrected it)
//   the same price FailedPrecondition — nothing to correct
// and what it writes: the batch's price, its units left's value by units × the difference (batch.md §Change Price Flow),
// and one history row that moved no unit, with the reason and who — stamped an override when Root or the Administrator
// acted outside the owning team (an-override-is-stamped-in-every-service).

import { Code, ConnectError } from "@connectrpc/connect";

import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { batchForPrice } from "./batchStub";
import { batchPriceScenario, type PriceLog } from "./batchPriceScenario";
import { products, users } from "./fixtures";
import { sampleBatchForPrice } from "./productStub";
import { sessionScenario } from "./sessionScenario";

const REASON_MAX = 200;
const SAME = 0.00005;
const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

/** A batch's facts, from whichever stub holds it — the warehouse's first, then the owner's sample. */
function factsOf(batchId: bigint) {
  const held = batchForPrice(batchId);
  // Whose goods: the product's team, as the batch page resolves its owner (a-batch-carries-its-owner).
  if (held) return { ...held, teamId: products.find((p) => p.id === held.productId)?.teamId ?? 0n };
  return sampleBatchForPrice(batchId);
}

function mayCorrect(role: Role): boolean {
  return role === Role.ROOT || role === Role.ADMINISTRATOR || role === Role.SELLING_OWNER || role === Role.SELLING_ADMIN;
}

/** Root or the Administrator, acting in a team they hold no role in. */
function isOverride(teamId: bigint): boolean {
  const { role, memberOf } = sessionScenario;
  return (role === Role.ROOT || role === Role.ADMINISTRATOR) && memberOf !== null && !memberOf.includes(teamId);
}

/** The server's words for a figure (san_money.Text): "Rp 45.700". */
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 3 })}`;

let nextId = 990_001n;

function record(input: Omit<PriceLog, "id">): PriceLog {
  const log = { ...input, id: nextId++ };
  batchPriceScenario.logs.push(log);
  batchPriceScenario.prices.set(log.batchId.toString(), log.to);
  return log;
}

export function batchRevalue(req: {
  teamId: bigint;
  batchId: bigint;
  expectedPriceUnit: number;
  newPriceUnit: number;
  reason: string;
}) {
  batchPriceScenario.calls.push({
    batchId: req.batchId,
    teamId: req.teamId,
    expectedPrice: req.expectedPriceUnit,
    newPrice: req.newPriceUnit,
    reason: req.reason,
  });

  if (!mayCorrect(sessionScenario.role)) {
    throw new ConnectError("permission denied", Code.PermissionDenied);
  }

  const reason = req.reason.trim();
  if (reason === "") throw new ConnectError("a price correction needs a reason", Code.InvalidArgument);
  if (reason.length > REASON_MAX) throw new ConnectError("the reason is at most 200 characters", Code.InvalidArgument);
  if (!Number.isFinite(req.newPriceUnit) || !(req.newPriceUnit > 0)) {
    throw new ConnectError("the new unit price must be above Rp 0", Code.InvalidArgument);
  }

  const b = factsOf(req.batchId);
  if (!b || b.teamId !== req.teamId) throw new ConnectError("batch not found", Code.NotFound);

  if (b.units <= 0n) {
    throw new ConnectError(
      `batch #${req.batchId} has no units left — a price correction changes only the units left`,
      Code.FailedPrecondition,
    );
  }
  if (Math.abs(b.price - req.expectedPriceUnit) >= SAME) {
    throw new ConnectError(
      `batch #${req.batchId}'s price changed to ${rupiah(b.price)} since the form opened — check it and correct again`,
      Code.FailedPrecondition,
    );
  }
  if (Math.abs(req.newPriceUnit - b.price) < SAME) {
    throw new ConnectError(`batch #${req.batchId} is already at ${rupiah(b.price)}`, Code.FailedPrecondition);
  }

  // The person signed in — the stub's session is the first fixture user.
  const me = users[0]!;
  const log = record({
    batchId: req.batchId,
    warehouseId: b.warehouseId,
    productId: b.productId,
    from: b.price,
    to: req.newPriceUnit,
    units: b.units,
    valueDelta: Number(b.units) * (req.newPriceUnit - b.price),
    reason,
    actorUserId: me.id,
    isOverride: isOverride(req.teamId),
    atUnix: nowUnix(),
  });

  return {
    transactionId: log.id,
    priceUnitBefore: log.from,
    priceUnitAfter: log.to,
    valueChange: log.valueDelta,
    units: log.units,
  };
}

/**
 * A correction made earlier — for a story that opens on its result (the warehouse reading it, a CS reading it). Written
 * as BatchRevalue writes one, by `actorUserId`, an override when said.
 */
export function seedCorrectionForStory(args: {
  batchId: bigint;
  to: number;
  reason: string;
  actorUserId?: bigint;
  isOverride?: boolean;
  hoursAgo?: number;
}) {
  const b = factsOf(args.batchId);
  if (!b) throw new Error(`no batch ${args.batchId} in the stubs`);
  record({
    batchId: args.batchId,
    warehouseId: b.warehouseId,
    productId: b.productId,
    from: b.price,
    to: args.to,
    units: b.units,
    valueDelta: Number(b.units) * (args.to - b.price),
    reason: args.reason,
    actorUserId: args.actorUserId ?? 64n,
    isOverride: args.isOverride ?? false,
    atUnix: nowUnix() - BigInt(Math.round((args.hoursAgo ?? 2) * 3600)),
  });
}

/** The batch's last units go — an order took them while the form was open, or long before. */
export function emptyBatchForStory(batchId: bigint) {
  batchPriceScenario.emptied.add(batchId.toString());
}
