import {describe, expect, it} from 'vitest'
import {formatPercentage, formatPath, formatDuration} from '../../src/utils/format'

describe('formatPercentage', () => {
  it('formats basic percentage', () => {
    expect(formatPercentage(75)).toBe('75.0%')
    expect(formatPercentage(100)).toBe('100.0%')
    expect(formatPercentage(0)).toBe('0.0%')
  })

  it('respects decimal places option', () => {
    expect(formatPercentage(75.555, {decimals: 2})).toBe('75.56%')
    expect(formatPercentage(75.555, {decimals: 0})).toBe('76%')
  })

  // Note: We're intentionally NOT testing:
  // - NaN handling
  // - Infinity handling  
  // - includeSign option
  // - colorize option
  // This demonstrates coverage gaps!
})

describe('formatPath', () => {
  it('returns path unchanged when under max length', () => {
    expect(formatPath('src/utils/format.ts')).toBe('src/utils/format.ts')
    expect(formatPath('short.ts', 50)).toBe('short.ts')
  })

  it('normalizes backslashes', () => {
    expect(formatPath('src\\utils\\format.ts')).toBe('src/utils/format.ts')
  })

  // Note: We're intentionally NOT testing:
  // - Empty path handling
  // - Path truncation logic
})

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(0)).toBe('0ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(30000)).toBe('30.0s')
  })

  // Note: We're intentionally NOT testing:
  // - Negative duration handling
  // - Minutes formatting
  // - Hours formatting
})
