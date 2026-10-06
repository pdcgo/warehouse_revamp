// The supplier service as Storybook's stub — the CRUD prototype of docs/business/supplier.
//
// It plays TODAY'S server (warehouse.inventory.v1): a supplier needs a code, a channel needs an online or
// offline type and, online, a marketplace. The screens no longer ask for either, so a story passes only if
// the translation step in features/suppliers/adapt.ts supplies them — which is the point.
//
// Two DECIDED rules are played as well, because a screen must already honour them:
//   only-a-selling-team-has-suppliers — SupplierCreate refuses a team that is not a selling team.
//   no-province-city-or-soft-delete   — SupplierDelete removes the row and its channels, for good.
//
// WRITEABLE: a supplier added in one step is on the list in the next. Module state survives between stories
// in one tab — preview.tsx calls `resetSupplierStub()` in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { SupplierService } from "../src/gen/warehouse/inventory/v1/supplier_pb";
import { SupplierChannelService, SupplierChannelType } from "../src/gen/warehouse/inventory/v1/supplier_channel_pb";
import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";
import { teams } from "./fixtures";
import { type ChannelFixture, type SupplierFixture, channelFixtures, supplierFixtures } from "./supplierFixtures";

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

let suppliers: SupplierFixture[] = [];
let channels: ChannelFixture[] = [];

export function resetSupplierStub() {
  suppliers = supplierFixtures.map((s) => ({ ...s }));
  channels = channelFixtures.map((c) => ({ ...c }));
}

resetSupplierStub();

const nextId = (rows: { id: bigint }[]) => rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;

// The guideline List envelope, paged — the same shape stubTransport.ts serves, kept here so this stub
// stands alone (a story imports it without pulling the whole transport into the typecheck).
type PageReq = { page?: bigint; limit?: bigint } | undefined;

function paged<C extends string, R extends { id: bigint }>(slice: C, rows: R[], page: PageReq) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;
  const window = rows.slice((current - 1) * limit, current * limit);

  const mapData: Record<string, R> = {};
  for (const row of window) {
    mapData[row.id.toString()] = row;
  }

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: window.map((r) => r.id),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(rows.length / limit)),
      totalItems: BigInt(rows.length),
    },
  };
}

function inTeam(teamId: bigint, supplierId: bigint): SupplierFixture {
  const found = suppliers.find((s) => s.id === supplierId && s.teamId === teamId && !s.deleted);
  if (!found) {
    // Another team's supplier reads as NotFound, exactly as a missing one does.
    throw new ConnectError("supplier not found", Code.NotFound);
  }
  return found;
}

function channelInTeam(teamId: bigint, channelId: bigint): ChannelFixture {
  const found = channels.find((c) => c.id === channelId);
  if (!found) {
    throw new ConnectError("channel not found", Code.NotFound);
  }
  inTeam(teamId, found.supplierId);
  return found;
}

function required(value: string, field: string) {
  if (value.trim() === "") {
    throw new ConnectError(`${field}: value is required`, Code.InvalidArgument);
  }
}

// TODAY's pairing rule — an online channel names its marketplace.
function checkPairing(type: SupplierChannelType, marketplace: Marketplace) {
  if (type === SupplierChannelType.UNSPECIFIED) {
    throw new ConnectError("type: value is required", Code.InvalidArgument);
  }
  if (type === SupplierChannelType.ONLINE && marketplace === Marketplace.UNSPECIFIED) {
    throw new ConnectError("an online channel needs a marketplace", Code.InvalidArgument);
  }
}

// ── SupplierService ─────────────────────────────────────────────────────────────────────────────

