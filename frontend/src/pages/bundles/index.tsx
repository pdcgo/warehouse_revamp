import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, HStack, Heading, Icon, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useAuth } from "../../features/auth/AuthContext";
import type { BundleRecord } from "../../features/bundles/adapt";
import { type BundleSortKey, useBundleProducts, useBundles, useDeleteBundle } from "../../features/bundles/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixRelative } from "../../lib/datetime";
import { canChangeBundle, canCreateBundle } from "../../lib/roles";
import { useDebounced } from "../../lib/useDebounced";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SortableHeader, type SortState } from "../../components/chrome/SortableHeader";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { BundleLinesText } from "./components/BundleLinesText";
import { BundleSortSelect } from "./components/BundleSortSelect";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER (`a-table-row-lights-up`) — every cell, by Chakra's `_hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// BundlesPage — the CURRENT selling team's bundles: picking recipes, "2 Kopi + 1 Teh", used while an order is filled
// in (docs/business/product/product_bundle.md).
//
//   Bundles [Toko Melati]                                              [＋ New Bundle]
//   Picking recipes this team uses on an order — …
//   [⌕ Search a bundle, or a product in it]                                Clear filters
//   Bundle ⇅                 · Products                         · Created by · Updated ⇅ · [✎ Edit] [🗑 Delete]
//   Paket Hemat                1 × Beras Pandan Wangi 5kg · 2 ×    Ani Rahayu   yesterday
//   Beras dan gula untuk …     [⚠ 1 unavailable]
//                                                          Per page [20 ⌄]  ‹ [1] ›
//
// The PRODUCTS column is what tells two bundles apart, because a name may repeat (bundle-names-may-repeat). Edit and
// Delete show only on a bundle the person may change — every bundle for an Owner or Admin, their own for a CS
// (the-creator-or-an-admin-edits-a-bundle). The row opens the bundle's page for everyone
// (a-bundle-has-a-detail-page-that-counts-what-stock-can-make); Edit goes straight to its form.
export function BundlesPage() {
  const { current } = useTeam();
  const { identity } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const isSelling = current?.teamType === TeamType.SELLING;
  const me = identity?.identityId;
  const mayCreate = isSelling && canCreateBundle(current?.role);

  const [q, setQ] = useState("");
  // `null` = the list's own order, the last change first.
  const [sort, setSort] = useState<SortState<BundleSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const term = useDebounced(q.trim());
  const teamId = isSelling ? current?.teamId : undefined;

  const query = useBundles({ teamId, q: term, sort, page, pageSize });
  const bundles = query.data?.bundles ?? [];
  const totalItems = query.data?.totalItems ?? 0;

  // One ProductByIds for every line on the page, one UserByIDs for every creator — never a read per row.
  const products = useBundleProducts({ teamId, productIds: bundles.flatMap((b) => b.lines.map((l) => l.productId)) });
  const actors = useActors(bundles.map((b) => b.createdByUserId));
  const deleteBundle = useDeleteBundle();

  const error = query.isError ? rpcError(query.error) : "";

  function refilter(change: () => void) {
    change();
    setPage(1);
  }
  const sortBy = (next: SortState<BundleSortKey> | null) => refilter(() => setSort(next));

  // `mutateAsync`: ConfirmDialog awaits its onConfirm to hold the button in its loading state.
  async function remove(bundle: BundleRecord) {
    if (teamId === undefined) return;

    try {
      await deleteBundle.mutateAsync({ teamId, bundleId: bundle.id });
      toaster.create({ type: "success", title: t("bundles.deleted", { name: bundle.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("bundles.deleteFailed"), description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("bundles.title")}</Heading>
        <Text color="fg.muted" data-testid="bundles-no-team">
          {t("bundles.selectTeam")}
        </Text>
      </Stack>
    );
  }

  const creatorName = (bundle: BundleRecord) =>
    actors.data?.get(bundle.createdByUserId.toString())?.name ?? `#${bundle.createdByUserId}`;

  const mayChange = (bundle: BundleRecord) => canChangeBundle({ role: current.role, createdByUserId: bundle.createdByUserId, me });

  // Edit and Delete — two actions, so they stay inline and labelled, as the supplier list's do.
  function actions(bundle: BundleRecord) {
    if (!mayChange(bundle)) return null;

    return (
      <HStack justify="end" gap="1.5">
        <Button
          size="xs"
          variant="outline"
          data-testid={`edit-bundle-${bundle.id}`}
          onClick={() => navigate(`/products/bundles/${bundle.id}/edit`)}
        >
          <Icon as={Pencil} boxSize="4" />
          {t("bundles.edit")}
        </Button>

        <ConfirmDialog
          title={t("bundles.deleteTitle")}
          message={t("bundles.deleteConfirm", { name: bundle.name })}
          confirmLabel={t("bundles.delete")}
          onConfirm={() => remove(bundle)}
          trigger={
            <Button size="xs" variant="outline" colorPalette="error" data-testid={`delete-bundle-${bundle.id}`}>
              <Icon as={Trash2} boxSize="4" />
              {t("bundles.delete")}
            </Button>
          }
        />
      </HStack>
    );
  }

  const open = (bundle: BundleRecord) => navigate(`/products/bundles/${bundle.id}`);

  function list() {
    if (bundles.length === 0 && !error) {
      return (
        <Text color="fg.muted" data-testid={term !== "" ? "bundles-none-match" : "bundles-empty"}>
          {term !== "" ? t("bundles.none") : t("bundles.empty")}
        </Text>
      );
    }

    if (isMobile) {
      // A PHONE READS EACH BUNDLE AS A BLOCK (`a-phone-reads-each-line-as-a-block`): the name at full width, what is
      // in it, then the actions at its foot. Who made it and when are the bundle page's.
      return (
        <Stack gap="2" data-testid="bundles-table">
          {bundles.map((bundle) => (
            <Stack
              key={bundle.id.toString()}
              data-testid={`bundle-row-${bundle.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="1.5"
              cursor="pointer"
              _hover={{ bg: "bg.muted" }}
              _active={{ bg: "bg.muted" }}
              onClick={() => open(bundle)}
            >
              <Text fontWeight="bold">{bundle.name}</Text>
              <BundleLinesText bundle={bundle} products={products.data} testId={`bundle-row-${bundle.id}-lines`} />
              {mayChange(bundle) && (
                <Box pt="1" onClick={(e) => e.stopPropagation()}>
                  {actions(bundle)}
                </Box>
              )}
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="bundles-table">
        <Table.Header>
          <Table.Row>
            <SortableHeader
              column="name"
              label={t("bundles.table.bundle")}
              sort={sort}
              onSortChange={sortBy}
              firstDir="asc"
              testId="bundle-sort-name"
            />
            <Table.ColumnHeader>{t("bundles.table.products")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("bundles.table.createdBy")}</Table.ColumnHeader>
            <SortableHeader
              column="updated"
              label={t("bundles.table.updated")}
              sort={sort}
              onSortChange={sortBy}
              testId="bundle-sort-updated"
            />
            <Table.ColumnHeader textAlign="end">{t("bundles.table.actions")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {bundles.map((bundle) => (
            <Table.Row
              key={bundle.id.toString()}
              data-testid={`bundle-row-${bundle.id}`}
              cursor="pointer"
              css={LIGHTS_UP}
              onClick={() => open(bundle)}
            >
              <Table.Cell maxW="16rem">
                {/* Two lines, one context: the bundle, and what it is for. */}
                <Stack gap="0">
                  <Text fontWeight="bold">{bundle.name}</Text>
                  {bundle.description && (
                    <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                      {bundle.description}
                    </Text>
                  )}
                </Stack>
              </Table.Cell>
              <Table.Cell maxW="28rem">
                <BundleLinesText bundle={bundle} products={products.data} testId={`bundle-row-${bundle.id}-lines`} />
              </Table.Cell>
              <Table.Cell data-testid={`bundle-row-${bundle.id}-creator`}>{creatorName(bundle)}</Table.Cell>
              <Table.Cell whiteSpace="nowrap">{formatUnixRelative(bundle.updatedAtUnix)}</Table.Cell>
              {/* Stop the row's navigate from firing when a row action is used. */}
              <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                {actions(bundle)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="section" data-testid="bundles-page">
      <Flex align="start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="card" wrap="wrap">
            <Heading size="md">{t("bundles.title")}</Heading>
            <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
          </HStack>
          <Text color="fg.muted" fontSize="sm">
            {t("bundles.lead")}
          </Text>
        </Stack>
        {mayCreate && (
          <Button colorPalette="brand" data-testid="open-create-bundle" onClick={() => navigate("/products/bundles/new")}>
            <Icon as={Plus} boxSize="4" />
            {t("bundles.newBundle")}
          </Button>
        )}
      </Flex>

      {!isSelling ? (
        <Text color="fg.muted" data-testid="bundles-selling-only">
          {t("bundles.sellingOnly")}
        </Text>
      ) : (
        <>
          <FilterBar
            testId="bundles-filter"
            active={q.trim() !== ""}
            count={q.trim() !== "" ? 1 : 0}
            onClear={() => refilter(() => setQ(""))}
          >
            <FilterSearch
              value={q}
              onChange={(value) => refilter(() => setQ(value))}
              placeholder={t("bundles.search")}
              testId="bundle-search"
            />

            {isMobile && (
              <FilterField testId="bundles-sort-field">
                <BundleSortSelect value={sort} onChange={sortBy} />
              </FilterField>
            )}
          </FilterBar>

          {error && (
            <Text color="error.fg" data-testid="bundles-error">
              {error}
            </Text>
          )}

          {query.isPending ? (
            <Spinner colorPalette="brand" />
          ) : (
            <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
          )}

          <GrowingPager
            page={page}
            onPageChange={setPage}
            hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
            resetKey={[term, sort ? `${sort.by}:${sort.dir}` : "", pageSize].join("|")}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            testId="bundles-pager"
          />
        </>
      )}
    </Stack>
  );
}
