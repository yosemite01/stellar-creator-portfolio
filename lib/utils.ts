import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Formatting utilities ──────────────────────────────────────────────────────

/**
 * Format a number as a currency string.
 * @example formatCurrency(3000) // "$3,000"
 * @example formatCurrency(1500, 'EUR') // "€1,500"
 */
export function formatCurrency(amount: number, currency = 'USD', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits,
  }).format(amount);
}

/**
 * Format an ISO date string or Date object as a localised date.
 * Supports multiple format types via the `type` parameter.
 * @example formatDate('2025-08-12') // "Aug 12, 2025"
 * @example formatDate('2025-08-12', 'month-year') // "Aug 2025"
 * @example formatDate('2025-08-12', 'month-day') // "Aug 12"
 * @example formatDate('2025-08-12', 'date-time') // "Aug 12, 2025, 02:30 PM"
 * @example formatDate('2025-08-12', 'default') // "8/12/2025" (browser default)
 */
export function formatDate(
  date: string | Date,
  type: 'default' | 'month-day' | 'month-year' | 'date-time' | 'full' = 'full'
): string {
  const dateObj = new Date(date);

  if (type === 'default') {
    return dateObj.toLocaleDateString();
  }

  if (type === 'month-day') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(dateObj);
  }

  if (type === 'month-year') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
    }).format(dateObj);
  }

  if (type === 'date-time') {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  }

  // 'full' - default to year, month, day
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
}

/**
 * Return a human-readable relative time string.
 * @example formatRelativeDate(new Date(Date.now() - 2 * 86400000)) // "2 days ago"
 */
export function formatRelativeDate(date: string | Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Return a compact, granular relative-time label: "just now" under a
 * minute, then "Xm ago" / "Xh ago" / "Xd ago" up to a week, falling back to
 * a locale date string beyond that. Distinct from {@link formatRelativeDate}
 * above, which buckets by day/week/month/year with no minute/hour
 * granularity - use this one for timestamps where recency matters (activity
 * feeds, notifications, comments).
 * @example formatRelativeTime(new Date(Date.now() - 5 * 60_000)) // "5m ago"
 */
export function formatRelativeTime(date: string | Date): string {
  const dateObj = new Date(date);
  const diffMs = Date.now() - dateObj.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return dateObj.toLocaleDateString();
}

/**
 * Format a deadline Date as "X days left" or "Expired".
 */
export function formatDeadline(deadline: Date | string): string {
  const diffMs = new Date(deadline).getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86_400_000);
  if (diffDays < 0) return 'Expired';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return '1 day left';
  return `${diffDays} days left`;
}

/**
 * Capitalise the first letter of a string.
 */
export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format a star rating as "4.8 / 5" or "No ratings yet".
 */
export function formatRating(rating?: number, reviewCount?: number): string {
  if (rating == null) return 'No ratings yet';
  const reviews = reviewCount != null ? ` (${reviewCount})` : '';
  return `${rating.toFixed(1)} / 5${reviews}`;
}

/**
 * Format years of experience as "8 yrs exp" or "< 1 yr exp".
 */
export function formatExperience(years?: number): string {
  if (years == null || years < 1) return '< 1 yr exp';
  return `${years} yr${years === 1 ? '' : 's'} exp`;
}

/**
 * Truncate a string to maxLength, appending "…" if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  return str.length <= maxLength ? str : `${str.slice(0, maxLength)}…`;
}

/**
 * Convert a string to a URL-safe slug.
 * Lowercases, replaces non-alphanumeric runs with hyphens, and trims leading/trailing hyphens.
 * @example slugify("Hello World!") // "hello-world"
 * @example slugify("My File (v1).png") // "my-file-v1-png"
 */
export function slugify(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Return up to two uppercase initials from a display name.
 * Splits on whitespace and takes the first character of each word.
 * @example getInitials("Jane Doe") // "JD"
 * @example getInitials("Alice") // "A"
 * @example getInitials("") // ""
 */
export function getInitials(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Format a byte count as a human-readable file size (e.g. "4.2 MB").
 * Assumes `bytes` is a non-negative integer; base-1024 units (KB/MB/GB),
 * not base-1000, matching how OS file browsers typically display size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Parse a raw bounty status string into a normalized status label.
 * Assumes `status` is one of the known lowercase/snake_case values used by
 * the bounty API; anything else falls back to "Unknown" rather than throwing,
 * since this is used directly in UI rendering.
 */
export function parseBountyStatus(status: string): string {
  const map: Record<string, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    completed: 'Completed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return map[status?.toLowerCase()] ?? 'Unknown';
}

/**
 * Generate avatar initials from a name (up to 2 characters, uppercase).
 * @example getAvatarInitials('John Doe') // "JD"
 * @example getAvatarInitials('Sarah') // "S"
 */
export function getAvatarInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Shorten a Stellar/blockchain address to a readable summary.
 * Returns the first `prefixLen` characters, an ellipsis, and the last `suffixLen` characters.
 * If the address is already short enough to fit in prefix+suffix it is returned as-is.
 * @example shortenAddress('GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890') // "GABCDE...7890"
 * @example shortenAddress('GSHORT') // "GSHORT"
 */
export function shortenAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (!address) return '';
  if (address.length <= prefixLen + suffixLen) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}
