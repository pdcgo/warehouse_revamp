import type { ServiceImpl } from "@connectrpc/connect";

import type { WarehouseInfoService } from "../src/gen/warehouse/warehouse/v1/warehouse_info_pb";

// THE WAREHOUSE PROFILE, as warehouse_service serves it (the-warehouse-profile-lives-in-warehouse-service). In the
// samples Gudang Pusat (11) receives orders now, and Gudang Cabang (14) is closed for a holiday until a fixed opening,
// so the order form's closed-day warning has something to say (a-closed-day-warns-and-never-refuses).
export const CABANG_REOPENS = BigInt(Date.UTC(2026, 9, 9, 1, 0) / 1000); // 9 Oct 2026, 08:00 WIB

export const warehouseInfoService: Partial<ServiceImpl<typeof WarehouseInfoService>> = {
  warehouseReceivingStatus: (req) => ({
    states: Object.fromEntries(
      req.warehouseIds.map((id) => [
        id.toString(),
        id === 14n
          ? { warehouseId: id, receivingNow: false, nextOpeningUnix: CABANG_REOPENS, closureReason: "Idul Fitri" }
          : { warehouseId: id, receivingNow: true, nextOpeningUnix: 0n, closureReason: "" },
      ]),
    ),
  }),
  warehouseInfoDetail: (req) => ({ info: { teamId: req.teamId, operatingHours: [], receivingHours: [], location: "", closures: [] } }),
};
