import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  Stack,
  Text,
  TreeView,
  createTreeCollection,
} from "@chakra-ui/react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderInput,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import type { Category } from "../../gen/warehouse/category/v1/category_pb";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { FilterBar, FilterSearch } from "../../components/chrome/FilterBar";
import { type CategoryTreeNode, categoryTreeRoot } from "../../features/categories/categoryTree";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { textCodec, useUrlState } from "../../lib/urlState";
import { CreateCategoryDialog } from "./components/CreateCategoryDialog";
import { MoveCategoryDialog } from "./components/MoveCategoryDialog";
import { RenameCategoryDialog } from "./components/RenameCategoryDialog";
import { CATEGORIES_PENDING } from "./pending";
import { useCategories, useDeleteCategory } from "./queries";
import { sampleProductCount } from "./sampleProductCounts";

// A row's actions are their own clicks and keys — the tree under them must not open, close or move its focus.
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

// The right-hand columns, the heading's and every row's, so they line up down the page. A row's actions column is a
// MINIMUM, so a label longer than it widens the row rather than spilling over the counts beside it — which is what
// *Tambah Sub-kategori* did in an 11rem column (owner: a screenshot, *"bug"*), before the label became *＋ Sub-kategori*
// (*"tidak ada teks yang lebih singkat?"*).
const PRODUCTS_W = "6rem";
const COUNT_W = "7rem";
const ACTIONS_W = "11rem";

