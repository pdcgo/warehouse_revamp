package warehouse_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// THE WAREHOUSE PROFILE (the-warehouse-profile-lives-in-warehouse-service) — moved whole from team_service, its
// policies unchanged. ⚠ my build detail: it no longer asks whether a team is a warehouse — that would be a read of
// team_service's table. The update is gated by a WAREHOUSE role, which exists only on a warehouse team, and a team with
// no profile reads as closed every day.

var errBadDay = errors.New("a day must be YYYY-MM-DD")

// jakarta is the warehouse's clock: a grid's "08:00", a closure's day and the next opening are all Asia/Jakarta.
var jakarta = time.FixedZone("WIB", 7*60*60)

const dayLayout = "2006-01-02"

// WarehouseInfoDetail is a warehouse's profile — its grids, its location and its closures still to come. Any
// authenticated caller: a selling team needs to know when a warehouse receives its orders.
func (s *Service) WarehouseInfoDetail(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseInfoDetailRequest],
) (*connect.Response[warehousev1.WarehouseInfoDetailResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	out := &warehousev1.WarehouseInfo{TeamId: warehouseID}

	var info warehouse_service_models.WarehouseInfo

	err := s.db.WithContext(ctx).Where("warehouse_id = ?", warehouseID).Take(&info).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// No hours set yet — empty grids, closed every day, not an error.
	case err != nil:
		return nil, dbError(err)
	default:
		out, err = warehouseInfoToProto(&info)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	closures, err := s.upcomingClosures(ctx, []uint64{warehouseID}, time.Now())
	if err != nil {
		return nil, dbError(err)
	}

	for i := range closures[warehouseID] {
		out.Closures = append(out.Closures, closureToProto(&closures[warehouseID][i]))
	}

	return connect.NewResponse(&warehousev1.WarehouseInfoDetailResponse{Info: out}), nil
}

// WarehouseInfoUpdate REPLACES both grids and the location — the editor sends the whole weekly grid — by an upsert on
// the warehouse. Scoped: a warehouse manager edits their own.
func (s *Service) WarehouseInfoUpdate(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseInfoUpdateRequest],
) (*connect.Response[warehousev1.WarehouseInfoUpdateResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	operating, err := validateSchedule(req.Msg.GetOperatingHours())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	receiving, err := validateSchedule(req.Msg.GetReceivingHours())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	operatingJSON, err := encodeSchedule(operating)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	receivingJSON, err := encodeSchedule(receiving)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	row := warehouse_service_models.WarehouseInfo{
		WarehouseID:    warehouseID,
		OperatingHours: operatingJSON,
		ReceivingHours: receivingJSON,
		Location:       req.Msg.GetLocation(),
	}

	err = s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "warehouse_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"operating_hours": operatingJSON,
				"receiving_hours": receivingJSON,
				"location":        req.Msg.GetLocation(),
				"updated_at":      gorm.Expr("NOW()"),
			}),
		}).
		Create(&row).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	var info warehouse_service_models.WarehouseInfo

	err = s.db.WithContext(ctx).Where("warehouse_id = ?", warehouseID).Take(&info).Error
	if err != nil {
		return nil, dbError(err)
	}

	out, err := warehouseInfoToProto(&info)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&warehousev1.WarehouseInfoUpdateResponse{Info: out}), nil
}

// WarehouseClosureAdd records one one-off closure (a-warehouse-records-its-holidays) — whole days, both inclusive.
func (s *Service) WarehouseClosureAdd(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseClosureAddRequest],
) (*connect.Response[warehousev1.WarehouseClosureAddResponse], error) {
	first, err := time.Parse(dayLayout, req.Msg.GetFirstDay())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errBadDay)
	}

	last, err := time.Parse(dayLayout, req.Msg.GetLastDay())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errBadDay)
	}

	if last.Before(first) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a closure's last day is before its first"))
	}

	if req.Msg.GetReason() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a closure names its reason — the warning shows it"))
	}

	row := warehouse_service_models.WarehouseClosure{
		WarehouseID: req.Msg.GetTeamId(),
		FirstDay:    first,
		LastDay:     last,
		Reason:      req.Msg.GetReason(),
	}

	err = s.db.WithContext(ctx).Create(&row).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&warehousev1.WarehouseClosureAddResponse{Closure: closureToProto(&row)}), nil
}

