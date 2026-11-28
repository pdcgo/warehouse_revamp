//go:build raceaudit

// Concurrency audit for THE TEAM CODE EDIT (backlog #149, a-team-code-change-recomposes-its-product-codes): team_service's
// TeamCodeUpdate recomposes the team's products through the real seam (productCodeRecomposer → product_service's
// RecomposeTeamCodes), in one transaction. What must hold when people act at the same second:
//
//   - a ProductCreate (or a code correction) racing the change NEVER lands the old prefix: both take the team's
//     product-code advisory lock (lockTeamProductCodes) around their team-code read + write, so the create either commits
//     first and is recomposed with the rest, or waits and composes from the new code. Proven deterministically: the create
//     is PARKED inside its team-code read while the change runs;
//   - two teams changing to ONE code at once: the unique index on teams.team_code lets one through; the other is
//     AlreadyExists naming the winner (read after its failed transaction);
//   - two changes of ONE team at once: the team row's FOR UPDATE queues the second, which then reads the first's code —
//     both land, and every product carries the last code (never left under the first's);
//   - a custom tag put on / taken off while the recompose runs: disjoint rows (a custom link vs `need_reprint_code`'s), the
//     tag write's KEY SHARE on the product only makes the recompose's UPDATE wait — never a deadlock, never an error.
//
// Build-tagged: san_race COMMITS. It empties the product tables (as the product audits do) and removes its own teams
// (codes RCE…) before and after.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_TeamCode' -v ./backend/cmd/app_development/
package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// committedTeamCodes answers product_service's TeamCodes as the composition root does — TeamByIds over HTTP reads the
// COMMITTED team row, outside the writer's transaction — with an optional PARK: armed, the next read signals `read`
// after reading and waits for `release`, so a test can hold a create inside its team-code read.
type committedTeamCodes struct {
	db      *gorm.DB
	mu      sync.Mutex
	armed   bool
	read    chan string
	release chan struct{}
}

func (c *committedTeamCodes) arm() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.armed = true
	c.read = make(chan string, 1)
	c.release = make(chan struct{})
}

func (c *committedTeamCodes) TeamCode(ctx context.Context, teamID uint64) (string, error) {
	var codes []string

	err := c.db.WithContext(ctx).Raw("SELECT team_code FROM teams WHERE id = ? AND deleted = FALSE", teamID).Scan(&codes).Error
	if err != nil || len(codes) == 0 {
		return "", err
	}

	c.mu.Lock()
	armed := c.armed
	c.armed = false
	read, release := c.read, c.release
	c.mu.Unlock()

	if armed {
		read <- codes[0]
		<-release
	}

	return codes[0], nil
}

// shelvedEverywhere is the stock seam answering that ONE warehouse holds every product asked (the tag race needs tags put
// on); every other read of the seam is unused here.
type shelvedEverywhere struct {
	product_v1.StockNarrower
	warehouse uint64
}

func (s shelvedEverywhere) StockSitsAmong(_ context.Context, _ *gorm.DB, ids []uint64) ([]product_v1.ShelvedIn, error) {
	out := make([]product_v1.ShelvedIn, 0, len(ids))
	for _, id := range ids {
		out = append(out, product_v1.ShelvedIn{ProductID: id, WarehouseID: s.warehouse})
	}

	return out, nil
}

// neverUsed is the product history the correction asks: no product has any.
type neverUsed struct{}

func (neverUsed) ProductHasHistory(context.Context, uint64) (bool, error) { return false, nil }

type raceCodeWorld struct {
	h        *san_race.Harness
	codes    *committedTeamCodes
	products *product_v1.Service
	teams    *team_v1.Service
}

func newRaceCodeWorld(t *testing.T, stock product_v1.StockNarrower) raceCodeWorld {
	t.Helper()

	h := san_race.New(t, "product_logs", "product_reprint_waits", "product_tag_links", "bundle_products", "bundles",
		"product_images", "products")

	dropOwn := func(db *gorm.DB) {
		err := db.Exec(`DELETE FROM teams WHERE team_code LIKE 'RCE%'
			OR id IN (SELECT team_id FROM team_former_codes WHERE team_code LIKE 'RCE%')`).Error
		if err != nil {
			t.Errorf("drop the race's teams: %v", err)
		}

		err = db.Exec(`DELETE FROM product_tags WHERE lower(name) LIKE 'race-%' AND app_task = ''`).Error
		if err != nil {
			t.Errorf("drop the race's tags: %v", err)
		}
	}

	dropOwn(h.DB())
	t.Cleanup(func() { dropOwn(h.DB()) })

	if stock == nil {
		stock = NewProductStockNarrower(h.DB())
	}

	codes := &committedTeamCodes{db: h.DB()}
	products := product_v1.NewService(h.DB(), neverUsed{}, codes, stock, nil)

	return raceCodeWorld{h: h, codes: codes, products: products, teams: team_v1.NewService(h.DB(), nil, NewProductCodeRecomposer(products))}
}

