// Format utilities for coverage output

/**
 * Formats a percentage value with appropriate precision and optional styling.
 * @param value - The percentage value (0-100)
 * @param options - Formatting options
 * @returns Formatted percentage string
 */
export function formatPercentage(
  value: number,
  options: {
    decimals?: number
    includeSign?: boolean
    colorize?: boolean
  } = {}
): string {
  const {decimals = 1, includeSign = false, colorize = false} = options

  // Handle edge cases
  if (Number.isNaN(value)) {
    return 'N/A'
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? '∞%' : '-∞%'
  }

  // Clamp to reasonable range for display
  const clamped = Math.max(-999.9, Math.min(999.9, value))
  const formatted = clamped.toFixed(decimals)

  let result = `${formatted}%`

  if (includeSign && value > 0) {
    result = `+${result}`
  }

  if (colorize) {
    if (value >= 80) {
      result = `🟢 ${result}`
    } else if (value >= 50) {
      result = `🟡 ${result}`
    } else {
      result = `🔴 ${result}`
    }
  }

  return result
}

/**
 * Formats a file path for display, optionally truncating long paths.
 * @param path - The file path to format
 * @param maxLength - Maximum length before truncation (0 = no limit)
 * @returns Formatted path string
 */
export function formatPath(path: string, maxLength = 0): string {
  if (!path) {
    return '<unknown>'
  }

  // Normalize path separators
  const normalized = path.replace(/\\/g, '/')

  if (maxLength <= 0 || normalized.length <= maxLength) {
    return normalized
  }

  // Truncate from the middle to preserve both start and end
  const ellipsis = '...'
  const availableLength = maxLength - ellipsis.length
  const startLength = Math.ceil(availableLength / 2)
  const endLength = Math.floor(availableLength / 2)

  return `${normalized.slice(0, startLength)}${ellipsis}${normalized.slice(-endLength)}`
}

/**
 * Formats a duration in milliseconds to human-readable string.
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return 'invalid'
  }

  if (ms < 1000) {
    return `${ms}ms`
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }

  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.round((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  // Hours case - rarely used but should handle it
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.round((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}