// WarehouseClosureDelete removes one closure of the scoped warehouse. Another warehouse's, or a missing one, is
// NotFound.
func (s *Service) WarehouseClosureDelete(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseClosureDeleteRequest],
) (*connect.Response[warehousev1.WarehouseClosureDeleteResponse], error) {
	result := s.db.WithContext(ctx).
		Where("id = ? AND warehouse_id = ?", req.Msg.GetClosureId(), req.Msg.GetTeamId()).
		Delete(&warehouse_service_models.WarehouseClosure{})
	if result.Error != nil {
		return nil, dbError(result.Error)
	}

	if result.RowsAffected == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("closure not found"))
	}

	return connect.NewResponse(&warehousev1.WarehouseClosureDeleteResponse{}), nil
}

// WarehouseReceivingStatus answers, for each asked warehouse, whether it receives orders NOW and, if not, when next and
// why (a-closed-day-warns-and-never-refuses). It refuses nothing: the order form and the picker only MARK a closed one.
func (s *Service) WarehouseReceivingStatus(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseReceivingStatusRequest],
) (*connect.Response[warehousev1.WarehouseReceivingStatusResponse], error) {
	ids := req.Msg.GetWarehouseIds()
	now := time.Now()

	var infos []warehouse_service_models.WarehouseInfo

	err := s.db.WithContext(ctx).Where("warehouse_id IN ?", ids).Find(&infos).Error
	if err != nil {
		return nil, dbError(err)
	}

	grids := make(map[uint64][]dayHoursJSON, len(infos))
	for i := range infos {
		grid, err := scheduleOf(infos[i].ReceivingHours)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		grids[infos[i].WarehouseID] = grid
	}

	closures, err := s.upcomingClosures(ctx, ids, now)
	if err != nil {
		return nil, dbError(err)
	}

	states := make(map[uint64]*warehousev1.WarehouseReceivingState, len(ids))
	for _, id := range ids {
		state := receivingState(now, grids[id], closures[id])
		state.WarehouseId = id
		states[id] = state
	}

	return connect.NewResponse(&warehousev1.WarehouseReceivingStatusResponse{States: states}), nil
}

// upcomingClosures is each warehouse's closures whose last day is today or later, in Asia/Jakarta, earliest first.
func (s *Service) upcomingClosures(
	ctx context.Context,
	ids []uint64,
	now time.Time,
) (map[uint64][]warehouse_service_models.WarehouseClosure, error) {
	var rows []warehouse_service_models.WarehouseClosure

	err := s.db.WithContext(ctx).
		Where("warehouse_id IN ? AND last_day >= ?", ids, now.In(jakarta).Format(dayLayout)).
		Order("first_day ASC, id ASC").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64][]warehouse_service_models.WarehouseClosure, len(ids))
	for _, row := range rows {
		out[row.WarehouseID] = append(out[row.WarehouseID], row)
	}

	return out, nil
}

func closureToProto(c *warehouse_service_models.WarehouseClosure) *warehousev1.WarehouseClosure {
	return &warehousev1.WarehouseClosure{
		Id:          c.ID,
		WarehouseId: c.WarehouseID,
		FirstDay:    c.FirstDay.Format(dayLayout),
		LastDay:     c.LastDay.Format(dayLayout),
		Reason:      c.Reason,
	}
}

// warehouseInfoToProto builds the proto from a stored row, decoding both JSONB grids.
func warehouseInfoToProto(info *warehouse_service_models.WarehouseInfo) (*warehousev1.WarehouseInfo, error) {
	operating, err := decodeSchedule(info.OperatingHours)
	if err != nil {
		return nil, err
	}

	receiving, err := decodeSchedule(info.ReceivingHours)
	if err != nil {
		return nil, err
	}

	return &warehousev1.WarehouseInfo{
		TeamId:         info.WarehouseID,
		OperatingHours: operating,
		ReceivingHours: receiving,
		Location:       info.Location,
	}, nil
}
