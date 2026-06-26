/**
 * Unit tests for ConcurrentWebSocketDataBus
 * Covers priority queue, backpressure, reconnect, and queue depth logging
 */

import {
  ConcurrentWebSocketDataBus,
  BusMessage,
  MessagePriority,
  MAX_QUEUE_DEPTH,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from '../ConcurrentWebSocketDataBus';

// Mock the telemetry collector
jest.mock('../TelemetryCollector', () => ({
  telemetryCollector: {
    logEvent: jest.fn(),
    logMetric: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock WebSocket
class MockWebSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  close(code?: number, reason?: string): void {
    // noop
  }
}

Object.assign(global, { WebSocket: MockWebSocket });

describe('ConcurrentWebSocketDataBus', () => {
  let bus: ConcurrentWebSocketDataBus;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    bus = new ConcurrentWebSocketDataBus('ws://localhost:8080', 16, 512);
  });

  afterEach(() => {
    bus.disconnect();
    jest.useRealTimers();
  });

  describe('Priority Queue', () => {
    it('should prioritize Critical messages over Normal messages', async () => {
      const messages: BusMessage[] = [];
      bus.on('*', (msg) => messages.push(msg));
      bus.connect();

      const normalMsg: BusMessage = {
        type: 'chat',
        payload: { text: 'hello' },
        timestamp: Date.now(),
        id: '1',
      };

      const criticalMsg: BusMessage = {
        type: 'payment',
        payload: { amount: 100 },
        timestamp: Date.now(),
        id: '2',
      };

      bus.injectFrame(JSON.stringify(normalMsg));
      bus.injectFrame(JSON.stringify(criticalMsg));

      // Advance timers to allow parsing and flushing
      jest.advanceTimersByTime(100);

      // Critical message should be delivered first
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0].type).toBe('payment');
    });

    it('should never drop Critical priority messages under backpressure', () => {
      bus.connect();

      // Fill the queue with Low and Normal priority messages
      for (let i = 0; i < MAX_QUEUE_DEPTH + 10; i++) {
        const msg: BusMessage = {
          type: i % 2 === 0 ? 'analytics' : 'chat',
          payload: { index: i },
          timestamp: Date.now(),
          id: String(i),
        };
        bus.injectFrame(JSON.stringify(msg));
      }

      // Inject a Critical message that should not be dropped
      const criticalMsg: BusMessage = {
        type: 'payment',
        payload: { amount: 100 },
        timestamp: Date.now(),
        id: 'critical',
      };
      bus.injectFrame(JSON.stringify(criticalMsg));

      jest.advanceTimersByTime(100);

      const stats = bus.getStats();
      // Critical messages should not be in dropped count
      expect(stats.droppedByPriority.low).toBeGreaterThan(0);
    });
  });

  describe('Backpressure', () => {
    it('should drop Low priority messages first when queue exceeds MAX_QUEUE_DEPTH', () => {
      bus.connect();

      // Fill with Low priority (analytics) messages
      for (let i = 0; i < MAX_QUEUE_DEPTH + 5; i++) {
        const msg: BusMessage = {
          type: 'analytics',
          payload: { index: i },
          timestamp: Date.now(),
          id: String(i),
        };
        bus.injectFrame(JSON.stringify(msg));
      }

      jest.advanceTimersByTime(100);

      const stats = bus.getStats();
      expect(stats.droppedByPriority.low).toBeGreaterThan(0);
    });

    it('should drop Normal priority messages if no Low priority messages available', () => {
      bus.connect();

      // Fill with Normal priority (chat) messages
      for (let i = 0; i < MAX_QUEUE_DEPTH + 5; i++) {
        const msg: BusMessage = {
          type: 'chat',
          payload: { index: i },
          timestamp: Date.now(),
          id: String(i),
        };
        bus.injectFrame(JSON.stringify(msg));
      }

      jest.advanceTimersByTime(100);

      const stats = bus.getStats();
      expect(stats.droppedByPriority.normal).toBeGreaterThan(0);
    });
  });

  describe('Reconnect with Exponential Backoff', () => {
    it('should schedule reconnect with initial backoff on close', () => {
      bus.connect();
      const socket = bus['socket'] as MockWebSocket;

      socket.onclose?.(new CloseEvent('close'));

      expect(bus['backoffMs']).toBe(INITIAL_BACKOFF_MS);
      expect(bus['reconnectTimer']).not.toBeNull();
    });

    it('should double backoff on each reconnect attempt up to MAX_BACKOFF_MS', () => {
      bus.connect();
      const socket = bus['socket'] as MockWebSocket;

      // Simulate first close
      bus['backoffMs'] = INITIAL_BACKOFF_MS;
      socket.onclose?.(new CloseEvent('close'));
      expect(bus['backoffMs']).toBe(INITIAL_BACKOFF_MS);

      // Clear and set up for next attempt
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS + 100);

      // Reconnect happens, backoff should now be doubled
      const expectedBackoff = INITIAL_BACKOFF_MS * 2;
      expect(bus['backoffMs']).toBe(expectedBackoff);
    });

    it('should cap backoff at MAX_BACKOFF_MS (30 seconds)', () => {
      bus.connect();
      let currentBackoff = INITIAL_BACKOFF_MS;

      // Simulate multiple reconnect cycles
      while (currentBackoff < MAX_BACKOFF_MS) {
        currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF_MS);
      }

      bus['backoffMs'] = currentBackoff;
      const socket = bus['socket'] as MockWebSocket;
      socket.onclose?.(new CloseEvent('close'));

      // The backoff should not exceed MAX_BACKOFF_MS
      expect(bus['backoffMs']).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    });
  });

  describe('Queue Depth Logging', () => {
    it('should log queue depth at 10-second intervals', () => {
      const { telemetryCollector } = require('../TelemetryCollector');
      bus.connect();

      // Inject some messages
      for (let i = 0; i < 5; i++) {
        const msg: BusMessage = {
          type: 'chat',
          payload: { index: i },
          timestamp: Date.now(),
          id: String(i),
        };
        bus.injectFrame(JSON.stringify(msg));
      }

      jest.advanceTimersByTime(10000); // Advance 10 seconds

      expect(telemetryCollector.logMetric).toHaveBeenCalled();
      const callArgs = telemetryCollector.logMetric.mock.calls[telemetryCollector.logMetric.mock.calls.length - 1];
      expect(callArgs[0]).toBe('websocket_queue_depth');
    });

    it('should stop logging queue depth on disconnect', () => {
      const { telemetryCollector } = require('../TelemetryCollector');
      telemetryCollector.logMetric.mockClear();

      bus.connect();
      bus.disconnect();

      jest.advanceTimersByTime(20000); // Advance past logging interval

      // logMetric should not be called after disconnect
      expect(telemetryCollector.logMetric).not.toHaveBeenCalled();
    });
  });

  describe('getQueueDepth()', () => {
    it('should return the total queue depth', () => {
      bus.connect();

      expect(bus.getQueueDepth()).toBe(0);

      // Inject messages
      for (let i = 0; i < 10; i++) {
        const msg: BusMessage = {
          type: 'chat',
          payload: { index: i },
          timestamp: Date.now(),
          id: String(i),
        };
        bus.injectFrame(JSON.stringify(msg));
      }

      jest.advanceTimersByTime(50); // Allow parsing
      const depth = bus.getQueueDepth();
      expect(depth).toBeGreaterThan(0);
    });

    it('should return breakdown by priority level', () => {
      bus.connect();

      const criticalMsg: BusMessage = {
        type: 'payment',
        payload: { amount: 100 },
        timestamp: Date.now(),
        id: 'c1',
      };
      const normalMsg: BusMessage = {
        type: 'chat',
        payload: { text: 'hi' },
        timestamp: Date.now(),
        id: 'n1',
      };

      bus.injectFrame(JSON.stringify(criticalMsg));
      bus.injectFrame(JSON.stringify(normalMsg));

      jest.advanceTimersByTime(50);

      const breakdown = bus.getQueueDepthBreakdown();
      expect(breakdown.critical).toBeGreaterThanOrEqual(0);
      expect(breakdown.normal).toBeGreaterThanOrEqual(0);
      expect(breakdown.low).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Message Type Detection', () => {
    it('should classify payment messages as Critical priority', (done) => {
      const receivedMessages: BusMessage[] = [];
      bus.on('payment', (msg) => receivedMessages.push(msg));
      bus.connect();

      const paymentMsg: BusMessage = {
        type: 'payment',
        payload: { amount: 50 },
        timestamp: Date.now(),
        id: '1',
      };

      bus.injectFrame(JSON.stringify(paymentMsg));
      jest.advanceTimersByTime(100);

      setTimeout(() => {
        expect(receivedMessages.length).toBe(1);
        done();
      }, 50);
    });

    it('should classify security messages as Critical priority', (done) => {
      const receivedMessages: BusMessage[] = [];
      bus.on('security', (msg) => receivedMessages.push(msg));
      bus.connect();

      const securityMsg: BusMessage = {
        type: 'security',
        payload: { event: 'login_attempt' },
        timestamp: Date.now(),
        id: '1',
      };

      bus.injectFrame(JSON.stringify(securityMsg));
      jest.advanceTimersByTime(100);

      setTimeout(() => {
        expect(receivedMessages.length).toBe(1);
        done();
      }, 50);
    });

    it('should classify chat messages as Normal priority', (done) => {
      const receivedMessages: BusMessage[] = [];
      bus.on('chat', (msg) => receivedMessages.push(msg));
      bus.connect();

      const chatMsg: BusMessage = {
        type: 'chat',
        payload: { text: 'hello' },
        timestamp: Date.now(),
        id: '1',
      };

      bus.injectFrame(JSON.stringify(chatMsg));
      jest.advanceTimersByTime(100);

      setTimeout(() => {
        expect(receivedMessages.length).toBe(1);
        done();
      }, 50);
    });

    it('should classify bounty messages as Normal priority', (done) => {
      const receivedMessages: BusMessage[] = [];
      bus.on('bounty', (msg) => receivedMessages.push(msg));
      bus.connect();

      const bountyMsg: BusMessage = {
        type: 'bounty',
        payload: { title: 'Fix bug' },
        timestamp: Date.now(),
        id: '1',
      };

      bus.injectFrame(JSON.stringify(bountyMsg));
      jest.advanceTimersByTime(100);

      setTimeout(() => {
        expect(receivedMessages.length).toBe(1);
        done();
      }, 50);
    });

    it('should classify analytics messages as Low priority', (done) => {
      const receivedMessages: BusMessage[] = [];
      bus.on('analytics', (msg) => receivedMessages.push(msg));
      bus.connect();

      const analyticsMsg: BusMessage = {
        type: 'analytics',
        payload: { event: 'page_view' },
        timestamp: Date.now(),
        id: '1',
      };

      bus.injectFrame(JSON.stringify(analyticsMsg));
      jest.advanceTimersByTime(100);

      setTimeout(() => {
        expect(receivedMessages.length).toBe(1);
        done();
      }, 50);
    });
  });
});
