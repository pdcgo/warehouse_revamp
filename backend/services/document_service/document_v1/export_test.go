package document_v1

// RunEvery is the daily sweep's ticker, for the test of its timing without a database.
var RunEvery = runEvery

// The sweep's statements and the types it sweeps, for the concurrency audit's written-down schedules
// (generated_file_sweep_race_test.go): the schedule runs the sweep's own SQL, not a copy.
const (
	SweepLockSQL   = sweepLockSQL
	SweepPickSQL   = sweepPickSQL
	SweepDeleteSQL = sweepDeleteSQL
)
