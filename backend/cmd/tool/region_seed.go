package main

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

// The pinned upstream sources for region_service's reference data (#113).
//
// Indonesia's administrative regions come from the Kemendagri-official, actively maintained pair by
// cahya dsn (MIT): `wilayah` (the regions) and `wilayah_kodepos` (the postcodes). Same maintainer,
// same 10-digit kode wilayah key, so a kode pos joins cleanly onto its desa row instead of being
// name-matched. External reference data — no clean-slate conflict.
//
// PINNED BY COMMIT SHA, never a branch: `master` moves whenever the government revises the wilayah
// (roughly yearly), and an unpinned fetch would silently change the seed under us. Bumping the
// edition is a deliberate act — change the SHA, re-run, review the diff.
const (
	wilayahSourceRepo = "cahyadsn/wilayah"
	wilayahSourcePath = "db/wilayah.sql"
	wilayahSourceSHA  = "d68e8d5516f969d1905d0b2940f20034becb0db7"

	kodeposSourceRepo = "cahyadsn/wilayah_kodepos"
	kodeposSourcePath = "db/wilayah_kodepos.sql"
	kodeposSourceSHA  = "e007157ccd3b3fdade7277245a35cd9d89fbf15a"

	// The edition BOTH pinned dumps declare in their own header. (The #112 plan cites
	// "300.2.2-2430/2025"; upstream ships this one, and its volume matches the plan's counts.)
	kepmendagriEdition = "Kepmendagri No 300.2.2-2138 Tahun 2025"
)

var (
	// A wilayah tuple: ('11.01.02.2018','Pasi Kuala Ba''u').
	//
	// The name may contain a DOUBLED single quote — SQL's escape for an apostrophe. 475 rows do
	// ("Ba''u", "Tanose''o", …). A name pattern of [^']* silently DROPS every one of them, which is
	// why the alternation below allows '' explicitly, and why parseWilayah cross-checks its row
	// count against the number of tuple lines.
	wilayahTuple = regexp.MustCompile(`\('([0-9.]+)','((?:[^']|'')*)'\)`)

	// A kodepos tuple: ('11.01.01.2001', '23773') — note the space, and that the code may be blank.
	kodeposTuple = regexp.MustCompile(`\('([0-9.]+)',\s*'([0-9]*)'\)`)

	// Every data line in these dumps starts a tuple. Counting these is how we prove the tuple regex
	// above didn't skip anything.
	tupleLine = regexp.MustCompile(`(?m)^\(`)
)

// region is one administrative row on its way to the CSV.
type region struct {
	Code       string
	ParentCode string // empty for a provinsi
	Level      int    // 1=provinsi 2=kabupaten/kota 3=kecamatan 4=desa/kelurahan
	Name       string
	KodePos    string // level 4 only, may be empty where the source has none
}

func defaultRegionSeedPath() string {
	return filepath.Join(servicesRoot, "region_service", "db_migrations", "seed", "regions.csv")
}

func regionCommand() *cli.Command {
	return &cli.Command{
		Name:  "region",
		Usage: "region_service reference data (Indonesian wilayah + kode pos)",
		Commands: []*cli.Command{
			{
				Name: "build-seed",
				Usage: "download the PINNED wilayah + kodepos dumps and write the regions CSV seed " +
					"(reproducible: same SHAs in, same CSV out)",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:  "out",
						Usage: "output CSV path (relative to ./backend)",
						Value: defaultRegionSeedPath(),
					},
					&cli.StringFlag{
						Name:  "wilayah-sha",
						Usage: "override the pinned cahyadsn/wilayah commit",
						Value: wilayahSourceSHA,
					},
					&cli.StringFlag{
						Name:  "kodepos-sha",
						Usage: "override the pinned cahyadsn/wilayah_kodepos commit",
						Value: kodeposSourceSHA,
					},
				},
				Action: buildRegionSeed,
			},
			{
				Name: "load-seed",
				Usage: "load the generated regions CSV into a database (idempotent upsert) — run " +
					"after `migrate up --service region_service`",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:  "file",
						Usage: "path to the generated regions CSV (relative to ./backend)",
						Value: defaultRegionSeedPath(),
					},
					&cli.StringFlag{
						Name:    "dsn",
						Sources: cli.EnvVars("DATABASE_URL"),
						Usage:   "postgres DSN; skips the Local/Production prompt",
					},
				},
				Action: loadRegionSeed,
			},
		},
	}
}

