package product_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductLogList is a product's history, newest first, paged (backlog #149; HARD RULE 9) — today the `code_changed` lines
// a team code change writes (a-team-code-change-recomposes-its-product-codes): old code → new code, who, when, the
// product page's Riwayat Produk card (the-team-code-and-product-tags-prototype-is-accepted). Read by the team that OWNS the
// product (the request's policy keeps warehouses and other teams out); a product of another team — or none — is NotFound,
// archived ones answer.
func (s *Service) ProductLogList(
	ctx context.Context,
	req *connect.Request[productv1.ProductLogListRequest],
) (*connect.Response[productv1.ProductLogListResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()
	page := req.Msg.GetPage()

	db := s.db.WithContext(ctx)

	var owner []uint64

	err := db.
		Model(&product_service_models.Product{}).
		Where("id = ? AND team_id = ?", productID, teamID).
		Pluck("id", &owner).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if len(owner) == 0 {
		return nil, notFound()
	}

	query := db.
		Model(&product_service_models.ProductLog{}).
		Where("product_id = ?", productID)

	var total int64

	err = query.
		Session(&gorm.Session{}).
		Count(&total).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	var rows []product_service_models.ProductLog

	err = query.
		Session(&gorm.Session{}).
		Order("id DESC").
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	logs := make([]*productv1.ProductLog, 0, len(rows))
	for i := range rows {
		logs = append(logs, productLogToProto(&rows[i]))
	}

	return connect.NewResponse(&productv1.ProductLogListResponse{
		Logs: logs,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

func productLogToProto(row *product_service_models.ProductLog) *productv1.ProductLog {
	return &productv1.ProductLog{
		Id:            row.ID,
		ProductId:     row.ProductID,
		Kind:          productLogKindToProto(row.Kind),
		OldCode:       row.OldCode,
		NewCode:       row.NewCode,
		ActorId:       row.ActorID,
		IsOverride:    row.IsOverride,
		CreatedAtUnix: row.CreatedAt.Unix(),
	}
}

// productLogKindToProto maps the stored word to the wire enum; an unknown word is UNSPECIFIED, never a guess (the CHECK
// makes it unreachable).
func productLogKindToProto(kind string) productv1.ProductLogKind {
	switch kind {
	case product_service_models.ProductLogCodeChanged:
		return productv1.ProductLogKind_PRODUCT_LOG_KIND_CODE_CHANGED
	default:
		return productv1.ProductLogKind_PRODUCT_LOG_KIND_UNSPECIFIED
	}
}