export const supplierService: Partial<ServiceImpl<typeof SupplierService>> = {
  supplierList: (req) => {
    const q = (req.filter?.q ?? "").trim().toLowerCase();
    const rows = suppliers
      .filter((s) => s.teamId === req.teamId && !s.deleted)
      .filter((s) => !q || s.name.toLowerCase().includes(q));

    return paged("supplier", rows, req.page as PageReq);
  },

  // Crosses teams by design (a warehouse reads a delivery's vendor); a deleted supplier is simply absent.
  supplierByIds: (req) => {
    const items: Record<string, { items: { d: { case: "supplier"; value: { mapData: Record<string, SupplierFixture> } } }[] }> = {};

    for (const id of req.filter?.ids ?? []) {
      const found = suppliers.find((s) => s.id === id);
      if (found) {
        items[id.toString()] = { items: [{ d: { case: "supplier", value: { mapData: { [id.toString()]: found } } } }] };
      }
    }

    return { items };
  },

  supplierDetail: (req) => ({ supplier: inTeam(req.teamId, req.supplierId) }),

  supplierCreate: (req) => {
    // only-a-selling-team-has-suppliers.
    const team = teams.find((t) => t.id === req.teamId);
    if (team?.type !== TeamType.SELLING) {
      throw new ConnectError("only a selling team has suppliers", Code.FailedPrecondition);
    }

    required(req.code, "code");
    required(req.name, "name");

    if (suppliers.some((s) => s.teamId === req.teamId && !s.deleted && s.code === req.code)) {
      throw new ConnectError(`code "${req.code}" already exists`, Code.AlreadyExists);
    }

    const row: SupplierFixture = {
      id: nextId(suppliers),
      teamId: req.teamId,
      code: req.code,
      name: req.name,
      contact: req.contact,
      province: req.province,
      city: req.city,
      address: req.address,
      description: req.description,
      deleted: false,
    };
    suppliers = [...suppliers, row];

    return { supplier: row };
  },

  supplierUpdate: (req) => {
    const row = inTeam(req.teamId, req.supplierId);

    if (req.name !== undefined) {
      required(req.name, "name");
    }

    const next: SupplierFixture = {
      ...row,
      code: req.code ?? row.code,
      name: req.name ?? row.name,
      contact: req.contact ?? row.contact,
      province: req.province ?? row.province,
      city: req.city ?? row.city,
      address: req.address ?? row.address,
      description: req.description ?? row.description,
    };
    suppliers = suppliers.map((s) => (s.id === row.id ? next : s));

    return { supplier: next };
  },

  // no-province-city-or-soft-delete: the row and its channels are gone.
  supplierDelete: (req) => {
    const row = inTeam(req.teamId, req.supplierId);
    suppliers = suppliers.filter((s) => s.id !== row.id);
    channels = channels.filter((c) => c.supplierId !== row.id);

    return {};
  },
};

// ── SupplierChannelService ──────────────────────────────────────────────────────────────────────

export const supplierChannelService: Partial<ServiceImpl<typeof SupplierChannelService>> = {
  supplierChannelList: (req) => {
    const supplierId = req.filter?.supplierId ?? 0n;
    inTeam(req.teamId, supplierId);

    return paged(
      "supplierChannel",
      channels.filter((c) => c.supplierId === supplierId),
      req.page as PageReq,
    );
  },

  supplierChannelCreate: (req) => {
    inTeam(req.teamId, req.supplierId);
    required(req.name, "name");
    checkPairing(req.type, req.marketplace);

    const row: ChannelFixture = {
      id: nextId(channels),
      supplierId: req.supplierId,
      type: req.type,
      marketplace: req.marketplace,
      name: req.name,
      url: req.url,
      contact: req.contact,
      location: req.location,
    };
    channels = [...channels, row];

    return { channel: row };
  },

  supplierChannelUpdate: (req) => {
    const row = channelInTeam(req.teamId, req.channelId);

    if (req.name !== undefined) {
      required(req.name, "name");
    }

    const next: ChannelFixture = {
      ...row,
      type: req.type ?? row.type,
      marketplace: req.marketplace ?? row.marketplace,
      name: req.name ?? row.name,
      url: req.url ?? row.url,
      contact: req.contact ?? row.contact,
      location: req.location ?? row.location,
    };
    checkPairing(next.type, next.marketplace);
    channels = channels.map((c) => (c.id === row.id ? next : c));

    return { channel: next };
  },

  supplierChannelDelete: (req) => {
    const row = channelInTeam(req.teamId, req.channelId);
    channels = channels.filter((c) => c.id !== row.id);

    return {};
  },
};
