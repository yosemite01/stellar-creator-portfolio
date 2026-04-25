import { useCallback, useEffect, useRef, useState } from 'react';

// Strict interfaces for WebSocket events
interface WebSocketMessage<T = unknown> {
  type: string;
  data: T;
  timestamp: number;
}

interface ConnectionEvent {
  status: 'connected' | 'disconnected' | 'error';
  message?: string;
}

interface BountyUpdate {
  id: string;
  title: string;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  applicants: number;
  updatedAt: string;
}

interface CreatorUpdate {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  updatedAt: string;
}

interface ApplicationUpdate {
  id: string;
  bountyId: string;
  creatorId: string;
  status: 'pending' | 'accepted' | 'rejected';
  appliedAt: string;
}

type WebSocketEventType = BountyUpdate | CreatorUpdate | ApplicationUpdate;

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage<WebSocketEventType>) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (event: ConnectionEvent) => void;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onError,
  onConnectionChange,
  reconnectAttempts = 5,
  reconnectDelay = 3000,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectCountRef.current = 0;
        onConnectionChange?.({
          status: 'connected',
          message: 'WebSocket connected',
        });
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage<WebSocketEventType> = JSON.parse(event.data);
          onMessage?.(message);
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Failed to parse message');
          onError?.(error);
        }
      };

      ws.onerror = () => {
        const error = new Error('WebSocket error occurred');
        onError?.(error);
        onConnectionChange?.({
          status: 'error',
          message: error.message,
        });
      };

      ws.onclose = () => {
        setIsConnected(false);
        onConnectionChange?.({
          status: 'disconnected',
          message: 'WebSocket disconnected',
        });

        // Attempt reconnection
        if (reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to connect');
      onError?.(error);
    }
  }, [url, onMessage, onError, onConnectionChange, reconnectAttempts, reconnectDelay]);

  const send = useCallback(
    (message: WebSocketMessage<WebSocketEventType>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      } else {
        const error = new Error('WebSocket is not connected');
        onError?.(error);
      }
    },
    [onError]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    send,
    disconnect,
  };
}
