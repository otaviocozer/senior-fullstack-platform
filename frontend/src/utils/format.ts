// ---------------------------------------------------------------------------
// Formatting helpers for currency, percentages, dates and status labels.
// ---------------------------------------------------------------------------

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Format a number as USD, e.g. 1234567 -> "$1,234,567". */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return currencyFormatter.format(value);
}

/** Compact currency for chart axes/tooltips, e.g. 1234567 -> "$1.2M". */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return compactCurrencyFormatter.format(value);
}

/** Format a percentage value that is already expressed in percent units. */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

/** Format an integer count with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

/** Format hours to one decimal, e.g. "12.5h". */
export function formatHours(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}h`;
}

/** Format an ISO timestamp for the freshness indicator. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Human-friendly label for a project status. */
export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
