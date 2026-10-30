import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, Stack } from "@chakra-ui/react";

import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { FilterChips } from "../../../components/chrome/FilterChips";
import { FilterGroup } from "../../../components/chrome/FilterPanel";
import { CategorySelect } from "../../../components/pickers/CategorySelect";
import { TeamSelect } from "../../../components/teams/TeamSelect";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { lockIconOf } from "../../../features/products/ProductLock";
import { DISCOVER_PENDING } from "../pending";
import { PRICE_BANDS, PRICE_MAX, type RangePick, STOCK_BANDS, STOCK_MAX, priceBandLabel, stockBandLabel } from "../ranges";
import { DiscoverRangeFilter } from "./DiscoverRangeFilter";

/** Every filter the panel and the sheet hold — what the page keeps in the URL. */
export interface DiscoverFilters {
  warehouseId: bigint;
  ownerTeamId: bigint;
  hideMine: boolean;
  categoryId: bigint;
  /** READY stock — a band, or a range of one's own. */
  stock: RangePick;
  /** The CROSS price — a band, or a range of one's own. */
  cross: RangePick;
  /** Terbuka or Terkunci — "" for both. */
  lock: LockFilter;
}

/** Open: another team may take it now. Locked: its owner locked it, or a minimum has closed it. */
export type LockFilter = "" | "open" | "locked";
export const LOCK_FILTERS: readonly LockFilter[] = ["", "open", "locked"];

