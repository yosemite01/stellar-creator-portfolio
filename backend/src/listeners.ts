// Example listeners wiring for domain events
import { onEvent } from "../services/events";

// BountyCreated listener - non-blocking handler example
onEvent("BountyCreated", async (payload) => {
  try {
    // enqueue email or notification work here. Keep handler non-blocking.
    console.log("BountyCreated received:", payload);
    // e.g., push to a queue or call a notification service
  } catch (e) {
    console.error("error handling BountyCreated", e);
  }
});

// Generic logging hook
onEvent("*", (payload) => {
  // no-op: reserved for wildcard if needed
});

export {};
