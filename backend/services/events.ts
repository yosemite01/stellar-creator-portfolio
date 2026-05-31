// Simple domain event bus for Node services
import EventEmitter from "events";

export type DomainEvent = {
  type: string;
  payload: any;
  createdAt?: string;
};

class DomainEventBus extends EventEmitter {
  emitEvent(event: DomainEvent) {
    event.createdAt = new Date().toISOString();
    this.emit(event.type, event.payload);
  }
}

const bus = new DomainEventBus();

export function emitEvent(type: string, payload: any) {
  bus.emitEvent({ type, payload });
}

export function onEvent(type: string, handler: (payload: any) => void) {
  bus.on(type, handler);
}

export default bus;
