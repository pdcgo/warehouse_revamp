package region_service_models

// Region is a row of `regions` — one Indonesian administrative area, at one of four levels. Schema
// owned by goose (db_migrations); GORM only reads and writes rows (no AutoMigrate).
//
// This is GLOBAL reference data: unlike almost every other model in this system there is no team_id,
// because regions are the same for everyone (plan §4.4). The rows are loaded from the generated CSV
// seed (`go run ./cmd/tool region load-seed`), not typed in.
type Region struct {
	// The dotted kode wilayah ('11.01.01.2001') — the government's key, and the primary key here.
	Code string `gorm:"primaryKey"`
	// The code with its last segment removed; empty/NULL for a provinsi.
	ParentCode *string
	// 1=provinsi 2=kabupaten/kota 3=kecamatan 4=desa/kelurahan.
	Level int
	Name  string
	// Level 4 only; NULL elsewhere (and where a future edition lacks one).
	KodePos *string
}

func (Region) TableName() string {
	return "regions"
}

// The four administrative levels, named so a caller never passes a bare integer around.
const (
	LevelProvinsi  = 1
	LevelKabupaten = 2
	LevelKecamatan = 3
	LevelDesa      = 4
)
