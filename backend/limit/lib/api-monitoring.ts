/**
 * API Monitoring and Logging
 * Tracks requests, performance, security events, and generates alerts
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Log Levels
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

/**
 * Event Types
 */
export enum EventType {
  REQUEST = "REQUEST",
  RESPONSE = "RESPONSE",
  ERROR = "ERROR",
  SECURITY = "SECURITY",
  RATE_LIMIT = "RATE_LIMIT",
  PERFORMANCE = "PERFORMANCE",
  ATTACK = "ATTACK",
  AUTH_FAILURE = "AUTH_FAILURE",
}

/**
 * Log Entry
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  eventType: EventType;
  requestId?: string;
  method: string;
  path: string;
  statusCode?: number;
  responseTime?: number;
  ip: string;
  userAgent?: string;
  message: string;
  metadata?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
  };
}

/**
 * Monitoring Metrics
 */
export interface MetricSnapshot {
  timestamp: Date;
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  statusCodes: Record<number, number>;
  errorRates: Record<string, number>;
}

/**
 * Security Alert
 */
export interface SecurityAlert {
  id: string;
  timestamp: Date;
  type:
    | "BRUTE_FORCE"
    | "INJECTION"
    | "DDOS"
    | "SUSPICIOUS_PATTERN"
    | "AUTH_FAILURE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  sourceIp: string;
  endpoint: string;
  requestCount?: number;
  metadata?: Record<string, any>;
}

/**
 * Logger Implementation
 */
export class Logger {
  private logs: LogEntry[] = [];
  private maxLogs: number = 10000;
  private listeners: Set<(log: LogEntry) => void> = new Set();

  constructor(maxLogs: number = 10000) {
    this.maxLogs = maxLogs;
  }

  /**
   * Log a message
   */
  public log(
    level: LogLevel,
    eventType: EventType,
    message: string,
    options: Partial<LogEntry> = {},
  ): LogEntry {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      eventType,
      method: "UNKNOWN",
      path: "UNKNOWN",
      ip: "UNKNOWN",
      message,
      ...options,
    };

    this.logs.push(entry);

    // Keep max logs size
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Notify listeners
    this.listeners.forEach((listener) => listener(entry));

    // Console output for critical logs
    if (level === LogLevel.CRITICAL || level === LogLevel.ERROR) {
      console.error(`[${level}] ${entry.id} - ${message}`, options);
    }