func (w raceCodeWorld) team(t *testing.T, name, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: "selling", Name: name, TeamCode: code}

	err := w.h.DB().Create(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team.ID
}

func (w raceCodeWorld) product(t *testing.T, teamID uint64, code string) uint64 {
	t.Helper()

	p := product_service_models.Product{TeamID: teamID, ProductCode: code, Name: "Race " + code, CategoryID: 1}

	err := w.h.DB().Create(&p).Error
	if err != nil {
		t.Fatal(err)
	}

	return p.ID
}

func (w raceCodeWorld) change(teamID uint64, code string) error {
	_, err := w.teams.TeamCodeUpdate(asOwnerOf(teamID), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: teamID, TeamCode: code}))

	return err
}

// codesOfTeam is every product code of the team, sorted.
func (w raceCodeWorld) codesOfTeam(t *testing.T, teamID uint64) []string {
	t.Helper()

	var codes []string

	err := w.h.DB().Raw("SELECT product_code FROM products WHERE team_id = ? ORDER BY product_code", teamID).Scan(&codes).Error
	if err != nil {
		t.Fatal(err)
	}

	return codes
}

func (w raceCodeWorld) teamCode(t *testing.T, teamID uint64) string {
	t.Helper()

	var code string

	err := w.h.DB().Raw("SELECT team_code FROM teams WHERE id = ?", teamID).Scan(&code).Error
	if err != nil {
		t.Fatal(err)
	}

	return code
}

