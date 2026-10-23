package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"buf.build/go/protovalidate"
	"github.com/urfave/cli/v3"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// NewWarehouseFees is warehouse_service as the operations tool needs it: the fee table's own writes and nothing else. No
// namer — it names a warehouse only to refuse a fee calculation, and no command calculates one.
func NewWarehouseFees(db *gorm.DB) *warehouse_v1.Service {
	return warehouse_v1.NewService(db, nil)
}

func warehouseCommand() *cli.Command {
	return &cli.Command{
		Name:  "warehouse",
		Usage: "warehouse_service operations",
		Commands: []*cli.Command{
			warehouseCarryOverFeesCommand(),
		},
	}
}

// warehouseCarryOverFeesCommand is `san warehouse carry-over-fees`, step 2 of the-flat-rate-is-dropped-last.
func warehouseCarryOverFeesCommand() *cli.Command {
	return &cli.Command{
		Name:      "carry-over-fees",
		Usage:     "give each warehouse its default flat fee as its rate — 0%, floor = cap = the fee — never replacing one",
		ArgsUsage: " ",
		Description: "Safe to run again. Reads every DEFAULT terms row from liability_service (counterparty 0), keeps the\n" +
			"warehouses' (team_service's team type), and writes each as the warehouse's rate through warehouse_service:\n" +
			"fee_percent 0, min_fee = max_fee = the flat fee, so a seller on the default pays the same. A flat fee of 0\n" +
			"becomes 0% with no floor and no cap. A warehouse that already has a rate keeps it. A seller's own flat row\n" +
			"has no equivalent and is not read. Run again, it carries nothing and says so.",
		Action: runWarehouseCarryOverFees,
	}
}

func runWarehouseCarryOverFees(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		report, err := san.CarryOverWarehouseFees(ctx)
		if err != nil {
			return err
		}

		log.Printf("[%s] warehouse fees: %d carried over, %d skipped (already set), %d default terms not a warehouse's",
			san.target, report.Carried, report.Skipped, report.NotWarehouses)

		return nil
	})
}

// feeCarryOver is what one `warehouse carry-over-fees` did.
type feeCarryOver struct {
	warehouse_v1.CarryOverResult

	// Default terms rows whose creditor is not a warehouse — a selling team's, there for its product markup. Read, and
	// carried nowhere.
	NotWarehouses int
}

// CarryOverWarehouseFees reads each warehouse's default flat fee and carries it over through warehouse_service's own
// write — every table read and written by the service that owns it, the tool only joining them.
func (s *San) CarryOverWarehouseFees(ctx context.Context) (feeCarryOver, error) {
	fees, notWarehouses, err := warehouseFlatFees(s.db.WithContext(ctx))
	if err != nil {
		return feeCarryOver{}, err
	}

	result, err := s.warehouses.CarryOverFlatFees(ctx, fees)
	if err != nil {
		return feeCarryOver{}, err
	}

	return feeCarryOver{CarryOverResult: result, NotWarehouses: notWarehouses}, nil
}

// warehouseFlatFees is liability's default terms rows, kept to the warehouses' — and how many were not a warehouse's.
// A selling team's default row exists for its markup, and is no warehouse fee.
func warehouseFlatFees(db *gorm.DB) ([]warehouse_v1.FlatFee, int, error) {
	defaults, err := liability_v1.DefaultHandlingFees(db)
	if err != nil {
		return nil, 0, err
	}

	creditors := make([]uint64, 0, len(defaults))
	for _, row := range defaults {
		creditors = append(creditors, row.CreditorTeamID)
	}

	warehouses, err := team_v1.WarehouseTeamIDs(db, creditors)
	if err != nil {
		return nil, 0, err
	}

	isWarehouse := make(map[uint64]bool, len(warehouses))
	for _, id := range warehouses {
		isWarehouse[id] = true
	}

	fees := make([]warehouse_v1.FlatFee, 0, len(warehouses))

	for _, row := range defaults {
		if !isWarehouse[row.CreditorTeamID] {
			continue
		}

		fees = append(fees, warehouse_v1.FlatFee{WarehouseID: row.CreditorTeamID, Fee: float64(row.HandlingFee)})
	}

	return fees, len(defaults) - len(fees), nil
}

// carryOverFeesOn is the `dev setup` step — the same method the command runs, on setup's connection. A second run is
// the expected case there, and it prints a line rather than failing.
func carryOverFeesOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gormOn(db)
	if err != nil {
		return err
	}

	san := &San{db: gdb, warehouses: NewWarehouseFees(gdb), target: target}

	report, err := san.CarryOverWarehouseFees(ctx)
	if err != nil {
		return err
	}

	fmt.Printf("  %d carried over, %d skipped (already set)\n", report.Carried, report.Skipped)

	return nil
}

// devWarehouseFee is the dev fixture's rate for Dev Warehouse: the decisions' worked example
// (the-fee-has-a-floor-and-a-cap) — 2.5%, a floor of 2.000, a cap of 20.000.
func devWarehouseFee(warehouseID uint64) *warehousev1.WarehouseFeeSetRequest {
	return &warehousev1.WarehouseFeeSetRequest{
		TeamId:     warehouseID,
		FeePercent: 2.5,
		MinFee:     2_000,
		MaxFee:     proto.Float64(20_000),
	}
}

// seedDevWarehouseFee gives Dev Warehouse a rate, so dev can place orders once a warehouse with none is refused
// (a-warehouse-with-no-rate-takes-no-orders). It returns the line to print.
//
// It NEVER PRE-EMPTS THE CARRY-OVER. The carry-over never replaces a rate, so a fixture rate written first would win
// over the warehouse's real flat fee forever. In order, then:
//   - a rate already set — left alone, whoever set it;
//   - a default flat fee in liability — carried over, by the same carry-over `warehouse carry-over-fees` runs;
//   - neither — the worked example.
func seedDevWarehouseFee(ctx context.Context, db *gorm.DB, warehouseID uint64) (string, error) {
	svc := NewWarehouseFees(db)

	fees, _, err := warehouseFlatFees(db.WithContext(ctx))
	if err != nil {
		return "", err
	}

	for _, flat := range fees {
		if flat.WarehouseID != warehouseID {
			continue
		}

		result, err := svc.CarryOverFlatFees(ctx, []warehouse_v1.FlatFee{flat})
		if err != nil {
			return "", err
		}

		if result.Carried == 0 {
			return "Dev Warehouse already has a fee — left as it is", nil
		}

		return fmt.Sprintf("Dev Warehouse fee: its default flat fee, %.0f, carried over", flat.Fee), nil
	}

	req := devWarehouseFee(warehouseID)

	// A handler called directly gets no validation interceptor, so the contract is checked here (HARD RULE 3b).
	err = protovalidate.Validate(req)
	if err != nil {
		return "", err
	}

	written, err := svc.WarehouseFeeSetIfAbsent(ctx, req)
	if err != nil {
		return "", err
	}

	if !written {
		return "Dev Warehouse already has a fee — left as it is", nil
	}

	return "Dev Warehouse fee: 2.5%, floor 2000, cap 20000", nil
}

// gormOn wraps an open connection for the services' code, which is written against GORM.
func gormOn(db *sql.DB) (*gorm.DB, error) {
	return gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
}
