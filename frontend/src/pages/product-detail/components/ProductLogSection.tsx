import { useState } from "react";
import { Flex, HStack, Icon, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowRight, History } from "lucide-react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../../api/clients";
import { Section } from "../../../components/chrome/DetailSection";
import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { ActorName } from "../../../components/entity/ActorName";
import { useProductLogs } from "../../../features/products/productLogs";
import { idsOnceRead, useScreenPeople } from "../../../features/users/queries";
import { unnamed } from "../../../features/users/screenPeople";
import type { ProductLog } from "../../../gen/warehouse/product/v1/product_log_pb";
import { formatUnixDateTime } from "../../../lib/datetime";
import { personName } from "../../../lib/users";
import { productSection, productSectionDomId } from "../sections";

const PAGE_SIZE = 10;

// THE RIWAYAT PRODUK CARD (backlog #150; the-team-code-and-product-tags-prototype-is-accepted, *the history*: its own card
// after Produk Turunan, with a *Riwayat* nav entry — not a row in Info). The product's own changes, newest first: today
// the code it took when its team's code changed (a-team-code-change-recomposes-its-product-codes) — old → new, who, when.
// ProductLogList, paged (HARD RULE 9); the people named by ONE UserByIDs (useScreenPeople), an override with the shared
// "by Root team" badge. The page draws it for the owning team's roles, Root and the Administrator only — never on a
// warehouse's product page or Discover (those are other pages).
export function ProductLogSection({ teamId, productId }: { teamId: bigint; productId: bigint }) {
  const { t } = useTranslation();
  const entry = productSection("history");
  const [page, setPage] = useState(1);

  const logs = useProductLogs({ teamId, productId, page, pageSize: PAGE_SIZE });
  const people = useScreenPeople([idsOnceRead(logs, (data) => data.logs.map((log) => log.actorId))]);

  const lines = logs.data?.logs ?? [];
  const total = logs.data?.totalItems ?? 0;
  const fits = page === 1 && total <= PAGE_SIZE;

  const nameOf = (id: bigint) => personName(people.byId?.get(id.toString()) ?? unnamed(id));

  return (
    <Section id={productSectionDomId("history")} icon={History} title={t(entry.titleKey)} testId="pd-section-history">
      {logs.isPending ? (
        <Spinner colorPalette="brand" size="sm" data-testid="product-history-loading" />
      ) : logs.isError ? (
        <Text color="error.fg" fontSize="sm" data-testid="product-history-error">
          {rpcError(logs.error)}
        </Text>
      ) : lines.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" data-testid="product-history-none">
          {t("products.history.none")}
        </Text>
      ) : (
        <Stack gap="2">
          <RefreshOverlay busy={logs.isFetching && !logs.isPending}>
            <Stack gap="0" divideY="1px" data-testid="product-history">
              {lines.map((log) => (
                <HistoryLine key={log.id.toString()} log={log} by={log.actorId > 0n ? nameOf(log.actorId) : ""} />
              ))}
            </Stack>
          </RefreshOverlay>

          {!fits && (
            <Flex justify="end">
              <GrowingPager
                page={page}
                onPageChange={setPage}
                hasNext={logs.isPlaceholderData ? undefined : page * PAGE_SIZE < total}
                resetKey={productId.toString()}
                pageSize={PAGE_SIZE}
                testId="product-history-pager"
              />
            </Flex>
          )}
        </Stack>
      )}
    </Section>
  );
}

function HistoryLine({ log, by }: { log: ProductLog; by: string }) {
  const { t } = useTranslation();

  return (
    <Stack gap="1" py="2.5" data-testid={`product-history-line-${log.id}`}>
      <HStack gap="2" justify="space-between" wrap="wrap">
        <Text fontSize="sm" fontWeight="bold">
          {t("products.history.codeChanged")}
        </Text>
        <Text fontSize="xs" color="fg.muted" data-testid={`product-history-line-${log.id}-at`}>
          {formatUnixDateTime(log.createdAtUnix)}
        </Text>
      </HStack>
      {/* Old → new, each code whole (a code is read and typed, never cut). */}
      <HStack gap="1.5" wrap="wrap" fontFamily="mono" fontSize="sm">
        <Text as="span" color="fg.muted" textDecoration="line-through" data-testid={`product-history-line-${log.id}-old`}>
          {log.oldCode}
        </Text>
        <Icon as={ArrowRight} boxSize="3.5" color="fg.muted" />
        <Text as="span" fontWeight="bold" data-testid={`product-history-line-${log.id}-new`}>
          {log.newCode}
        </Text>
      </HStack>
      {by && (
        <Text as="div" fontSize="xs" color="fg.muted">
          <ActorName
            name={t("products.history.by", { name: by })}
            isOverride={log.isOverride}
            size="xs"
            testId={`product-history-line-${log.id}-by`}
          />
        </Text>
      )}
    </Stack>
  );
}
