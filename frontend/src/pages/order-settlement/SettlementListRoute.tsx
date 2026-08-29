import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Stack } from "@chakra-ui/react";

import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useTeam } from "../../features/team/TeamContext";
import { useOrderSettlements } from "../../features/settlement/queries";
import { OrderSettlementPage } from "./index";

// THE ROUTE-LEVEL CONTAINER for the settlement list.
//
// ⚠ It is separate from `OrderSettlementPage` on purpose. That component takes its rows as a PROP,
// which is what lets its 29 story tests pin the design without a server — the prototype was reviewed
// and accepted in exactly that shape (`design-accepted`), so wiring it up must not rewrite it. The
// query lives here instead, and the accepted component is used unchanged.
const PAGE_SIZE = 25;

export function SettlementListRoute() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const teamId = current?.teamId;
  const query = useOrderSettlements({ teamId, page, pageSize: PAGE_SIZE });

  return (
    <Stack gap="section">
      {/*
        The pair from HARD RULE 10: always-fresh reads, and the PREVIOUS rows kept on screen while
        the next ones load. `isPending` is excluded — a genuine first load has no rows to keep, and
        dimming an empty table behind a progress bar is two spinners for one wait.
      */}
      <RefreshOverlay busy={query.isFetching && !query.isPending}>
        <OrderSettlementPage
          orders={query.data?.settlements ?? []}
          onOpenOrder={(orderId) => navigate(`/orders/${orderId}`)}
        />
      </RefreshOverlay>

      <Box>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          count={query.data?.totalItems ?? 0}
          onPageChange={setPage}
        />
      </Box>
    </Stack>
  );
}