// parkedThenChanged runs `write` with its team-code read PARKED, then the team code change ABC → XYZ beside it, and
// releases the write once the change has either finished or been held for a while. It answers whether the change
// finished while the write was parked (true = nothing serialised them).
func (w raceCodeWorld) parkedThenChanged(t *testing.T, teamID uint64, newCode string, write func() error) (changedWhileParked bool) {
	t.Helper()

	w.codes.arm()

	writeDone := make(chan error, 1)

	go func() { writeDone <- write() }()

	select {
	case <-w.codes.read:
	case err := <-writeDone:
		t.Fatalf("the write ended before reading the team code: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("the write never read the team code")
	}

	changeDone := make(chan error, 1)

	go func() { changeDone <- w.change(teamID, newCode) }()

	select {
	case err := <-changeDone:
		changedWhileParked = true

		if err != nil {
			t.Fatalf("the change: %v", err)
		}

		close(w.codes.release)
	case <-time.After(1500 * time.Millisecond):
		// Held: the change waits on the write's lock. Let the write finish, then the change.
		close(w.codes.release)

		err := <-changeDone
		if err != nil {
			t.Fatalf("the change after the write: %v", err)
		}
	}

	err := <-writeDone
	if err != nil {
		t.Fatalf("the write: %v", err)
	}

	return changedWhileParked
}

// A PRODUCTCREATE RACING THE CHANGE NEVER LANDS THE OLD PREFIX: the create reads ABC and is parked there; the change runs
// beside it. Under the product-code lock the change waits, the create commits ABC-NEW-1, and the change's recompose takes
// it to XYZ-NEW-1 with the rest. Without the lock the change finishes first and the create lands ABC-NEW-1 under a team
// that is XYZ now — the stale prefix.
func TestRace_TeamCodeChange_ACreateNeverLandsTheOldPrefix(t *testing.T) {
	w := newRaceCodeWorld(t, nil)

	for round := range 3 {
		oldCode, newCode := fmt.Sprintf("RCE%d-ABC", round), fmt.Sprintf("RCE%d-XYZ", round)
		team := w.team(t, fmt.Sprintf("Toko Race %d", round), oldCode)
		w.product(t, team, oldCode+"-SHOE")

		raced := w.parkedThenChanged(t, team, newCode, func() error {
			_, err := w.products.ProductCreate(asOwnerOf(team), connect.NewRequest(&productv1.ProductCreateRequest{
				TeamId: team, ProductCodePart: "NEW-1", Name: "Baru", CategoryId: 1,
			}))

			return err
		})

		codes := w.codesOfTeam(t, team)
		t.Logf("round %d: change finished while the create was parked = %v; codes %v", round, raced, codes)

		for _, code := range codes {
			if !strings.HasPrefix(code, newCode+"-") {
				t.Fatalf("round %d: product %q under the old prefix — team is %s", round, code, w.teamCode(t, team))
			}
		}

		if len(codes) != 2 {
			t.Fatalf("round %d: %d products, want 2", round, len(codes))
		}
	}
}

// A CORRECTION RACING THE CHANGE: the same, for ProductUpdate's code correction of a never-used product.
func TestRace_TeamCodeChange_ACorrectionNeverLandsTheOldPrefix(t *testing.T) {
	w := newRaceCodeWorld(t, nil)

	for round := range 3 {
		oldCode, newCode := fmt.Sprintf("RCE%d-FIX", round), fmt.Sprintf("RCE%d-NEW", round)
		team := w.team(t, fmt.Sprintf("Toko Koreksi %d", round), oldCode)
		id := w.product(t, team, oldCode+"-TYPO")

		raced := w.parkedThenChanged(t, team, newCode, func() error {
			_, err := w.products.ProductUpdate(asOwnerOf(team), connect.NewRequest(&productv1.ProductUpdateRequest{
				TeamId: team, ProductId: id, ProductCodePart: proto.String("RIGHT"),
			}))

			return err
		})

		codes := w.codesOfTeam(t, team)
		t.Logf("round %d: change finished while the correction was parked = %v; codes %v", round, raced, codes)

		if len(codes) != 1 || codes[0] != newCode+"-RIGHT" {
			t.Fatalf("round %d: codes %v, want [%s-RIGHT]", round, codes, newCode)
		}
	}
}

// TWO TEAMS CHANGING TO ONE CODE AT ONCE: one wins; the other is AlreadyExists naming the winner, and its products keep its
// own code.
func TestRace_TeamCodeChange_TwoTeamsToOneCode(t *testing.T) {
	w := newRaceCodeWorld(t, nil)

	for round := range 5 {
		target := fmt.Sprintf("RCE%d-SAME", round)
		a := w.team(t, fmt.Sprintf("Toko A %d", round), fmt.Sprintf("RCE%d-A", round))
		b := w.team(t, fmt.Sprintf("Toko B %d", round), fmt.Sprintf("RCE%d-B", round))
		w.product(t, a, fmt.Sprintf("RCE%d-A-1", round))
		w.product(t, b, fmt.Sprintf("RCE%d-B-1", round))

		teams := []uint64{a, b}
		names := map[uint64]string{a: fmt.Sprintf("Toko A %d", round), b: fmt.Sprintf("Toko B %d", round)}

		res := w.h.Race(t, 2, func(i int) error { return w.change(teams[i], target) })
		res.Report(t)

		if res.Count(san_race.None) != 1 {
			t.Fatalf("round %d: %d changes landed, want exactly 1", round, res.Count(san_race.None))
		}

		for i, o := range res.Outcomes {
			mine, other := teams[i], teams[1-i]

			if o.Err == nil {
				if got := w.codesOfTeam(t, mine); len(got) != 1 || !strings.HasPrefix(got[0], target+"-") {
					t.Fatalf("round %d: the winner's products %v", round, got)
				}

				continue
			}

			var connectErr *connect.Error
			if !errors.As(o.Err, &connectErr) || connectErr.Code() != connect.CodeAlreadyExists ||
				!strings.Contains(o.Err.Error(), names[other]) {
				t.Fatalf("round %d: the loser got %v, want AlreadyExists naming %s", round, o.Err, names[other])
			}

			if w.teamCode(t, mine) == target || strings.HasPrefix(w.codesOfTeam(t, mine)[0], target) {
				t.Fatalf("round %d: the loser moved", round)
			}
		}
	}
}

// TWO CHANGES OF ONE TEAM AT ONCE: the team row's lock queues the second, which reads the first's code — both land, the
// team ends on one of them, every product carries THAT code, and each has two history lines.
func TestRace_TeamCodeChange_TwoChangesOfOneTeam(t *testing.T) {
	w := newRaceCodeWorld(t, nil)

	for round := range 5 {
		start := fmt.Sprintf("RCE%d-S", round)
		team := w.team(t, fmt.Sprintf("Toko Dua %d", round), start)

		for i := range 4 {
			w.product(t, team, fmt.Sprintf("%s-%d", start, i))
		}

		codes := []string{fmt.Sprintf("RCE%d-P", round), fmt.Sprintf("RCE%d-Q", round)}

		res := w.h.Race(t, 2, func(i int) error { return w.change(team, codes[i]) })
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d changes failed, want both to land", round, res.Failed())
		}

		final := w.teamCode(t, team)

		for _, code := range w.codesOfTeam(t, team) {
			if !strings.HasPrefix(code, final+"-") {
				t.Fatalf("round %d: product %q under a code the team (%s) no longer has", round, code, final)
			}
		}

		var lines int64

		err := w.h.DB().Model(&product_service_models.ProductLog{}).
			Where("product_id IN (SELECT id FROM products WHERE team_id = ?)", team).
			Count(&lines).Error
		if err != nil {
			t.Fatal(err)
		}

		if lines != 8 {
			t.Fatalf("round %d: %d history lines, want 8 (two per product)", round, lines)
		}
	}
}

