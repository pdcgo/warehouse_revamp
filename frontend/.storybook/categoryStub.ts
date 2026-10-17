// category_service as Storybook's stub — CategoryService of warehouse.category.v1.
//
// It plays the server's rules (backend/services/category_service/category_v1), because a screen must already honour
// them:
//   one global tree           not team-scoped — every story reads the same taxonomy.
//   a parent must exist       create and update refuse a parent that is not an active category (InvalidArgument).
//   never its own parent      update refuses a category as its own parent (InvalidArgument).
//   a name once per parent    a second "Audio" under Elektronik is refused (AlreadyExists); the same name under
//                             another parent is fine.
//   a delete is soft          and refused while the category still has sub-categories (FailedPrecondition).
//
// ⚠ The server does NOT refuse a deeper cycle (moving Elektronik under its own Headphone) — only a category as its
// own parent — so neither does this stub. The edit dialog's picker is what keeps a category's own subtree out of
// reach.
//
// WRITEABLE: a category added in one step is in the tree in the next. Module state survives between stories in one
// tab — preview.tsx calls `resetCategoryStub()` in its `beforeEach`.

import { Code, ConnectError } from "@connectrpc/connect";

import { categories as categoryFixtures } from "./fixtures";

interface CategoryRow {
  id: bigint;
  name: string;
  parentId: bigint;
  deleted: boolean;
}

let rows: CategoryRow[] = [];

export function resetCategoryStub() {
  rows = categoryFixtures.map((c) => ({ ...c, deleted: false }));
}

resetCategoryStub();

/** A STORY'S SETUP: a taxonomy with nothing in it yet. `resetCategoryStub` (preview's beforeEach) brings it back. */
export function clearCategoriesForStory() {
  rows = [];
}

const live = () => rows.filter((r) => !r.deleted);
const wire = (r: CategoryRow) => ({ id: r.id, name: r.name, parentId: r.parentId });

function find(id: bigint): CategoryRow {
  const row = live().find((r) => r.id === id);
  if (!row) throw new ConnectError("category not found", Code.NotFound);
  return row;
}

function requireParent(parentId: bigint) {
  if (parentId !== 0n && !live().some((r) => r.id === parentId)) {
    throw new ConnectError("parent category not found", Code.InvalidArgument);
  }
}

function requireUniqueName(name: string, parentId: bigint, self?: bigint) {
  if (live().some((r) => r.id !== self && r.parentId === parentId && r.name === name)) {
    throw new ConnectError("a category with this name already exists under that parent", Code.AlreadyExists);
  }
}

export const categoryService = {
  // The one full-tree read the pagination rule exempts (a picker needs every node to assemble the tree), so there is
  // no filter here — the drill-down happens in the component.
  categoryList: () => ({ categories: live().map(wire) }),

  categoryCreate: (req: { name: string; parentId: bigint }) => {
    requireParent(req.parentId);
    requireUniqueName(req.name, req.parentId);

    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const row: CategoryRow = { id, name: req.name, parentId: req.parentId, deleted: false };
    rows.push(row);
    return { category: wire(row) };
  },

  categoryUpdate: (req: { categoryId: bigint; name?: string; parentId?: bigint }) => {
    if (req.parentId !== undefined && req.parentId === req.categoryId) {
      throw new ConnectError("a category cannot be its own parent", Code.InvalidArgument);
    }

    const row = find(req.categoryId);
    const parentId = req.parentId ?? row.parentId;
    requireParent(parentId);
    requireUniqueName(req.name ?? row.name, parentId, row.id);

    if (req.name !== undefined) row.name = req.name;
    row.parentId = parentId;
    return { category: wire(row) };
  },

  categoryDelete: (req: { categoryId: bigint }) => {
    const row = find(req.categoryId);
    if (live().some((r) => r.parentId === row.id)) {
      throw new ConnectError("cannot delete a category that has sub-categories", Code.FailedPrecondition);
    }

    row.deleted = true;
    return {};
  },
};
