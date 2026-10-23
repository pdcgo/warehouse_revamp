// product_service's BundleService as Storybook's stub — the decided rules (docs/business/product/product_bundle_decision.md)
// as the server keeps them (backend/services/product_service/product_v1/bundle_*.go).
//
//   the-creator-or-an-admin-edits-a-bundle       reads and creates: every selling role. Update and delete: the selling
//                                                Owner and Admin, Root and the Administrator — and a CS only for a
//                                                bundle they created (PermissionDenied otherwise). Warehouse roles get
//                                                PermissionDenied everywhere, as the access interceptor answers them.
//   a-bundle-line-carries-its-quantity           each product once per bundle; quantity 1–9999
//   a-bundle-has-at-least-one-line               no lines → InvalidArgument
//   a-borrowed-product-never-blocks-its-owner    a line a save ADDS must be a live product, and another team's only while
//                                                it is not locked. A line already in the bundle is KEPT whatever its
//                                                product has become since.
//   bundle-names-may-repeat                      a name is never refused
//   the-order-keeps-only-product-lines           BundleDelete is a hard delete
//
// And the list's shape: `q` over the bundle's name and its products' names and codes; the last change first unless a
// sort is sent; paged.
//
// WRITEABLE: a bundle made in one step is on the list in the next. preview.tsx calls `resetBundleStub()` in its
// `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { BundleRowSort, BundleService } from "../src/gen/warehouse/product/v1/bundle_pb";
import { CommonSortType, GeneralSort } from "../src/gen/warehouse/common/v1/list_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { type BundleFixture, bundleFixtures } from "./bundleFixtures";
import { users } from "./fixtures";
import { productsNow } from "./productScenario";
import { sessionScenario } from "./sessionScenario";

let bundles: BundleFixture[] = [];

export function resetBundleStub() {
  bundles = bundleFixtures.map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l })) }));
}

resetBundleStub();

// The signed-in person — the stub's AuthService answers as `users[0]`.
const ME = users[0]!.id;
const now = () => BigInt(Math.floor(Date.now() / 1000));

const SELLING_ROLES = [Role.ROOT, Role.ADMINISTRATOR, Role.SELLING_OWNER, Role.SELLING_ADMIN, Role.SELLING_CS];

// The request policy, as the access interceptor would answer it.
function allowed() {
  if (!SELLING_ROLES.includes(sessionScenario.role)) {
    throw new ConnectError("permission denied", Code.PermissionDenied);
  }
}

function inTeam(teamId: bigint, bundleId: bigint): BundleFixture {
  const found = bundles.find((b) => b.id === bundleId && b.teamId === teamId);
  if (!found) {
    throw new ConnectError("bundle not found", Code.NotFound);
  }
  return found;
}

// The handler's narrowing — the proto cannot say "only your own".
function mayChange(bundle: BundleFixture) {
  if (sessionScenario.role === Role.SELLING_CS && bundle.createdByUserId !== ME) {
    throw new ConnectError("only the bundle's creator or an Admin can change it", Code.PermissionDenied);
  }
}

type LineIn = { productId: bigint; quantity: number };

function checkFields(name: string, lines: LineIn[]) {
  if (name.trim() === "") {
    throw new ConnectError("name: value length must be at least 1 characters", Code.InvalidArgument);
  }
  if (lines.length === 0) {
    throw new ConnectError("lines: value must contain at least 1 item(s)", Code.InvalidArgument);
  }
  for (const l of lines) {
    if (l.quantity < 1 || l.quantity > 9999) {
      throw new ConnectError("lines.quantity: value must be greater than or equal to 1 and less than or equal to 9999", Code.InvalidArgument);
    }
  }
}

// The handler's line rules. `kept` = the product ids already in the bundle, which an update keeps as they are.
function checkLines(teamId: bigint, lines: LineIn[], kept: bigint[] = []) {
  const seen = new Set<string>();
  const catalogue = productsNow();

  for (const l of lines) {
    if (seen.has(l.productId.toString())) {
      throw new ConnectError(`product ${l.productId} is in the bundle twice`, Code.InvalidArgument);
    }
    seen.add(l.productId.toString());

    if (kept.includes(l.productId)) continue;

    const product = catalogue.find((p) => p.id === l.productId);
    if (!product || product.deleted) {
      throw new ConnectError(`product ${l.productId} does not exist`, Code.InvalidArgument);
    }
    if (product.teamId !== teamId && product.crossLocked) {
      throw new ConnectError(`${product.name} is locked by its owner and cannot be added`, Code.InvalidArgument);
    }
  }
}