// A CUSTOM TAG PUT ON / TAKEN OFF WHILE THE RECOMPOSE RUNS: every call lands, never a deadlock or an Internal; the products
// end under the new code, all carrying `need_reprint_code` (one warehouse holds each), the custom links as the last write
// left them.
func TestRace_TeamCodeChange_TagWritesBeside(t *testing.T) {
	w := newRaceCodeWorld(t, shelvedEverywhere{warehouse: 9_149_001})

	for round := range 5 {
		start := fmt.Sprintf("RCE%d-T", round)
		team := w.team(t, fmt.Sprintf("Toko Tag %d", round), start)

		ids := make([]uint64, 0, 6)
		for i := range 6 {
			ids = append(ids, w.product(t, team, fmt.Sprintf("%s-%d", start, i)))
		}

		tag := product_service_models.ProductTag{Name: fmt.Sprintf("race-laris %d", round), Type: "custom"}

		err := w.h.DB().Create(&tag).Error
		if err != nil {
			t.Fatal(err)
		}

		// Products 3–5 carry it already; the writers put it on 0–2 and take it off 3–5 while the change runs.
		for _, id := range ids[3:] {
			err = w.h.DB().Create(&product_service_models.ProductTagLink{ProductID: id, TagID: tag.ID}).Error
			if err != nil {
				t.Fatal(err)
			}
		}

		res := w.h.Race(t, 7, func(i int) error {
			ctx := asOwnerOf(team)

			switch {
			case i == 6:
				return w.change(team, fmt.Sprintf("RCE%d-U", round))
			case i < 3:
				_, addErr := w.products.ProductTagAdd(ctx, connect.NewRequest(&productv1.ProductTagAddRequest{TeamId: team, ProductId: ids[i], TagId: tag.ID}))

				return addErr
			default:
				_, removeErr := w.products.ProductTagRemove(ctx, connect.NewRequest(&productv1.ProductTagRemoveRequest{TeamId: team, ProductId: ids[i], TagId: tag.ID}))

				return removeErr
			}
		})
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d calls failed", round, res.Failed())
		}

		var reprint []uint64

		err = w.h.DB().Raw(`SELECT l.product_id FROM product_tag_links l JOIN product_tags g ON g.id = l.tag_id
			WHERE g.app_task = ? AND l.product_id IN ? ORDER BY 1`, product_v1.AppTaskReprintCode, ids).Scan(&reprint).Error
		if err != nil {
			t.Fatal(err)
		}

		var custom []uint64

		err = w.h.DB().Raw("SELECT product_id FROM product_tag_links WHERE tag_id = ? ORDER BY 1", tag.ID).Scan(&custom).Error
		if err != nil {
			t.Fatal(err)
		}

		if len(reprint) != 6 || len(custom) != 3 || custom[0] != ids[0] || custom[2] != ids[2] {
			t.Fatalf("round %d: need_reprint_code on %v, the custom tag on %v — want all six, and 0–2", round, reprint, custom)
		}

		for _, code := range w.codesOfTeam(t, team) {
			if !strings.HasPrefix(code, fmt.Sprintf("RCE%d-U-", round)) {
				t.Fatalf("round %d: %q not recomposed", round, code)
			}
		}
	}
}
