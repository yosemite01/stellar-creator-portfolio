/**
 * TelemetryCollector
 *
 * Lightweight telemetry collection service for logging app-level metrics
 * (queue depth, performance events, etc.) via Sentry or console in dev mode.
 */

import { SentryErrorTracker } from './SentryErrorTracker';

export interface TelemetryEvent {
  name: string;
  value?: number | string | Record<string, any>;
  timestamp?: number;
  category?: string;
}

export class TelemetryCollector {
  private static instance: TelemetryCollector;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): TelemetryCollector {
    if (!TelemetryCollector.instance) {
      TelemetryCollector.instance = new TelemetryCollector();
    }
    return TelemetryCollector.instance;
  }

  /**
   * Log a telemetry event.
   * In production, sends to Sentry; in dev, logs to console.
   */
  public logEvent(event: TelemetryEvent): void {
    const { name, value, category = 'app_event' } = event;
    const timestamp = event.timestamp || Date.now();

    // Log to Sentry via breadcrumb
    try {
      SentryErrorTracker.getInstance().addBreadcrumb(
        name,
        category,
        'info',
        { value, timestamp },
      );
    } catch {
      // Sentry not initialized; fall back to console in dev
      console.log(`[Telemetry] ${name}:`, value);
    }
  }

  /**
   * Log a metric with a numeric value (e.g., queue depth).
   */
  public logMetric(metricName: string, value: number, metadata?: Record<string, any>): void {
    this.logEvent({
      name: metricName,
      value,
      category: 'metric',
      timestamp: Date.now(),
    });

    if (metadata) {
      console.debug(`[Telemetry] ${metricName}: ${value}`, metadata);
    }
  }

  /**
   * Log a debug message.
   */
  public debug(message: string, data?: Record<string, any>): void {
    this.logEvent({
      name: message,
      value: data,
      category: 'debug',
    });
  }
}

export const telemetryCollector = TelemetryCollector.getInstance();
