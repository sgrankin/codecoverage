# go-sample

A tiny Go module used by CI to dogfood the action's Go coverage support
(see the `dogfood-go` job in `.github/workflows/ci.yml`).

Coverage gaps are deliberate: `Range` is untested and `Clamp` only has its
happy path covered, so the action always has uncovered lines to report and
line/statement percentages that differ. Don't "fix" the missing tests.
