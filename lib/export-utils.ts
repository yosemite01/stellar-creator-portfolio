/**
 * Utility functions for streaming CSV/JSON exports.
 */

/**
 * Convert array of objects to CSV format.
 * Simple implementation without escaping - suitable for text fields.
 */
export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const csvHeaders = headers.join(',');
  const csvRows = rows
    .map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          const str = String(value);
          // Escape quotes and wrap in quotes if contains comma/newline
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    )
    .join('\n');

  return `${csvHeaders}\n${csvRows}`;
}

/**
 * Format bytes as human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