    return entry;
  }

  /**
   * Subscribe to log events
   */
  public subscribe(callback: (log: LogEntry) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get logs with filtering
   */
  public query(
    options: {
      level?: LogLevel;
      eventType?: EventType;
      startTime?: Date;
      endTime?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ): LogEntry[] {
    let result = [...this.logs];

    if (options.level) {
      result = result.filter((log) => log.level === options.level);
    }

    if (options.eventType) {
      result = result.filter((log) => log.eventType === options.eventType);
    }

    if (options.startTime) {
      result = result.filter((log) => log.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      result = result.filter((log) => log.timestamp <= options.endTime!);
    }

    // Sort by timestamp descending
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 100;

    return result.slice(offset, offset + limit);
  }

  /**
   * Clear old logs
   */
  public clearOldLogs(olderThanMs: number = 3600000): number {
    const before = this.logs.length;
    const cutoff = new Date(Date.now() - olderThanMs);

    this.logs = this.logs.filter((log) => log.timestamp > cutoff);

    return before - this.logs.length;
  }
}

/**
 * Monitoring System
 */
export class Monitor {
  private logger: Logger;
  private metrics: MetricSnapshot[] = [];
  private alerts: SecurityAlert[] = [];
  private requestTimings: Map<string, number> = new Map();
  private ipCount: Map<string, number> = new Map();
  private endpointErrorRate: Map<string, { errors: number; total: number }> =
    new Map();
  private metricsInterval?: NodeJS.Timeout;

  constructor(logger: Logger) {
    this.logger = logger;
    this.startMetricsCollection();
  }

  /**
   * Record API request
   */
  public recordRequest(req: Request, startTime: number): void {
    const ip = req.ip || "unknown";
    const count = (this.ipCount.get(ip) || 0) + 1;
    this.ipCount.set(ip, count);

    this.logger.log(LogLevel.DEBUG, EventType.REQUEST, "Request received", {
      method: req.method,
      path: req.path,
      ip,
      userAgent: req.get("user-agent"),
      requestId: (req as any).requestId,
    });

    // Track timing
    const requestKey = `${req.method}:${req.path}`;
    this.requestTimings.set(`${requestKey}-${Date.now()}`, startTime);
  }

  /**
   * Record API response
   */
  public recordResponse(
    req: Request,
    res: Response,
    statusCode: number,
    startTime: number,
  ): void {
    const responseTime = Date.now() - startTime;
    const endpoint = `${req.method}:${req.path}`;

    // Track error rates
    const isError = statusCode >= 400;
    const errorStats = this.endpointErrorRate.get(endpoint) || {
      errors: 0,
      total: 0,
    };
    errorStats.total++;
    if (isError) {
      errorStats.errors++;
    }
    this.endpointErrorRate.set(endpoint, errorStats);

    this.logger.log(LogLevel.DEBUG, EventType.RESPONSE, "Response sent", {
      method: req.method,
      path: req.path,
      statusCode,
      responseTime,
      ip: req.ip,
      requestId: (req as any).requestId,
    });

    // Log slow requests
    if (responseTime > 5000) {
      this.logger.log(
        LogLevel.WARN,
        EventType.PERFORMANCE,
        "Slow request detected",
        {
          method: req.method,
          path: req.path,
          responseTime,
          requestId: (req as any).requestId,
        },
      );
    }

    // Log server errors
    if (statusCode >= 500) {
      this.logger.log(LogLevel.ERROR, EventType.ERROR, "Server error", {
        method: req.method,
        path: req.path,
        statusCode,
        responseTime,
        requestId: (req as any).requestId,
      });
    }
  }

  /**
   * Record security event
   */
  public recordSecurityEvent(
    eventType:
      | "BRUTE_FORCE"
      | "INJECTION"
      | "DDOS"
      | "SUSPICIOUS_PATTERN"
      | "AUTH_FAILURE",
    sourceIp: string,
    endpoint: string,
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    description: string,
    metadata?: Record<string, any>,
  ): SecurityAlert {
    const alert: SecurityAlert = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: eventType,
      severity,
      description,
      sourceIp,
      endpoint,
      metadata,
    };

    this.alerts.push(alert);

    // Log alert
    const level =
      severity === "CRITICAL"
        ? LogLevel.CRITICAL
        : severity === "HIGH"
          ? LogLevel.ERROR
          : LogLevel.WARN;

    this.logger.log(level, EventType.SECURITY, `Security Alert: ${eventType}`, {
      sourceIp,
      endpoint,
      severity,
      description,
      metadata,
    });

    return alert;
  }

  /**
   * Detect suspicious patterns
   */
  public detectAnomalies(threshold: number = 10): SecurityAlert[] {
    const newAlerts: SecurityAlert[] = [];

    // Check for brute force attempts (many requests from single IP)
    this.ipCount.forEach((count, ip) => {
      if (count > threshold) {
        const alert = this.recordSecurityEvent(
          "BRUTE_FORCE",
          ip,
          "/api/*",
          "MEDIUM",
          `Suspicious activity from IP: ${count} requests`,
          { requestCount: count },
        );
        newAlerts.push(alert);
      }
    });

    // Check for high error rates
    this.endpointErrorRate.forEach((stats, endpoint) => {
      const errorRate = stats.errors / stats.total;
      if (errorRate > 0.5 && stats.total > 10) {
        const alert = this.recordSecurityEvent(
          "SUSPICIOUS_PATTERN",
          "unknown",
          endpoint,
          "HIGH",
          `High error rate detected: ${(errorRate * 100).toFixed(2)}%`,
          { errorRate, totalRequests: stats.total },
        );
        newAlerts.push(alert);
      }
    });

    return newAlerts;
  }

  /**
   * Get current metrics
   */
  public getMetrics(): MetricSnapshot {
    const logs = this.logger.query();
    const responseLogs = logs.filter(
      (log) => log.eventType === EventType.RESPONSE,
    );

    const responseTimes = responseLogs
      .map((log) => log.responseTime || 0)
      .sort((a, b) => a - b);

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    const maxResponseTime = Math.max(...responseTimes, 0);
    const minResponseTime =
      Math.min(...responseTimes.filter((t) => t > 0), Infinity) || 0;

    const p95Index = Math.ceil(responseTimes.length * 0.95);
    const p99Index = Math.ceil(responseTimes.length * 0.99);

    const errorCount = logs.filter(
      (log) => log.level === LogLevel.ERROR,
    ).length;

    const statusCodes: Record<number, number> = {};
    responseLogs.forEach((log) => {
      if (log.statusCode) {
        statusCodes[log.statusCode] = (statusCodes[log.statusCode] || 0) + 1;
      }
    });

    const errorRates: Record<string, number> = {};
    this.endpointErrorRate.forEach((stats, endpoint) => {
      errorRates[endpoint] =
        stats.total > 0 ? (stats.errors / stats.total) * 100 : 0;
    });

    const snapshot: MetricSnapshot = {
      timestamp: new Date(),
      requestCount: logs.filter((log) => log.eventType === EventType.REQUEST)
        .length,
      errorCount,
      avgResponseTime,
      maxResponseTime,
      minResponseTime,
      p95ResponseTime: responseTimes[p95Index - 1] || 0,
      p99ResponseTime: responseTimes[p99Index - 1] || 0,
      statusCodes,
      errorRates,
    };

    this.metrics.push(snapshot);

    // Keep last 1440 metrics (24 hours at 1-minute intervals)
    if (this.metrics.length > 1440) {
      this.metrics.shift();
    }

    return snapshot;
  }

  /**
   * Start metrics collection (every minute)
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.getMetrics();
      this.detectAnomalies();
    }, 60000);
  }

  /**
   * Stop metrics collection
   */
  public stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  /**
   * Get alerts
   */
  public getAlerts(
    options: {
      type?: SecurityAlert["type"];
      severity?: SecurityAlert["severity"];
      limit?: number;
    } = {},
  ): SecurityAlert[] {
    let result = [...this.alerts];

    if (options.type) {
      result = result.filter((alert) => alert.type === options.type);
    }

    if (options.severity) {
      result = result.filter((alert) => alert.severity === options.severity);
    }

    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const limit = options.limit || 100;
    return result.slice(0, limit);
  }

  /**
   * Clear old alerts
   */
  public clearOldAlerts(olderThanMs: number = 3600000): number {
    const before = this.alerts.length;
    const cutoff = new Date(Date.now() - olderThanMs);

    this.alerts = this.alerts.filter((alert) => alert.timestamp > cutoff);

    return before - this.alerts.length;
  }

  /**
   * Get logger instance
   */
  public getLogger(): Logger {
    return this.logger;
  }
}

/**
 * Monitoring Middleware
 */
export function monitoringMiddleware(monitor: Monitor) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Record request
    monitor.recordRequest(req, startTime);

    // Override res.send to capture response
    const originalSend = res.send;
    res.send = function (data: any) {
      monitor.recordResponse(req, res, res.statusCode, startTime);
      return originalSend.call(this, data);
    } as any;

    next();
  };
}

/**
 * Create monitoring middleware
 */
export function createMonitoring() {
  const logger = new Logger();
  const monitor = new Monitor(logger);

  return {
    middleware: monitoringMiddleware(monitor),
    logger,
    monitor,
  };
}
