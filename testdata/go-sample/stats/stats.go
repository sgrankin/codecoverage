// Package stats provides tiny statistics helpers.
//
// It exists so CI can dogfood the coverage action's Go format support;
// some functions are deliberately left untested (see ../README.md).
package stats

// Mean returns the arithmetic mean of xs, or 0 for an empty slice.
func Mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

// Clamp limits v to the range [lo, hi].
func Clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// Range returns the difference between the largest and smallest values
// in xs, or 0 for an empty slice.
func Range(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	min, max := xs[0], xs[0]
	for _, x := range xs[1:] {
		if x < min {
			min = x
		}
		if x > max {
			max = x
		}
	}
	return max - min
}
