// BLOCKS are sparkline characters representing 8 levels of height.
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

// RenderOptions configures sparkline rendering.
export interface RenderOptions {
  // minRange is the minimum range for scaling (prevents tiny fluctuations from appearing dramatic).
  // Default: 5.0 (percentage points).
  minRange?: number
}

// render converts an array of values to a sparkline string using block characters.
// Values should be in chronological order (oldest first).
// Returns empty string if fewer than 2 values.
export function render(values: number[], options: RenderOptions = {}): string {
  if (values.length < 2) {
    return ''
  }

  const minRange = options.minRange ?? 5.0

  // Find data range
  let min = values[0]!
  let max = values[0]!
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }

  // Apply minimum range (centered on data)
  let range = max - min
  if (range < minRange) {
    const mid = (min + max) / 2
    min = mid - minRange / 2
    max = mid + minRange / 2
    range = minRange
  }

  // Map values to block indices
  const result: string[] = []
  for (const v of values) {
    // Normalize to 0-1 range
    const normalized = range > 0 ? (v - min) / range : 0
    // Map to block index (0-7), clamping to valid range
    const index = Math.min(7, Math.max(0, Math.floor(normalized * 7.999)))
    result.push(BLOCKS[index]!)
  }

  return result.join('')
}

// In-source tests
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('renders increasing values', () => {
    expect(render([0, 25, 50, 75, 100])).toBe('▁▂▄▆█')
  })

  test('renders decreasing values', () => {
    expect(render([100, 75, 50, 25, 0])).toBe('█▆▄▂▁')
  })

  test('renders flat values at middle height', () => {
    const result = render([50, 50, 50, 50])
    expect(result).toHaveLength(4)
    // All values at midpoint of minRange -> middle block
    expect(result).toBe('▄▄▄▄')
  })

  test('returns empty string for single value', () => {
    expect(render([50])).toBe('')
  })

  test('returns empty string for empty array', () => {
    expect(render([])).toBe('')
  })

  test('applies minimum range to small fluctuations', () => {
    // 95.0 and 95.5 with 5% minRange (92.5-97.5)
    // 95.0 -> (95-92.5)/5 = 0.5 -> index 3-4 (▄)
    // 95.5 -> (95.5-92.5)/5 = 0.6 -> index 4-5 (▅)
    const result = render([95.0, 95.5])
    expect(result).toBe('▄▅')
  })

  test('handles values at exact boundaries', () => {
    expect(render([0, 100])).toBe('▁█')
  })

  test('handles negative values', () => {
    expect(render([-10, 0, 10])).toBe('▁▄█')
  })

  test('respects custom minRange', () => {
    // With minRange=0, small differences should fill entire range
    const result = render([95.0, 95.5], {minRange: 0})
    expect(result).toBe('▁█')
  })
}
