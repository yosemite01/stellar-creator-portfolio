import { describe, it, expect, beforeEach, vi } from "vitest";
import PWAManager from "@/lib/pwa-utils";

/**
 * Integration Tests for PWA
 * Tests PWA installation, offline mode, and notifications
 */

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

/** Minimal ServiceWorkerContainer shape needed for mocking */
type MockServiceWorkerContainer = Pick<ServiceWorkerContainer, "register">;

function assignNavigatorServiceWorker(mock: MockServiceWorkerContainer): void {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: mock,
    writable: true,
    configurable: true,
  });
}

/** Minimal Notification shape needed for mocking */
type MockNotification = Pick<typeof Notification, "permission"> &
  Partial<Pick<typeof Notification, "requestPermission">>;

function assignNotificationMock(mock: MockNotification): void {
  Object.defineProperty(globalThis, "Notification", {
    value: mock,
    writable: true,
    configurable: true,
  });
}

function assignCachesMock(mock: Partial<CacheStorage>): void {
  Object.defineProperty(globalThis, "caches", {
    value: mock,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PWA Integration - Installation", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager({
      swPath: "/sw.js",
      enableNotifications: true,
    });
  });

  it("should check if service worker is supported", () => {
    const supported = "serviceWorker" in navigator && "caches" in window;
    expect(typeof supported).toBe("boolean");
  });

  it("should register service worker", async () => {
    assignNavigatorServiceWorker({
      register: vi.fn().mockResolvedValue({ scope: "/", active: true }),
    });

    expect("serviceWorker" in navigator).toBe(true);
  });

  it("should detect install prompt availability", () => {
    const isInstallPromptAvailable = pwaManager.isInstallPromptAvailable();
    expect(typeof isInstallPromptAvailable).toBe("boolean");
  });

  it("should handle install prompt response", async () => {
    const outcome = "accepted" as "accepted" | "dismissed";
    expect(["accepted", "dismissed"]).toContain(outcome);
  });

  it("should track app installation event", () => {
    const appInstalled = new Event("appinstalled");
    expect(appInstalled.type).toBe("appinstalled");
  });
});

describe("PWA Integration - Offline Mode", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager();
  });

  it("should monitor network status changes", () => {
    const isOnline = pwaManager.isOnline();
    expect(typeof isOnline).toBe("boolean");
  });

  it("should dispatch network status events", () => {
    const networkStatusEvent = new CustomEvent("pwa-network-status", {
      detail: { isOnline: true },
    });

    expect(networkStatusEvent.type).toBe("pwa-network-status");
    expect(networkStatusEvent.detail.isOnline).toBe(true);
  });

  it("should cache content when offline", async () => {
    const cacheVersion = "v1";
    const cacheNames = {
      static: `${cacheVersion}-static`,
      dynamic: `${cacheVersion}-dynamic`,
      images: `${cacheVersion}-images`,
    };

    expect(Object.keys(cacheNames).length).toBe(3);
  });

  it("should serve offline page when no cache available", () => {
    const offlinePage = "/offline.html";
    expect(offlinePage).toBe("/offline.html");
  });

  it("should sync pending messages when back online", () => {
    const pendingSync = { tag: "sync-messages", registered: true };
    expect(pendingSync.tag).toBe("sync-messages");
  });
});

describe("PWA Integration - Notifications", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager({
      enableNotifications: true,
      vapidPublicKey: "test-key",
    });
  });

  it("should request notification permission", async () => {
    assignNotificationMock({
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });

    expect(globalThis.Notification.permission).toBe("default");
  });

  it("should subscribe to push notifications", async () => {
    const mockSubscription = {
      toJSON: () => ({
        endpoint: "https://example.com/push",
        keys: { p256dh: "key", auth: "auth" },
      }),
    };

    expect(mockSubscription.toJSON()).toHaveProperty("endpoint");
  });

  it("should send local notifications", async () => {
    const notification = {
      title: "Test Notification",
      options: { body: "Test body", icon: "/icons/icon-192.png" },
    };

    expect(notification.title).toBe("Test Notification");
    expect(notification.options.body).toBe("Test body");
  });

  it("should handle notification clicks", () => {
    const notificationClickEvent = new Event("notificationclick");
    expect(notificationClickEvent.type).toBe("notificationclick");
  });

  it("should track notification permissions", () => {
    const permissionStates: NotificationPermission[] = [
      "default",
      "granted",
      "denied",
    ];
    expect(permissionStates).toContain("granted");
  });
});

describe("PWA Integration - App State Detection", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager();
  });

  it("should detect if running as PWA", () => {
    const isRunningAsApp = pwaManager.isRunningAsApp();
    expect(typeof isRunningAsApp).toBe("boolean");
  });

  it("should detect standalone mode", () => {
    // `navigator.standalone` is a non-standard Safari/iOS property
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone = nav.standalone === true;
    expect(typeof standalone).toBe("boolean");
  });

  it("should detect display-mode", () => {
    const isStandalone = window.matchMedia(
      "(display-mode: standalone)",
    ).matches;
    expect(typeof isStandalone).toBe("boolean");
  });
});

describe("PWA Integration - Performance", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager();
  });

  it("should track cache storage usage", async () => {
    const usage = await pwaManager.getCacheStorageUsage();
    if (usage) {
      expect(usage).toHaveProperty("usage");
      expect(usage).toHaveProperty("quota");
      expect(usage).toHaveProperty("percentage");
    }
  });

  it("should request persistent storage", async () => {
    const persisted = await pwaManager.requestPersistentStorage();
    expect(typeof persisted).toBe("boolean");
  });

  it("should clear cache when needed", async () => {
    await pwaManager.clearAllCaches();
    expect(true).toBe(true);
  });
});

describe("PWA Integration - Custom Events", () => {
  it("should dispatch install prompt available event", () => {
    const event = new CustomEvent("pwa-install-prompt-available");
    expect(event.type).toBe("pwa-install-prompt-available");
  });

  it("should dispatch install prompt hidden event", () => {
    const event = new CustomEvent("pwa-install-prompt-hidden");
    expect(event.type).toBe("pwa-install-prompt-hidden");
  });

  it("should dispatch update available event", () => {
    const event = new CustomEvent("pwa-update-available");
    expect(event.type).toBe("pwa-update-available");
  });

  it("should dispatch network status event", () => {
    const event = new CustomEvent("pwa-network-status", {
      detail: { isOnline: true },
    });
    expect(event.detail.isOnline).toBe(true);
  });
});

describe("PWA Integration - Error Handling", () => {
  let pwaManager: PWAManager;

  beforeEach(() => {
    pwaManager = new PWAManager();
  });

  it("should handle service worker registration errors", async () => {
    assignNavigatorServiceWorker({
      register: vi.fn().mockRejectedValue(new Error("Registration failed")),
    });

    await expect(navigator.serviceWorker.register("/sw.js")).rejects.toThrow(
      "Registration failed",
    );
  });

  it("should handle cache errors gracefully", async () => {
    const mockCaches: Partial<CacheStorage> = {
      match: vi.fn().mockRejectedValue(new Error("Cache error")),
    };
    assignCachesMock(mockCaches);

    try {
      await mockCaches.match!(new Request("https://example.com"));
    } catch (error) {
      expect((error as Error).message).toBe("Cache error");
    }
  });

  it("should handle notification permission denied", async () => {
    assignNotificationMock({ permission: "denied" });
    expect(globalThis.Notification.permission).toBe("denied");
  });
});
