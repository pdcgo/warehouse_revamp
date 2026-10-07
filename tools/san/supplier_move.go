package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// supplierCommand is the supplier's operator actions: moving the suppliers that exist out of inventory_service
// (existing-suppliers-move-with-their-ids), and folding the restocks accepted before the figures existed
// (past-accepts-are-backfilled-once).
func supplierCommand() *cli.Command {
	return &cli.Command{
		Name:  "supplier",
		Usage: "supplier_service operations",
		Commands: []*cli.Command{
			{
				Name:      "move",
				Usage:     "copy inventory_service's suppliers and stores into supplier_service, ids kept",
				ArgsUsage: " ",
				Description: "One-shot, and safe to run again. Reads inventory_service's legacy_suppliers and\n" +
					"legacy_supplier_channels and writes supplier_service's suppliers and supplier_channels KEEPING\n" +
					"every id — restocks and batches hold those ids. Deleted suppliers move too, marked. City and\n" +
					"province join the address, an offline store is folded into its supplier, and the code is dropped.\n" +
					"Refused — nothing written — if supplier_service already holds a DIFFERENT row under a moving id.",
				Action: runSupplierMove,
			},
			supplierBackfillCommand(),
		},
	}
}

func runSupplierMove(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		report, err := san.MoveSuppliers(ctx)
		if err != nil {
			return err
		}

		log.Printf("[%s] suppliers: %d moved (%d of them deleted), %d already there", san.target,
			report.suppliersMoved, report.deletedMoved, report.suppliersAlreadyThere)
		log.Printf("[%s] stores: %d moved, %d already there, %d offline folded into their supplier", san.target,
			report.storesMoved, report.storesAlreadyThere, report.offlineFolded)

		return nil
	})
}

// moveReport is what a move did — printed, and asserted on by the tests.
type moveReport struct {
	suppliersMoved        int
	deletedMoved          int
	suppliersAlreadyThere int
	storesMoved           int
	storesAlreadyThere    int
	offlineFolded         int
}

