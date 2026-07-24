// Package region_v1 implements warehouse.region.v1.RegionService — Indonesia's administrative
// regions (provinsi → kabupaten/kota → kecamatan → desa/kelurahan), the reference data behind the
// shared AddressPicker.
//
// Two things make this service unlike the others here:
//
//   - It is GLOBAL. There is no team scope on any RPC — regions are the same for everyone — so the
//     policies are `allow_only_authenticated` and no handler reads a team id (plan §4.4).
//   - It is READ-ONLY. The rows come from a pinned upstream seed (#113/#114), loaded by
//     `go run ./cmd/tool region load-seed`. Nothing writes regions through this API.
package region_v1

import (
	"strings"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1/regionv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ regionv1connect.RegionServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func regionToProto(r *region_service_models.Region) *regionv1.Region {
	out := &regionv1.Region{
		Code:  r.Code,
		Level: regionv1.RegionLevel(r.Level),
		Name:  r.Name,
	}

	if r.ParentCode != nil {
		out.ParentCode = *r.ParentCode
	}

	if r.KodePos != nil {
		out.KodePos = *r.KodePos
	}

	return out
}

// ancestorCodes returns every code from the provinsi down to `code` itself, inclusive:
//
//	"11.01.01.2001" → ["11", "11.01", "11.01.01", "11.01.01.2001"]
//
// The kode wilayah ENCODES its own ancestry, which is the quiet payoff of the single self-referential
// table: resolving a full address is one `WHERE code IN (...)` over at most four primary keys — no
// recursive CTE, no four joins, no walking the tree a row at a time.
func ancestorCodes(code string) []string {
	parts := strings.Split(code, ".")

	codes := make([]string, 0, len(parts))
	for i := 1; i <= len(parts); i++ {
		codes = append(codes, strings.Join(parts[:i], "."))
	}

	return codes
}

// buildAncestry flattens the chain leading to `code` into the shape a saved address snapshots.
// Levels below the resolved region stay empty (resolving a kecamatan yields no desa). A gap in the
// chain simply leaves that level empty rather than failing — the seed's integrity check is what
// guarantees there are none.
func buildAncestry(byCode map[string]region_service_models.Region, code string) *regionv1.RegionAncestry {
	ancestry := &regionv1.RegionAncestry{}

	for _, ancestorCode := range ancestorCodes(code) {
		row, ok := byCode[ancestorCode]
		if !ok {
			continue
		}

		switch row.Level {
		case region_service_models.LevelProvinsi:
			ancestry.ProvinsiCode, ancestry.ProvinsiName = row.Code, row.Name
		case region_service_models.LevelKabupaten:
			ancestry.KabupatenCode, ancestry.KabupatenName = row.Code, row.Name
		case region_service_models.LevelKecamatan:
			ancestry.KecamatanCode, ancestry.KecamatanName = row.Code, row.Name
		case region_service_models.LevelDesa:
			ancestry.DesaCode, ancestry.DesaName = row.Code, row.Name

			if row.KodePos != nil {
				ancestry.KodePos = *row.KodePos
			}
		}
	}

	return ancestry
}

// loadByCodes fetches many regions by primary key in ONE query and indexes them by code. Callers
// hand it the ancestor codes of everything they need to flatten.
func (s *Service) loadByCodes(tx *gorm.DB, codes []string) (map[string]region_service_models.Region, error) {
	if len(codes) == 0 {
		return map[string]region_service_models.Region{}, nil
	}

	var rows []region_service_models.Region

	err := tx.Where("code IN ?", codes).Find(&rows).Error
	if err != nil {
		return nil, err
	}

	byCode := make(map[string]region_service_models.Region, len(rows))
	for _, row := range rows {
		byCode[row.Code] = row
	}

	return byCode, nil
}

// pageOffset is the SQL OFFSET for a 1-based page.
func pageOffset(page *commonv1.PageFilter) int {
	return int((page.GetPage() - 1) * page.GetLimit())
}

// pageInfo builds the response PageInfo from the filter and the total row count.
func pageInfo(page *commonv1.PageFilter, total int64) *commonv1.PageInfo {
	var totalPage uint32

	limit := page.GetLimit()
	if limit > 0 {
		totalPage = uint32((total + int64(limit) - 1) / int64(limit))
	}

	return &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   totalPage,
		TotalItems:  uint64(total),
	}
}
