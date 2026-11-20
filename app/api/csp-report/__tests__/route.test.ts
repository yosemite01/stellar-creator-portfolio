import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeReport, aggregateReport, getAggregatedReports, clearAggregatedReports } from '../route';

describe('csp-report route', () => {
  beforeEach(() => {
    clearAggregatedReports();
  });

  describe('normalizeReport', () => {
    it('should normalize legacy CSP report format', () => {
      const report = {
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'https://example.com/script.js',
          'document-uri': 'https://myapp.com/page',
        },
      };

      const result = normalizeReport(report);
      expect(result).not.toBeNull();
      expect(result?.directive).toBe('script-src');
      expect(result?.blocked).toBe('https://example.com/script.js');
      expect(result?.document).toBe('https://myapp.com/page');
    });

    it('should normalize Reporting API format', () => {
      const report = {
        body: {
          effectiveDirective: 'script-src',
          blockedURL: 'https://example.com/script.js',
          documentURL: 'https://myapp.com/page',
        },
      };

      const result = normalizeReport(report);
      expect(result).not.toBeNull();
      expect(result?.directive).toBe('script-src');
    });

    it('should sanitize URIs by removing query params', () => {
      const report = {
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'https://example.com/script.js?token=secret123',
          'document-uri': 'https://myapp.com/page#section',
        },
      };

      const result = normalizeReport(report);
      expect(result?.blocked).toBe('https://example.com/script.js');
      expect(result?.document).toBe('https://myapp.com/page');
    });

    it('should handle missing fields gracefully', () => {
      const report = {
        'csp-report': {
          'violated-directive': 'script-src',
        },
      };

      const result = normalizeReport(report);
      expect(result).not.toBeNull();
      expect(result?.directive).toBe('script-src');
      expect(result?.blocked).toBe('unknown');
      expect(result?.document).toBe('unknown');
    });

    it('should reject invalid report objects', () => {
      expect(normalizeReport({})).toBeNull();
      expect(normalizeReport(null)).toBeNull();
      expect(normalizeReport('not an object')).toBeNull();
    });

    it('should handle array of reports', () => {
      const reports = [
        { 'csp-report': { 'violated-directive': 'script-src' } },
        { 'csp-report': { 'violated-directive': 'img-src' } },
      ];

      for (const report of reports) {
        const result = normalizeReport(report);
        expect(result).not.toBeNull();
      }
    });
  });

  describe('aggregateReport', () => {
    it('should aggregate reports by directive and blocked URI', () => {
      const report1 = {
        directive: 'script-src',
        blocked: 'https://example.com/blocked.js',
        document: 'https://myapp.com/page1',
        userAgent: 'Mozilla/5.0',
        timestamp: Date.now(),
      };

      const result1 = aggregateReport(report1);
      expect(result1.data.get('script-src|https://example.com/blocked.js')?.count).toBe(1);

      // Same report again
      const result2 = aggregateReport(report1);
      expect(result2.data.get('script-src|https://example.com/blocked.js')?.count).toBe(2);
    });

    it('should track timestamps and samples', () => {
      const now = Date.now();
      const report = {
        directive: 'script-src',
        blocked: 'https://example.com/blocked.js',
        document: 'https://myapp.com/page1',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      };

      aggregateReport(report);
      const aggregate = getAggregatedReports().find(r => r.blocked === 'https://example.com/blocked.js');

      expect(aggregate?.firstSeen).toBe(now);
      expect(aggregate?.lastSeen).toBe(now);
      expect(aggregate?.samples.length).toBe(1);
    });

    it('should limit samples to 5 per aggregate', () => {
      const key = 'script-src|https://example.com/blocked.js';
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        aggregateReport({
          directive: 'script-src',
          blocked: 'https://example.com/blocked.js',
          document: `https://myapp.com/page${i}`,
          userAgent: `Mozilla/${i}.0`,
          timestamp: now + i,
        });
      }

      const aggregate = getAggregatedReports().find(r => r.key === key);
      expect(aggregate?.count).toBe(10);
      expect(aggregate?.samples.length).toBe(5);
    });

    it('should separate different directives', () => {
      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/blocked.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: Date.now(),
      });

      aggregateReport({
        directive: 'img-src',
        blocked: 'https://example.com/image.jpg',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: Date.now(),
      });

      expect(getAggregatedReports().length).toBe(2);
    });

    it('should separate same directive different blocked URIs', () => {
      const now = Date.now();
      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/script1.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });

      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/script2.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });

      expect(getAggregatedReports().length).toBe(2);
    });
  });

  describe('getAggregatedReports', () => {
    it('should return empty array when no reports', () => {
      expect(getAggregatedReports()).toEqual([]);
    });

    it('should sort by count descending', () => {
      const now = Date.now();
      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/script.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });
      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/script.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });

      const result = getAggregatedReports();
      expect(result.length).toBe(1);
      expect(result[0].count).toBe(2);
    });
  });

  describe('clearAggregatedReports', () => {
    it('should clear all aggregated data', () => {
      const now = Date.now();
      aggregateReport({
        directive: 'script-src',
        blocked: 'https://example.com/script.js',
        document: 'https://myapp.com/page',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });

      expect(getAggregatedReports().length).toBe(1);

      clearAggregatedReports();
      expect(getAggregatedReports()).toEqual([]);
    });
  });

  describe('sanitizeUri', () => {
    it('should remove query parameters', () => {
      const result = normalizeReport({
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'https://example.com/script.js?token=abc123',
          'document-uri': 'https://myapp.com/page',
        },
      });
      expect(result?.blocked).toBe('https://example.com/script.js');
    });

    it('should remove fragments', () => {
      const result = normalizeReport({
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'https://example.com/script.js',
          'document-uri': 'https://myapp.com/page#section',
        },
      });
      expect(result?.document).toBe('https://myapp.com/page');
    });

    it('should limit URI length', () => {
      const longUri = 'x'.repeat(500);
      const result = normalizeReport({
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': longUri,
          'document-uri': longUri,
        },
      });
      expect(result?.blocked.length).toBeLessThanOrEqual(256);
      expect(result?.document.length).toBeLessThanOrEqual(256);
    });
  });
});