// regionInsertBatch is how many rows go in one multi-row INSERT. 1.000 rows x 5 columns = 5.000
// placeholders, comfortably under Postgres's 65.535-parameter ceiling.
const regionInsertBatch = 1000

// loadRegionSeed COPYs the generated CSV into `regions`.
//
// Why here and not inside the goose migration: Postgres runs in Docker and cannot read a host file,
// so a server-side `COPY ... FROM '<path>'` in a .sql migration would not work; and a Go goose
// migration would have to be registered into every binary that runs goose (the tool AND san_testdb),
// which is a footgun the moment someone forgets the blank import. Loading reference data from a file
// through the tool is the same shape as `seed categories`.
//
// Idempotent: an upsert on the code, so re-running (or a later edition bump) updates names and adds
// new rows in place. NOTE: a region REMOVED upstream is not deleted here — a full sync would need a
// delete pass, which is only worth building when an edition bump actually drops one.
func loadRegionSeed(ctx context.Context, cmd *cli.Command) error {
	path := cmd.String("file")

	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("opening seed (run `region build-seed` first): %w", err)
	}
	defer file.Close()

	rows, err := readSeedCSV(file)
	if err != nil {
		return err
	}

	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	fmt.Printf("loading %d regions into %s\n", len(rows), target)

	started := time.Now()

	// One transaction: a half-loaded country is worse than none, and the self-FK means order matters
	// (the CSV is sorted by code, so parents land before their children).
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // rolled back only if Commit did not happen

	for start := 0; start < len(rows); start += regionInsertBatch {
		end := min(start+regionInsertBatch, len(rows))

		err = insertRegionBatch(ctx, tx, rows[start:end])
		if err != nil {
			return fmt.Errorf("inserting rows %d..%d: %w", start, end, err)
		}
	}

	err = tx.Commit()
	if err != nil {
		return err
	}

	fmt.Printf("loaded %d regions in %s\n", len(rows), time.Since(started).Round(time.Millisecond))

	return nil
}

// readSeedCSV reads the generated CSV back into region rows, checking the header is the shape this
// loader expects rather than trusting column order.
func readSeedCSV(file io.Reader) ([]region, error) {
	reader := csv.NewReader(file)

	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("reading seed header: %w", err)
	}

	want := []string{"code", "parent_code", "level", "name", "kode_pos"}
	if strings.Join(header, ",") != strings.Join(want, ",") {
		return nil, fmt.Errorf("seed header is %v, expected %v — regenerate with `region build-seed`", header, want)
	}

	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}

	rows := make([]region, 0, len(records))
	for _, r := range records {
		level, convErr := strconv.Atoi(r[2])
		if convErr != nil {
			return nil, fmt.Errorf("kode %q has a non-numeric level %q", r[0], r[2])
		}

		rows = append(rows, region{Code: r[0], ParentCode: r[1], Level: level, Name: r[3], KodePos: r[4]})
	}

	return rows, nil
}