const wire = (b: BundleFixture) => ({ ...b, lines: b.lines.map((l) => ({ ...l })) });

function sorted(rows: BundleFixture[], sort: { sortType: CommonSortType; s: { case?: string; value?: unknown } } | undefined) {
  const asc = sort?.sortType === CommonSortType.ASC;
  const byName =
    (sort?.s.case === "bundle" && sort.s.value === BundleRowSort.NAME) ||
    (sort?.s.case === "general" && sort.s.value === GeneralSort.NAME);

  return [...rows].sort((a, b) => {
    const cmp = byName
      ? a.name.localeCompare(b.name) || Number(a.id - b.id)
      : Number(a.updatedAtUnix - b.updatedAtUnix) || Number(a.id - b.id);
    // The list's own order, with no sort sent, is the last change first.
    return sort && asc ? cmp : -cmp;
  });
}

export const bundleService: Partial<ServiceImpl<typeof BundleService>> = {
  bundleList: (req) => {
    allowed();

    const q = (req.filter?.q ?? "").trim().toLowerCase();
    const catalogue = productsNow();
    const matches = (b: BundleFixture) =>
      !q ||
      b.name.toLowerCase().includes(q) ||
      b.lines.some((l) => {
        const p = catalogue.find((x) => x.id === l.productId);
        return !!p && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
      });

    const rows = sorted(
      bundles.filter((b) => b.teamId === req.teamId && matches(b)),
      req.sort as Parameters<typeof sorted>[1],
    );

    const limit = Number(req.page?.limit ?? 20) || 20;
    const current = Number(req.page?.page ?? 1) || 1;
    const page = rows.slice((current - 1) * limit, current * limit);

    return {
      items: [{ d: { case: "bundle" as const, value: { mapData: Object.fromEntries(page.map((b) => [b.id.toString(), wire(b)])) } } }],
      ids: page.map((b) => b.id),
      pageInfo: {
        currentPage: current,
        totalPage: Math.max(1, Math.ceil(rows.length / limit)),
        totalItems: BigInt(rows.length),
      },
    };
  },

  bundleByIds: (req) => {
    allowed();

    const items: Record<string, { items: { d: { case: "bundle"; value: { mapData: Record<string, ReturnType<typeof wire>> } } }[] }> = {};
    for (const id of req.filter?.ids ?? []) {
      const b = bundles.find((x) => x.id === id && x.teamId === req.teamId);
      if (!b) continue; // another team's, or gone — simply absent
      items[id.toString()] = { items: [{ d: { case: "bundle", value: { mapData: { [id.toString()]: wire(b) } } } }] };
    }

    return { items };
  },

  bundleCreate: (req) => {
    allowed();
    checkFields(req.name, req.lines);
    checkLines(req.teamId, req.lines);

    const created: BundleFixture = {
      id: bundles.reduce((max, b) => (b.id > max ? b.id : max), 0n) + 1n,
      teamId: req.teamId,
      name: req.name.trim(),
      description: req.description.trim(),
      createdByUserId: ME,
      createdAtUnix: now(),
      updatedAtUnix: now(),
      lines: req.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    };
    bundles = [...bundles, created];

    return { bundle: wire(created) };
  },

  bundleUpdate: (req) => {
    allowed();
    const bundle = inTeam(req.teamId, req.bundleId);
    mayChange(bundle);
    checkFields(req.name, req.lines);
    checkLines(
      req.teamId,
      req.lines,
      bundle.lines.map((l) => l.productId),
    );

    bundle.name = req.name.trim();
    bundle.description = req.description.trim();
    bundle.lines = req.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
    bundle.updatedAtUnix = now();

    return { bundle: wire(bundle) };
  },

  bundleDelete: (req) => {
    allowed();
    const bundle = inTeam(req.teamId, req.bundleId);
    mayChange(bundle);

    bundles = bundles.filter((b) => b !== bundle);

    return {};
  },
};
