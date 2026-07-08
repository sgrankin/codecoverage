package stats

import "testing"

func TestMean(t *testing.T) {
	tests := []struct {
		name string
		xs   []float64
		want float64
	}{
		{"empty", nil, 0},
		{"single", []float64{4}, 4},
		{"several", []float64{1, 2, 3}, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Mean(tt.xs); got != tt.want {
				t.Errorf("Mean(%v) = %v, want %v", tt.xs, got, tt.want)
			}
		})
	}
}

func TestClamp(t *testing.T) {
	// Only the in-range path is covered, deliberately.
	if got := Clamp(5, 0, 10); got != 5 {
		t.Errorf("Clamp(5, 0, 10) = %v, want 5", got)
	}
}
