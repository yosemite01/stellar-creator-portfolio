'use client';

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, any>;
  timestamp?: Date;
}

class AnalyticsManager {
  private isEnabled = true;

  constructor() {
    this.isEnabled = !document.location.hostname.includes('localhost');
  }

  track(event: AnalyticsEvent) {
    if (!this.isEnabled) return;

    try {
      const eventData = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString(),
      };

      // Send to your analytics service
      // Example with Segment, Mixpanel, or custom API
      console.log('[Analytics]', eventData);

      if (window.gtag) {
        window.gtag('event', event.name, event.properties);
      }
    } catch (error) {
      console.error('Analytics error:', error);
    }
  }

  // Common events
  pageView(path: string, title: string) {
    this.track({
      name: 'page_view',
      properties: {
        path,
        title,
      },
    });
  }

  creatorSearch(query: string, filters: Record<string, any>) {
    this.track({
      name: 'creator_search',
      properties: {
        query,
        filters,
      },
    });
  }

  creatorProfileView(creatorId: string, creatorName: string) {
    this.track({
      name: 'creator_profile_view',
      properties: {
        creatorId,
        creatorName,
      },
    });
  }

  bountySearch(query: string, difficulty: string) {
    this.track({
      name: 'bounty_search',
      properties: {
        query,
        difficulty,
      },
    });
  }

  bountyApply(bountyId: string, bountyTitle: string) {
    this.track({
      name: 'bounty_apply',
      properties: {
        bountyId,
        bountyTitle,
      },
    });
  }

  reviewSubmit(creatorId: string, rating: number) {
    this.track({
      name: 'review_submit',
      properties: {
        creatorId,
        rating,
      },
    });
  }

  authSignup(method: string) {
    this.track({
      name: 'auth_signup',
      properties: {
        method,
      },
    });
  }

  authLogin(method: string) {
    this.track({
      name: 'auth_login',
      properties: {
        method,
      },
    });
  }
}

export const analytics = new AnalyticsManager();

// Extend window for gtag
declare global {
  function gtag(command: string, eventName: string, config?: Record<string, any>): void;
  var gtag: any;
}