// legacySupplier is a row of inventory_service's legacy_suppliers (its 00023 renamed the table).
type legacySupplier struct {
	ID          uint64
	TeamID      uint64
	Name        string
	Contact     string
	Province    string
	City        string
	Address     string
	Description string
	Deleted     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// legacyChannel is a row of inventory_service's legacy_supplier_channels.
type legacyChannel struct {
	ID          uint64
	SupplierID  uint64
	Type        string
	Marketplace string
	Name        string
	URL         string `gorm:"column:url"`
	Contact     string
	Location    string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// movedSupplier and movedChannel are the rows the move writes — supplier_service's shape.
type movedSupplier struct {
	ID          uint64
	TeamID      uint64
	Name        string
	Contact     string
	Address     string
	Description string
	DeletedAt   *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type movedChannel struct {
	ID          uint64
	SupplierID  uint64
	ChannelType string
	Name        string
	URI         string `gorm:"column:uri"`
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

var errMoveCollision = errors.New("supplier_service already holds a different row under a moving id")

// MoveSuppliers copies every legacy supplier and store into supplier_service, in ONE transaction.
//
// ⚠ A HAND-WRITTEN INSERT, AGAINST HARD RULE 3b's default — and argued: a move must KEEP each id, because
// restocks and batches hold it, and no handler can create a row under a chosen id. This is a copy of rows
// that already passed their own rules, not an operation on the domain, and it is one-shot.
//
// The danger is a supplier created in supplier_service BEFORE the move ran: its id came from the new
// sequence, and may be one a legacy row still needs. A row already there under a moving id is accepted
// only when it is the SAME supplier (team and name) — the move having run before — and otherwise the whole
// move is refused with the ids named, so nothing is overwritten and nothing is silently skipped.
func (s *San) MoveSuppliers(ctx context.Context) (moveReport, error) {
	var report moveReport

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var suppliers []legacySupplier

		err := tx.Table("legacy_suppliers").Order("id").Find(&suppliers).Error
		if err != nil {
			return fmt.Errorf("read legacy_suppliers (has inventory_service migrated to 00023?): %w", err)
		}

		var channels []legacyChannel

		err = tx.Table("legacy_supplier_channels").Order("id").Find(&channels).Error
		if err != nil {
			return fmt.Errorf("read legacy_supplier_channels: %w", err)
		}

		movedSuppliers, movedChannels, folded := foldLegacy(suppliers, channels)

		existingSuppliers, existingChannels, err := existingRows(tx, movedSuppliers, movedChannels)
		if err != nil {
			return err
		}

		err = refuseCollisions(movedSuppliers, movedChannels, existingSuppliers, existingChannels)
		if err != nil {
			return err
		}

		for i := range movedSuppliers {
			row := &movedSuppliers[i]

			if _, there := existingSuppliers[row.ID]; there {
				report.suppliersAlreadyThere++

				continue
			}

			err = tx.Table("suppliers").Create(row).Error
			if err != nil {
				return fmt.Errorf("insert supplier %d: %w", row.ID, err)
			}

			report.suppliersMoved++
			if row.DeletedAt != nil {
				report.deletedMoved++
			}
		}

		for i := range movedChannels {
			row := &movedChannels[i]

			if _, there := existingChannels[row.ID]; there {
				report.storesAlreadyThere++

				continue
			}

			err = tx.Table("supplier_channels").Create(row).Error
			if err != nil {
				return fmt.Errorf("insert store %d: %w", row.ID, err)
			}

			report.storesMoved++
		}

		report.offlineFolded = folded

		// The sequences resume PAST the largest id, moved or not — the next supplier created must never be
		// handed an id a moved row already holds.
		for _, table := range []string{"suppliers", "supplier_channels"} {
			err = tx.Exec(fmt.Sprintf(
				"SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE((SELECT MAX(id) FROM %s), 0) + 1, false)",
				table, table,
			)).Error
			if err != nil {
				return fmt.Errorf("advance the %s id sequence: %w", table, err)
			}
		}

		return nil
	})

	return report, err
}

// foldLegacy turns legacy rows into supplier_service rows:
//
//   - the address gains the city and the province (no-province-or-city);
//   - a deleted supplier keeps its row, deleted_at taken from its last update — the flag had no time;
//   - an ONLINE store moves as a store, its marketplace as the channel type (`other` when it had none), and
//     any contact or location it carried kept in its description;
//   - an OFFLINE store is folded into its supplier (the-supplier-lists-only-its-online-stores): its contact
//     and location fill the supplier's when those are empty, and are appended to the description when not.
func foldLegacy(suppliers []legacySupplier, channels []legacyChannel) ([]movedSupplier, []movedChannel, int) {
	byID := make(map[uint64]*movedSupplier, len(suppliers))
	moved := make([]movedSupplier, 0, len(suppliers))

	for _, l := range suppliers {
		m := movedSupplier{
			ID:          l.ID,
			TeamID:      l.TeamID,
			Name:        l.Name,
			Contact:     l.Contact,
			Address:     joinNonEmpty(", ", l.Address, l.City, l.Province),
			Description: l.Description,
			CreatedAt:   l.CreatedAt,
			UpdatedAt:   l.UpdatedAt,
		}

		if l.Deleted {
			deletedAt := l.UpdatedAt
			m.DeletedAt = &deletedAt
		}

		moved = append(moved, m)
	}

	for i := range moved {
		byID[moved[i].ID] = &moved[i]
	}

	stores := make([]movedChannel, 0, len(channels))
	folded := 0

	for _, c := range channels {
		supplier := byID[c.SupplierID]
		if supplier == nil {
			// The legacy FK cascaded, so a store without its supplier cannot exist — skip rather than guess.
			continue
		}

		if c.Type == "offline" {
			var notes []string

			if c.Contact != "" {
				if supplier.Contact == "" {
					supplier.Contact = c.Contact
				} else {
					notes = append(notes, c.Contact)
				}
			}

			if c.Location != "" {
				if supplier.Address == "" {
					supplier.Address = c.Location
				} else {
					notes = append(notes, c.Location)
				}
			}

			if len(notes) > 0 {
				supplier.Description = joinNonEmpty("\n", supplier.Description,
					c.Name+": "+strings.Join(notes, " · "))
			}

			folded++

			continue
		}

		channelType := c.Marketplace
		if channelType == "" {
			channelType = "other"
		}

		stores = append(stores, movedChannel{
			ID:          c.ID,
			SupplierID:  c.SupplierID,
			ChannelType: channelType,
			Name:        c.Name,
			URI:         c.URL,
			Description: joinNonEmpty(" · ", c.Contact, c.Location),
			CreatedAt:   c.CreatedAt,
			UpdatedAt:   c.UpdatedAt,
		})
	}

	return moved, stores, folded
}

// existingRows reads what supplier_service already holds under the moving ids.
func existingRows(
	tx *gorm.DB,
	suppliers []movedSupplier,
	channels []movedChannel,
) (map[uint64]movedSupplier, map[uint64]movedChannel, error) {
	supplierIDs := make([]uint64, 0, len(suppliers))
	for _, s := range suppliers {
		supplierIDs = append(supplierIDs, s.ID)
	}

	channelIDs := make([]uint64, 0, len(channels))
	for _, c := range channels {
		channelIDs = append(channelIDs, c.ID)
	}

	existingSuppliers := map[uint64]movedSupplier{}
	existingChannels := map[uint64]movedChannel{}

	if len(supplierIDs) > 0 {
		var rows []movedSupplier

		err := tx.Table("suppliers").Where("id IN ?", supplierIDs).Find(&rows).Error
		if err != nil {
			return nil, nil, fmt.Errorf("read supplier_service's suppliers: %w", err)
		}

		for _, r := range rows {
			existingSuppliers[r.ID] = r
		}
	}

	if len(channelIDs) > 0 {
		var rows []movedChannel

		err := tx.Table("supplier_channels").Where("id IN ?", channelIDs).Find(&rows).Error
		if err != nil {
			return nil, nil, fmt.Errorf("read supplier_service's stores: %w", err)
		}

		for _, r := range rows {
			existingChannels[r.ID] = r
		}
	}

	return existingSuppliers, existingChannels, nil
}

// refuseCollisions fails the move when supplier_service holds a DIFFERENT row under a moving id. The same
// supplier (team and name) or store (supplier and name) is a move that already ran, and is skipped.
func refuseCollisions(
	suppliers []movedSupplier,
	channels []movedChannel,
	existingSuppliers map[uint64]movedSupplier,
	existingChannels map[uint64]movedChannel,
) error {
	var clashes []string

	for _, s := range suppliers {
		there, ok := existingSuppliers[s.ID]
		if ok && (there.TeamID != s.TeamID || there.Name != s.Name) {
			clashes = append(clashes, fmt.Sprintf("supplier %d (legacy %q, now %q)", s.ID, s.Name, there.Name))
		}
	}

	for _, c := range channels {
		there, ok := existingChannels[c.ID]
		if ok && (there.SupplierID != c.SupplierID || there.Name != c.Name) {
			clashes = append(clashes, fmt.Sprintf("store %d (legacy %q, now %q)", c.ID, c.Name, there.Name))
		}
	}

	if len(clashes) == 0 {
		return nil
	}

	sort.Strings(clashes)

	return fmt.Errorf("%w — nothing was written: %s", errMoveCollision, strings.Join(clashes, "; "))
}

func joinNonEmpty(sep string, parts ...string) string {
	kept := make([]string, 0, len(parts))

	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			kept = append(kept, strings.TrimSpace(p))
		}
	}

	return strings.Join(kept, sep)
}

// moveSuppliersOn runs the move on a plain *sql.DB — `dev setup` holds one, not the Wire graph. GORM is
// opened over the SAME connection pool, so the move sees exactly the schema setup just migrated.
func moveSuppliersOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, target: target}

	report, err := san.MoveSuppliers(ctx)
	if err != nil {
		return err
	}

	fmt.Printf("  %d suppliers and %d stores moved, %d already there\n",
		report.suppliersMoved, report.storesMoved, report.suppliersAlreadyThere)

	return nil
}
