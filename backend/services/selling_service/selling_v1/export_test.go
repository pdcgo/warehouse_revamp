package selling_v1

// SetOrderCommitResult installs the test seam over the order transaction's result (backlog #10c): `f` is handed what the
// transaction returned and its answer is what placeOrder sees — a test returns an error after a commit that landed.
func SetOrderCommitResult(s *Service, f func(error) error) {
	s.orderCommitResult = f
}

// SetOrderSearchMatch swaps the order search's condition (orderSearchMatch) until the test ends — the old-vs-new test
// runs the real handlers with the previous clause on the same fixture. nil puts the built one back.
func SetOrderSearchMatch(t interface{ Cleanup(func()) }, f func(term string) (string, map[string]any)) {
	if f == nil {
		f = orderSearchIDsFirst
	}

	was := orderSearchMatch
	orderSearchMatch = f

	t.Cleanup(func() {
		orderSearchMatch = was
	})
}