// CategoriesPage manages the GLOBAL, nested category taxonomy — a single shared tree curated by root/admin (see the
// nav gate). It is not team-scoped, so there is no current team in play.
//
// IT IS A TREE (owner: *"tampilan kategori yang sekarang masih terlalu simpel"*, then *"kita coba begitu"* —
// the-category-page-is-a-tree) — AND IT READS LIKE THE APP'S TABLES (*"secara tema kurang sesuai"* —
// the-category-tree-reads-like-a-table): no card around it, a heading row, rows the full width a line apart at a
// table row's height (the row shape is theme.ts's `treeView`), labelled actions.
//
//   Kategori                                                       [＋ Kategori Baru]
//   Pohon kategori produk — satu untuk semua tim.
//   [⌕ Cari kategori        ×]                                          [⇕ Buka Semua]
//   Nama                              Sub-kategori   Produk ⚠1                  Aksi
//   ▸ Elektronik                                 1         102   [＋ Sub-kategori] [⋯]
//   ▸ Rumah Tangga                               1           9   [＋ Sub-kategori] [⋯]
//   ⋯ → Ubah Nama · Pindahkan · Hapus (off, with its reason, while it has sub-categories)
//
// Everything is read from the one full-tree read the page already made: the child counts, the search (the matches and
// the path to each), the branches to open. The tree arrives SHUT — the top level — and one button opens or shuts all.
export function CategoriesPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const query = useCategories();
  const deleteCategory = useDeleteCategory();

  // THE SEARCH LIVES IN THE URL (a-lists-filters-live-in-the-url).
  const [q, setQ] = useUrlState("q", "", textCodec);
  const term = q.trim().toLowerCase();

  // The dialogs, one each, driven by the row that opened them.
  const [creatingUnder, setCreatingUnder] = useState<Category | null>(null);
  const [creatingTop, setCreatingTop] = useState(false);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [moving, setMoving] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const categories = useMemo(() => query.data ?? [], [query.data]);
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  const full = useMemo(
    () =>
      createTreeCollection<CategoryTreeNode>({
        rootNode: categoryTreeRoot(categories),
        nodeToValue: (node) => node.id,
        nodeToString: (node) => node.name,
      }),
    [categories],
  );

  // How many sub-categories each has — from the WHOLE tree, so a search does not shrink the count beside a match.
  const childCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categories) {
      const key = c.parentId.toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [categories]);

  // A search keeps the matches and the path down to each — the collection's filter keeps a match's ancestors.
  const shown = useMemo(
    () => (term === "" ? full : full.filter((node) => node.id === "ROOT" || node.name.toLowerCase().includes(term))),
    [full, term],
  );
  const matches = term === "" ? categories.length : categories.filter((c) => c.name.toLowerCase().includes(term)).length;

  // OPEN BRANCHES — SHUT on arrival, the top level only (owner: *"default tutup semua"*); a search opens every branch
  // on the way to a match, and starts over when the search changes. One button opens them all or shuts them all.
  const [expanded, setExpanded] = useState<string[]>([]);
  const [searchExpanded, setSearchExpanded] = useState<string[] | undefined>(undefined);
  useEffect(() => setSearchExpanded(undefined), [term]);

  const expandedValue = term === "" ? expanded : (searchExpanded ?? shown.getBranchValues());
  const setOpen = (next: string[]) => (term === "" ? setExpanded(next) : setSearchExpanded(next));
  const branches = shown.getBranchValues();
  const allOpen = branches.length > 0 && branches.every((value) => expandedValue.includes(value));

  // mutateAsync because ConfirmDialog awaits onConfirm — see the note in expenses/ExpensesPage.tsx.
  async function remove(category: Category) {
    try {
      await deleteCategory.mutateAsync({ categoryId: category.id });
      toaster.create({
        type: "success",
        title: t("catalog.categories.deletedToast", { name: category.name }),
      });
    } catch (err) {
      // The server refuses a category that still has sub-categories (FailedPrecondition) — the menu says so first,
      // but a sub-category added elsewhere since the tree was read still lands here.
      toaster.create({ type: "error", title: t("catalog.deleteFailed"), description: rpcError(err) });
    }
  }

  // ＋ Sub-kategori beside the row — labelled, as a row's action is (an-action-button-carries-its-icon); its ＋ alone on
  // a phone — and the rest in its ⋯: Ubah Nama, Pindahkan, Hapus.
  function actions(category: Category) {
    const id = category.id.toString();
    const hasChildren = (childCount.get(id) ?? 0) > 0;

    return (
      <HStack
        gap="1.5"
        justify="end"
        flexShrink={0}
        minW={isMobile ? undefined : ACTIONS_W}
        onClick={stop}
        onKeyDown={stop}
        data-testid={`category-row-actions-${id}`}
      >
        {isMobile ? (
          <IconButton
            size="xs"
            variant="outline"
            aria-label={t("catalog.categories.addChildLabel", { name: category.name })}
            data-testid={`add-child-${id}`}
            onClick={() => setCreatingUnder(category)}
          >
            <Icon as={Plus} boxSize="4" />
          </IconButton>
        ) : (
          <Button
            size="xs"
            variant="outline"
            aria-label={t("catalog.categories.addChildLabel", { name: category.name })}
            data-testid={`add-child-${id}`}
            onClick={() => setCreatingUnder(category)}
          >
            <Icon as={Plus} boxSize="4" />
            {t("catalog.categories.addChild")}
          </Button>
        )}

        {/* THE ITEMS ACT THROUGH THE MENU'S onSelect, never their own onClick — a disabled item's DOM click still fires
            (owner: *"hapus disabled masih bisa ku klik"*), while the menu never selects a disabled one. */}
        <Menu.Root
          onSelect={(e) => {
            if (e.value === "rename") setRenaming(category);
            if (e.value === "move") setMoving(category);
            if (e.value === "delete" && !hasChildren) setDeleting(category);
          }}
        >
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("catalog.categories.actionsLabel", { name: category.name })}
              data-testid={`category-actions-${id}`}
            >
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="rename" data-testid={`rename-cat-${id}`}>
                  <Icon as={Pencil} boxSize="4" />
                  {t("catalog.categories.rename")}
                </Menu.Item>
                <Menu.Item value="move" data-testid={`move-cat-${id}`}>
                  <Icon as={FolderInput} boxSize="4" />
                  {t("catalog.categories.move")}
                </Menu.Item>
                {/* OFF WHILE IT HAS SUB-CATEGORIES, with its reason — the server would refuse it after the confirm. */}
                <Menu.Item value="delete" color="fg.error" disabled={hasChildren} data-testid={`delete-cat-${id}`}>
                  <Icon as={Trash2} boxSize="4" />
                  <Stack gap="0">
                    <Text>{t("catalog.delete")}</Text>
                    {hasChildren && (
                      <Text fontSize="xs" color="fg.muted" data-testid={`delete-blocked-${id}`}>
                        {t("catalog.categories.deleteBlocked")}
                      </Text>
                    )}
                  </Stack>
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>
    );
  }

  // One row, as a table's: the chevron (a branch) or its room (a leaf), the name, its sub-categories, its products (⚠ a
  // sample), the actions. On a phone there is no heading row, so the counts say what they are, on one line.
  function row(node: CategoryTreeNode, isBranch: boolean) {
    const category = node.category!;
    const count = childCount.get(node.id) ?? 0;
    const products = sampleProductCount(category.id);

    return (
      <>
        {isBranch ? (
          <TreeView.BranchIndicator>
            <Icon as={ChevronRight} boxSize="4" />
          </TreeView.BranchIndicator>
        ) : (
          <Box boxSize="4" flexShrink={0} />
        )}
        <Text
          flex="1"
          minW="0"
          truncate
          fontWeight={category.parentId === 0n ? "bold" : undefined}
          data-testid={`category-name-${node.id}`}
        >
          {node.name}
        </Text>
        {isMobile ? (
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" flexShrink={0} data-testid={`category-children-${node.id}`}>
            {[count > 0 ? t("catalog.categories.childCount", { count }) : "", t("catalog.categories.productCount", { count: products })]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : (
          <>
            <Text
              w={COUNT_W}
              flexShrink={0}
              textAlign="end"
              color={count > 0 ? undefined : "fg.subtle"}
              data-testid={`category-children-${node.id}`}
            >
              {count > 0 ? count : "—"}
            </Text>
            <Text
              w={PRODUCTS_W}
              flexShrink={0}
              textAlign="end"
              color={products > 0 ? undefined : "fg.subtle"}
              data-testid={`category-products-${node.id}`}
            >
              {products}
            </Text>
          </>
        )}
        {actions(category)}
      </>
    );
  }

  function tree() {
    if (categories.length === 0 && !error) {
      // AN EMPTY TREE SAYS WHAT NEXT (an-empty-list-shows-a-hint).
      return (
        <EmptyHint
          icon={FolderTree}
          title={t("catalog.categories.empty")}
          description={t("catalog.categories.emptyHint")}
          action={
            <Button colorPalette="brand" onClick={() => setCreatingTop(true)} data-testid="categories-empty-create">
              <Icon as={Plus} boxSize="4" />
              {t("catalog.categories.newCategory")}
            </Button>
          }
          testId="categories-empty"
        />
      );
    }

    if (matches === 0) {
      return (
        <EmptyHint
          icon={SearchX}
          title={t("catalog.categories.none")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" onClick={() => setQ("")}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="categories-none-match"
        />
      );
    }

    return (
      <Stack gap="0" data-testid="categories-list">
        {/* THE HEADING ROW, as a table's — the columns the rows line up under. A phone has none: its rows say it. */}
        {!isMobile && (
          <Flex
            align="center"
            gap="2"
            ps="8"
            pe="2"
            py="2"
            borderBottomWidth="1px"
            borderColor="border"
            fontSize="sm"
            fontWeight="medium"
            data-testid="categories-heading"
          >
            <Text flex="1">{t("catalog.name")}</Text>
            <Text w={COUNT_W} textAlign="end">
              {t("catalog.categories.childrenColumn")}
            </Text>
            {/* ⚠ THE PRODUCTS ARE A SAMPLE — the mark on the column it belongs to. */}
            <HStack w={PRODUCTS_W} gap="1" justify="end">
              <Text>{t("catalog.categories.productsColumn")}</Text>
              <NotImplemented list={CATEGORIES_PENDING} id="productCount" />
            </HStack>
            <Text w={ACTIONS_W} textAlign="end">
              {t("catalog.actions")}
            </Text>
          </Flex>
        )}

        <TreeView.Root
          collection={shown}
          expandedValue={expandedValue}
          onExpandedChange={(e) => setOpen(e.expandedValue)}
          // A branch's children slide open and shut (owner: *"animasi kurang, tidak smooth"*) — the height and a fade,
          // in the app's 180ms beat (theme.ts's `treeView`); off where the device asks for less motion.
          animateContent
          // Nothing is "selected" on this page — a click opens or closes a branch, and a row's actions are its buttons.
          selectedValue={[]}
          aria-label={t("catalog.categories.title")}
          data-testid="categories-tree"
        >
          <TreeView.Tree>
            <TreeView.Node<CategoryTreeNode>
              render={({ node, nodeState }) =>
                nodeState.isBranch ? (
                  <TreeView.BranchControl data-testid={`category-row-${node.id}`}>{row(node, true)}</TreeView.BranchControl>
                ) : (
                  <TreeView.Item data-testid={`category-row-${node.id}`}>{row(node, false)}</TreeView.Item>
                )
              }
            />
          </TreeView.Tree>
        </TreeView.Root>
      </Stack>
    );
  }

  // ONE BUTTON (owner: *"tutup buka semua jadi 1 tombol"*) — Buka Semua while anything is shut, Tutup Semua once every
  // branch is open. Beside the search, labelled; its icon alone on a phone, where it shares the search's row.
  const toggle = allOpen
    ? { label: t("catalog.categories.collapseAll"), icon: ChevronsDownUp, onClick: () => setOpen([]) }
    : { label: t("catalog.categories.expandAll"), icon: ChevronsUpDown, onClick: () => setOpen(branches) };
  const expandControls =
    branches.length > 0 && matches > 0 ? (
      isMobile ? (
        <IconButton
          variant="outline"
          colorPalette="gray"
          aria-label={toggle.label}
          onClick={toggle.onClick}
          data-testid="categories-toggle-all"
        >
          <Icon as={toggle.icon} boxSize="4" />
        </IconButton>
      ) : (
        <Button variant="outline" colorPalette="gray" onClick={toggle.onClick} data-testid="categories-toggle-all">
          <Icon as={toggle.icon} boxSize="4" />
          {toggle.label}
        </Button>
      )
    ) : undefined;

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="categories-page">
      {/* THE TITLE AND THE SUBTITLE AS ONE BLOCK, New Category on its row — the ＋ alone on a phone. */}
      <Flex align="start" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <Heading size="md">{t("catalog.categories.title")}</Heading>
          <Text color="fg.muted" fontSize="sm">
            {t("catalog.categories.lead")}
          </Text>
        </Stack>
        <CreateCategoryDialog compact={isMobile} />
      </Flex>

      {/* What this page cannot do yet — the product counts, invented. On a phone, with no heading row to carry the mark,
          this strip is where it is said. */}
      <NotImplementedSummary list={CATEGORIES_PENDING} />

      <FilterBar
        testId="categories-filter"
        active={q.trim() !== ""}
        count={q.trim() !== "" ? 1 : 0}
        onClear={() => setQ("")}
        actions={expandControls}
      >
        <FilterSearch
          value={q}
          onChange={setQ}
          placeholder={t("catalog.categories.searchPlaceholder")}
          testId="categories-search"
        />
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="categories-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it (motion-is-small-quick-and-shared). */}
      {loading ? <ListSkeleton testId="categories-loading" /> : <Box animationStyle="swap">{tree()}</Box>}

      {/* THE DIALOGS — one each, keyed by the category they act on so each starts from it. */}
      {creatingUnder && (
        <CreateCategoryDialog
          key={`under-${creatingUnder.id}`}
          parentId={creatingUnder.id}
          open
          onOpenChange={(o) => {
            if (!o) setCreatingUnder(null);
          }}
        />
      )}
      {creatingTop && (
        <CreateCategoryDialog
          open
          onOpenChange={(o) => {
            if (!o) setCreatingTop(false);
          }}
        />
      )}
      {renaming && (
        <RenameCategoryDialog key={`rename-${renaming.id}`} category={renaming} onClose={() => setRenaming(null)} />
      )}
      {moving && <MoveCategoryDialog key={`move-${moving.id}`} category={moving} onClose={() => setMoving(null)} />}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          title={t("catalog.categories.deleteTitle")}
          message={t("catalog.categories.deleteMessage", { name: deleting.name })}
          confirmLabel={t("catalog.delete")}
          onConfirm={() => remove(deleting)}
        />
      )}
    </Stack>
  );
}