// insertRegionBatch upserts one batch. Empty parent_code / kode_pos become NULL — "no parent" and
// "no postcode" are absences, not empty strings.
func insertRegionBatch(ctx context.Context, tx *sql.Tx, batch []region) error {
	values := make([]string, 0, len(batch))
	args := make([]any, 0, len(batch)*5)

	for i, r := range batch {
		base := i * 5
		values = append(values, fmt.Sprintf("($%d,$%d,$%d,$%d,$%d)", base+1, base+2, base+3, base+4, base+5))
		args = append(args, r.Code, nullIfEmpty(r.ParentCode), r.Level, r.Name, nullIfEmpty(r.KodePos))
	}

	query := `
		INSERT INTO regions (code, parent_code, level, name, kode_pos)
		VALUES ` + strings.Join(values, ",") + `
		ON CONFLICT (code) DO UPDATE SET
			parent_code = EXCLUDED.parent_code,
			level       = EXCLUDED.level,
			name        = EXCLUDED.name,
			kode_pos    = EXCLUDED.kode_pos`

	_, err := tx.ExecContext(ctx, query, args...)

	return err
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}

	return s
}

// buildRegionSeed is the whole pipeline: fetch both pinned dumps, parse them, join kode pos onto the
// desa rows, verify the result hangs together, and write a deterministic CSV that #114's migration
// loads. It is a documented, repeatable step — not a one-off manual import.
func buildRegionSeed(ctx context.Context, cmd *cli.Command) error {
	wilayahSHA := cmd.String("wilayah-sha")
	kodeposSHA := cmd.String("kodepos-sha")
	out := cmd.String("out")

	fmt.Printf("region seed — %s\n", kepmendagriEdition)
	fmt.Printf("  wilayah  %s@%s\n", wilayahSourceRepo, wilayahSHA[:12])
	fmt.Printf("  kodepos  %s@%s\n", kodeposSourceRepo, kodeposSHA[:12])

	wilayahSQL, err := fetchRaw(ctx, wilayahSourceRepo, wilayahSHA, wilayahSourcePath)
	if err != nil {
		return fmt.Errorf("fetching wilayah: %w", err)
	}

	kodeposSQL, err := fetchRaw(ctx, kodeposSourceRepo, kodeposSHA, kodeposSourcePath)
	if err != nil {
		return fmt.Errorf("fetching kodepos: %w", err)
	}

	regions, err := parseWilayah(wilayahSQL)
	if err != nil {
		return err
	}

	postcodes, err := parseKodepos(kodeposSQL)
	if err != nil {
		return err
	}

	attached := attachKodePos(regions, postcodes)

	err = validate(regions)
	if err != nil {
		return err
	}

	err = writeCSV(out, regions)
	if err != nil {
		return err
	}

	report(regions, postcodes, attached, out)

	return nil
}

// fetchRaw pulls one file at an exact commit from raw.githubusercontent.
func fetchRaw(ctx context.Context, repo, sha, path string) ([]byte, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", repo, sha, path)

	reqCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}

	return io.ReadAll(resp.Body)
}

// parseWilayah turns the MySQL dump into region rows. The level and the parent are DERIVED from the
// dotted kode ("11" → "11.01" → "11.01.01" → "11.01.01.2001"), which is the whole reason the single
// self-referential table (§4.2 option A) is a near-verbatim load of this source.
func parseWilayah(sql []byte) ([]region, error) {
	matches := wilayahTuple.FindAllSubmatch(sql, -1)

	regions := make([]region, 0, len(matches))
	for _, m := range matches {
		code := string(m[1])
		level := strings.Count(code, ".") + 1

		if level < 1 || level > 4 {
			return nil, fmt.Errorf("kode %q has %d segments — expected 1..4", code, level)
		}

		parent := ""
		if idx := strings.LastIndex(code, "."); idx >= 0 {
			parent = code[:idx]
		}

		regions = append(regions, region{
			Code:       code,
			ParentCode: parent,
			Level:      level,
			// '' is SQL's escaped apostrophe — restore it.
			Name: strings.ReplaceAll(string(m[2]), "''", "'"),
		})
	}

	// The load-bearing check: every tuple line must have produced a row. If upstream changes how it
	// quotes a name, this fails LOUDLY rather than quietly seeding a country with holes in it.
	if lines := len(tupleLine.FindAll(sql, -1)); lines != len(regions) {
		return nil, fmt.Errorf(
			"parsed %d wilayah rows but the dump has %d tuple lines — the tuple regex is dropping rows",
			len(regions), lines,
		)
	}

	// Sorting by code is what makes the CSV deterministic, and it emits parents before children.
	sort.Slice(regions, func(i, j int) bool { return regions[i].Code < regions[j].Code })

	return regions, nil
}

