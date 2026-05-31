import { AppState } from 'react-native';

export interface RawNotification {
  id: string;
  title: string;
  body: string;
  category: string;
  senderId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface AggregatedGroup {
  groupKey: string;
  category: string;
  notifications: RawNotification[];
  summary: string;
  relevanceScore: number;
  lastUpdated: number;
  digested: boolean;
}

interface AggregatorConfig {
  groupWindowMs?: number;
  maxGroupSize?: number;
  digestThreshold?: number;
  relevanceDecayRate?: number;
  quietHours?: { start: number; end: number };
}

const DEFAULT_CONFIG: Required<AggregatorConfig> = {
  groupWindowMs: 5 * 60 * 1000,
  maxGroupSize: 10,
  digestThreshold: 3,
  relevanceDecayRate: 0.95,
  quietHours: { start: 22, end: 8 },
};

// Lightweight TF-IDF-inspired relevance scoring without external ML deps
class RelevanceScorer {
  private categoryWeights: Map<string, number> = new Map([
    ['message', 1.0],
    ['mention', 0.95],
    ['alert', 0.9],
    ['update', 0.5],
    ['promo', 0.1],
  ]);
  private interactionHistory: Map<string, number> = new Map();

  score(notification: RawNotification): number {
    const categoryWeight = this.categoryWeights.get(notification.category) ?? 0.5;
    const senderBoost = this.getSenderBoost(notification.senderId);
    const recencyFactor = this.recencyScore(notification.timestamp);
    const textSignal = this.textRelevance(notification.title + ' ' + notification.body);
    return Math.min(1, categoryWeight * 0.4 + senderBoost * 0.3 + recencyFactor * 0.2 + textSignal * 0.1);
  }

  recordInteraction(senderId: string): void {
    this.interactionHistory.set(senderId, (this.interactionHistory.get(senderId) ?? 0) + 1);
  }

  private getSenderBoost(senderId: string): number {
    const count = this.interactionHistory.get(senderId) ?? 0;
    return Math.min(1, count / 20);
  }

  private recencyScore(timestamp: number): number {
    const ageMs = Date.now() - timestamp;
    const hourMs = 3_600_000;
    if (ageMs < hourMs) return 1;
    if (ageMs < 6 * hourMs) return 0.8;
    if (ageMs < 24 * hourMs) return 0.5;
    return 0.2;
  }

  private textRelevance(text: string): number {
    const urgentTerms = ['urgent', 'important', 'action required', 'failed', 'error', 'critical'];
    const lower = text.toLowerCase();
    return urgentTerms.some((t) => lower.includes(t)) ? 1 : 0;
  }
}

export class NotificationAggregator {
  private groups: Map<string, AggregatedGroup> = new Map();
  private seenIds: Set<string> = new Set();
  private scorer = new RelevanceScorer();
  private config: Required<AggregatorConfig>;
  private listeners: Array<(groups: AggregatedGroup[]) => void> = [];
  private gcInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AggregatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.gcInterval = setInterval(() => this.gc(), 60_000);
    AppState.addEventListener('change', (state) => {
      if (state === 'active') this.flushDigests();
    });
  }

  stop(): void {
    if (this.gcInterval) clearInterval(this.gcInterval);
  }

  ingest(notification: RawNotification): boolean {
    if (this.seenIds.has(notification.id)) return false;
    this.seenIds.add(notification.id);

    if (this.isQuietHours()) {
      this.bufferForQuietHours(notification);
      return false;
    }

    const groupKey = this.resolveGroupKey(notification);
    const relevance = this.scorer.score(notification);

    const existing = this.groups.get(groupKey);
    if (existing) {
      existing.notifications.push(notification);
      existing.relevanceScore = Math.max(existing.relevanceScore, relevance);
      existing.lastUpdated = Date.now();
      existing.summary = this.buildSummary(existing.notifications);
      existing.digested = existing.notifications.length >= this.config.digestThreshold;
    } else {
      this.groups.set(groupKey, {
        groupKey,
        category: notification.category,
        notifications: [notification],
        summary: notification.body,
        relevanceScore: relevance,
        lastUpdated: Date.now(),
        digested: false,
      });
    }

    this.emit();
    return true;
  }

  dismiss(groupKey: string): void {
    this.groups.delete(groupKey);
    this.emit();
  }

  dismissNotification(notificationId: string): void {
    for (const [key, group] of this.groups) {
      const idx = group.notifications.findIndex((n) => n.id === notificationId);
      if (idx !== -1) {
        group.notifications.splice(idx, 1);
        if (group.notifications.length === 0) {
          this.groups.delete(key);
        } else {
          group.summary = this.buildSummary(group.notifications);
          group.digested = group.notifications.length >= this.config.digestThreshold;
        }
        break;
      }
    }
    this.emit();
  }

  subscribe(listener: (groups: AggregatedGroup[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  recordInteraction(senderId: string): void {
    this.scorer.recordInteraction(senderId);
  }

  getGroups(): AggregatedGroup[] {
    return Array.from(this.groups.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private resolveGroupKey(n: RawNotification): string {
    return `${n.category}::${n.senderId}`;
  }

  private buildSummary(notifications: RawNotification[]): string {
    if (notifications.length === 1) return notifications[0].body;
    const first = notifications[0];
    return `${first.title} and ${notifications.length - 1} more`;
  }

  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    const { start, end } = this.config.quietHours;
    if (start > end) return hour >= start || hour < end;
    return hour >= start && hour < end;
  }

  private quietBuffer: RawNotification[] = [];
  private bufferForQuietHours(n: RawNotification): void {
    this.quietBuffer.push(n);
  }

  private flushDigests(): void {
    const buffered = this.quietBuffer.splice(0);
    buffered.forEach((n) => this.ingest(n));
  }

  private gc(): void {
    const cutoff = Date.now() - this.config.groupWindowMs * 2;
    for (const [key, group] of this.groups) {
      if (group.lastUpdated < cutoff && group.notifications.length === 0) {
        this.groups.delete(key);
      }
    }
    // Prune seenIds to prevent unbounded growth
    if (this.seenIds.size > 10_000) {
      this.seenIds.clear();
    }
  }

  private emit(): void {
    const groups = this.getGroups();
    this.listeners.forEach((l) => l(groups));
  }
}

export const notificationAggregator = new NotificationAggregator();
export default NotificationAggregator;