// THE DISCOVER FILTERS, TOP TO BOTTOM (owner: *"gudang di atas, lalu tim … untuk filter lain kurasa sesuai dengan yang
// kau sebutkan"*, `discover-filters-in-a-side-panel`) — one set of groups, which the page puts in the FilterPanel beside
// the grid on a desktop and in FilterBar's sheet below `lg`:
//
//   Gudang ⚠        where the stock is — the first question a seller shipping from one city asks
//   Tim pemilik     whose product · ☐ Sembunyikan produk saya
//   Kategori ⚠
//   Stok siap ⚠     (Semua) (1–10) (11–50) … (✎ Atur sendiri)          — discover-ranges-are-picked
//   Harga cross ⚠   (Semua) (≤ 10rb) (10–25rb) … (500rb–1jt) (✎ Atur sendiri)
//   Kunci ⚠         (Semua) (Terbuka) (Terkunci)                       — discover-filters-by-lock
//   (Urutkan)       the sheet only — beside the search on a desktop
//
// ⚠ Only Tim pemilik and Sembunyikan produk saya narrow the cards today; the rest hold their pick and throw it away, each
// marked (pending.ts), because nothing on the server can answer them yet.
export function DiscoverFilterGroups({
  value,
  onChange,
  sort,
}: {
  value: DiscoverFilters;
  /** One filter changed — the page restarts at page one. */
  onChange: (next: Partial<DiscoverFilters>) => void;
  /** The sort select, as a last group — passed only in the phone's sheet. */
  sort?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      <FilterGroup
        label={t("discover.filter.warehouse")}
        mark={<NotImplemented list={DISCOVER_PENDING} id="warehouse" />}
        testId="discover-filter-warehouse"
      >
        {/* Every option is a warehouse, so the pick is its name alone (a-one-type-picker-shows-the-name-alone). */}
        <TeamSelect
          teamType={TeamType.WAREHOUSE}
          value={value.warehouseId > 0n ? value.warehouseId : undefined}
          placeholder={t("discover.filter.warehouseAll")}
          showType={false}
          onChange={(warehouseId) => onChange({ warehouseId })}
        />
      </FilterGroup>

      <FilterGroup label={t("discover.filter.team")} testId="discover-filter-team">
        <Stack gap="2" w="full">
          {/* Selling teams — the ones that own a catalogue. A search select: there is no ceiling on how many. */}
          <TeamSelect
            teamType={TeamType.SELLING}
            value={value.ownerTeamId > 0n ? value.ownerTeamId : undefined}
            placeholder={t("discover.filter.teamAll")}
            showType={false}
            onChange={(ownerTeamId) => onChange({ ownerTeamId })}
          />
          {/* ONLY OTHER TEAMS' — the team's own products are on Discover too (with their cost, discover-shows-the-
              cross-price); this takes them out, for the seller looking only for what somebody else holds. */}
          <Checkbox.Root
            size="sm"
            checked={value.hideMine}
            onCheckedChange={(e) => onChange({ hideMine: !!e.checked })}
            data-testid="discover-filter-hide-mine"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>{t("discover.filter.hideMine")}</Checkbox.Label>
          </Checkbox.Root>
        </Stack>
      </FilterGroup>

      <FilterGroup
        label={t("discover.filter.category")}
        mark={<NotImplemented list={DISCOVER_PENDING} id="category" />}
        testId="discover-filter-category"
      >
        {/* Fixed: the panel scrolls its own groups, and this picker's panel is not portalled. */}
        <CategorySelect
          value={value.categoryId}
          placeholder={t("discover.filter.categoryAll")}
          onChange={(categoryId) => onChange({ categoryId })}
          positioningStrategy="fixed"
        />
      </FilterGroup>

      <FilterGroup
        label={t("discover.filter.stock")}
        mark={<NotImplemented list={DISCOVER_PENDING} id="stock" />}
        testId="discover-filter-stock"
      >
        {/* READY stock (owner: *"yg difilter adalah yang ready"*), up to 100.000. */}
        <DiscoverRangeFilter
          kind="stock"
          value={value.stock}
          onChange={(stock) => onChange({ stock })}
          bands={STOCK_BANDS}
          bandLabel={(b) => stockBandLabel(b, t("discover.range.empty"))}
          max={STOCK_MAX}
          testId="discover-stock-range"
        />
      </FilterGroup>

      <FilterGroup
        label={t("discover.filter.crossRange")}
        mark={<NotImplemented list={DISCOVER_PENDING} id="crossRange" />}
        testId="discover-filter-cross-range"
      >
        {/* The cross price, up to Rp 1.000.000. */}
        <DiscoverRangeFilter
          kind="price"
          value={value.cross}
          onChange={(cross) => onChange({ cross })}
          bands={PRICE_BANDS}
          bandLabel={priceBandLabel}
          max={PRICE_MAX}
          testId="discover-cross-range"
        />
      </FilterGroup>

      {/* TERBUKA · TERKUNCI (owner: *"filter terkunci dan terbuka, terkunci itu yang kena dikunci dan stoknya <= min"*) —
          Terkunci is a product its owner locked, or one whose minimum has closed it: ready stock at or under the
          minimum. Terbuka is every other — another team may take it now. */}
      <FilterGroup
        label={t("discover.filter.lock")}
        mark={<NotImplemented list={DISCOVER_PENDING} id="lockFilter" />}
        testId="discover-filter-lock"
      >
        <FilterChips
          value={value.lock}
          onChange={(lock) => onChange({ lock })}
          all=""
          allLabel={t("discover.range.all")}
          // The lock's own icons (ProductLock) — 🔓 for open, 🔒 for locked, as the card's badge.
          options={[
            {
              value: "open" as const,
              label: t("discover.lockFilter.open"),
              title: t("discover.lockFilter.openHint"),
              icon: lockIconOf("open"),
            },
            {
              value: "locked" as const,
              label: t("discover.lockFilter.locked"),
              title: t("discover.lockFilter.lockedHint"),
              icon: lockIconOf("always"),
            },
          ]}
          ariaLabel={t("discover.filter.lock")}
          testId="discover-lock-filter"
        />
      </FilterGroup>

      {sort && (
        <FilterGroup label={t("discover.sort.label")} testId="discover-filter-sort">
          {sort}
        </FilterGroup>
      )}
    </>
  );
}