// parseKodepos maps the 10-digit desa kode to its (best-effort, one-per-desa) postcode.
func parseKodepos(sql []byte) (map[string]string, error) {
	matches := kodeposTuple.FindAllSubmatch(sql, -1)

	postcodes := make(map[string]string, len(matches))
	for _, m := range matches {
		code, pos := string(m[1]), string(m[2])
		if pos == "" {
			continue
		}

		postcodes[code] = pos
	}

	if len(postcodes) == 0 {
		return nil, fmt.Errorf("no kodepos rows parsed — the dump format changed")
	}

	return postcodes, nil
}

// attachKodePos joins the postcodes onto the desa (level-4) rows and reports how many landed.
func attachKodePos(regions []region, postcodes map[string]string) int {
	attached := 0

	for i := range regions {
		if regions[i].Level != 4 {
			continue
		}

		if pos, ok := postcodes[regions[i].Code]; ok {
			regions[i].KodePos = pos
			attached++
		}
	}

	return attached
}

// validate proves the tree hangs together before it is written: every non-provinsi row's parent must
// exist, and be exactly one level up. A seed with an orphan is a picker that dead-ends.
func validate(regions []region) error {
	byCode := make(map[string]region, len(regions))
	for _, r := range regions {
		if _, dup := byCode[r.Code]; dup {
			return fmt.Errorf("duplicate kode %q", r.Code)
		}

		byCode[r.Code] = r
	}

	for _, r := range regions {
		if r.Level == 1 {
			if r.ParentCode != "" {
				return fmt.Errorf("provinsi %q has parent %q", r.Code, r.ParentCode)
			}

			continue
		}

		parent, ok := byCode[r.ParentCode]
		if !ok {
			return fmt.Errorf("kode %q references a parent %q that does not exist", r.Code, r.ParentCode)
		}

		if parent.Level != r.Level-1 {
			return fmt.Errorf(
				"kode %q (level %d) has parent %q at level %d", r.Code, r.Level, parent.Code, parent.Level,
			)
		}
	}

	return nil
}

// writeCSV emits code,parent_code,level,name,kode_pos with a header — the shape #114's migration
// COPYs in. Empty string means NULL (no parent / no postcode).
func writeCSV(out string, regions []region) error {
	err := os.MkdirAll(filepath.Dir(out), 0o755)
	if err != nil {
		return err
	}

	file, err := os.Create(out)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)

	err = writer.Write([]string{"code", "parent_code", "level", "name", "kode_pos"})
	if err != nil {
		return err
	}

	for _, r := range regions {
		err = writer.Write([]string{r.Code, r.ParentCode, strconv.Itoa(r.Level), r.Name, r.KodePos})
		if err != nil {
			return err
		}
	}

	writer.Flush()

	return writer.Error()
}

func report(regions []region, postcodes map[string]string, attached int, out string) {
	levels := map[int]int{}
	for _, r := range regions {
		levels[r.Level]++
	}

	desa := levels[4]

	fmt.Printf("\n  provinsi        %6d\n", levels[1])
	fmt.Printf("  kabupaten/kota  %6d\n", levels[2])
	fmt.Printf("  kecamatan       %6d\n", levels[3])
	fmt.Printf("  desa/kelurahan  %6d\n", desa)
	fmt.Printf("  total           %6d\n", len(regions))
	fmt.Printf("\n  kode pos: %d of %d desa (%d source rows); %d desa have none\n",
		attached, desa, len(postcodes), desa-attached)
	fmt.Printf("\nwrote %s\n", out)
}
