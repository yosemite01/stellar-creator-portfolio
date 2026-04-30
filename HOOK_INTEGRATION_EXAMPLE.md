# Hook System Integration Example

This document demonstrates how the `on_review_submitted` hook system integrates with the frontend and provides real-time reputation updates.

## Frontend Integration

### Review Submission Component

```typescript
// components/review-form.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StarRating } from '@/components/star-rating';
import { toast } from '@/components/ui/use-toast';

interface ReviewFormProps {
  bountyId: string;
  creatorId: string;
  onSubmitSuccess?: (reviewId: string) => void;
}

export function ReviewForm({ bountyId, creatorId, onSubmitSuccess }: ReviewFormProps) {
  const [formData, setFormData] = useState({
    rating: 0,
    title: '',
    body: '',
    reviewerName: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bountyId,
          creatorId,
          ...formData,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Review Submitted',
          description: 'Your review has been submitted successfully!',
        });
        
        // Trigger callback for parent component
        onSubmitSuccess?.(result.data.reviewId);
        
        // Reset form
        setFormData({
          rating: 0,
          title: '',
          body: '',
          reviewerName: '',
        });
      } else {
        // Handle validation errors
        const errorMessage = result.error?.fieldErrors
          ?.map((err: any) => err.message)
          .join(', ') || 'Failed to submit review';
        
        toast({
          title: 'Submission Failed',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Network Error',
        description: 'Failed to submit review. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">Rating</label>
        <StarRating
          value={formData.rating}
          onChange={(rating) => setFormData({ ...formData, rating })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Review Title</label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Summarize your experience"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Review Details</label>
        <Textarea
          value={formData.body}
          onChange={(e) => setFormData({ ...formData, body: e.target.value })}
          placeholder="Share your detailed feedback"
          rows={4}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Your Name</label>
        <Input
          value={formData.reviewerName}
          onChange={(e) => setFormData({ ...formData, reviewerName: e.target.value })}
          placeholder="How should we display your name?"
          required
        />
      </div>

      <Button 
        type="submit" 
        disabled={isSubmitting || formData.rating === 0}
        className="w-full"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Review'}
      </Button>
    </form>
  );
}
```

### Real-time Reputation Updates

```typescript
// hooks/use-creator-reputation.ts
import { useState, useEffect } from 'react';
import type { CreatorReputationPayload } from '@/lib/api-models';

export function useCreatorReputation(creatorId: string) {
  const [reputation, setReputation] = useState<CreatorReputationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReputation = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/creators/${creatorId}/reputation`);
      const result = await response.json();
      
      if (result.success) {
        setReputation(result.data);
        setError(null);
      } else {
        setError(result.error?.message || 'Failed to load reputation');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReputation();
  }, [creatorId]);

  // Method to refresh reputation after review submission
  const refreshReputation = () => {
    fetchReputation();
  };

  return {
    reputation,
    loading,
    error,
    refreshReputation,
  };
}
```

### Creator Profile with Live Updates

```typescript
// app/creators/[id]/page.tsx
'use client';

import { useState } from 'react';
import { CreatorReputation } from '@/components/creator-reputation';
import { ReviewForm } from '@/components/review-form';
import { useCreatorReputation } from '@/hooks/use-creator-reputation';

export default function CreatorProfilePage({ params }: { params: { id: string } }) {
  const { reputation, refreshReputation } = useCreatorReputation(params.id);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const handleReviewSubmitted = (reviewId: string) => {
    console.log('Review submitted:', reviewId);
    
    // Refresh reputation data to show updated stats
    refreshReputation();
    
    // Hide the review form
    setShowReviewForm(false);
    
    // Optional: Show success animation or updated stats highlight
    // This demonstrates the real-time nature of the hook system
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Creator Info Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Creator Profile</h1>
        
        {/* Real-time reputation display */}
        <CreatorReputation creatorId={params.id} />
      </div>

      {/* Review Submission Section */}
      <div className="mb-8">
        {!showReviewForm ? (
          <Button onClick={() => setShowReviewForm(true)}>
            Leave a Review
          </Button>
        ) : (
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Submit Your Review</h2>
            <ReviewForm
              bountyId="example-bounty-id" // In real app, this would come from context
              creatorId={params.id}
              onSubmitSuccess={handleReviewSubmitted}
            />
            <Button 
              variant="outline" 
              onClick={() => setShowReviewForm(false)}
              className="mt-4"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Backend Hook Examples

### Custom Analytics Hook

```rust
// Custom hook for detailed analytics tracking
pub fn analytics_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    // Track review submission metrics
    let analytics_data = serde_json::json!({
        "event_type": "review_submitted",
        "creator_id": event.creator_id,
        "rating": event.rating,
        "review_length": event.body.len(),
        "timestamp": event.submitted_at,
        "bounty_id": event.bounty_id,
    });
    
    // In production: send to analytics service
    tracing::info!("Analytics: {}", analytics_data);
    
    // Simulate analytics API call
    // analytics_client.track_event(analytics_data)?;
    
    Ok(())
}

// Register during initialization
reputation::register_review_submitted_hook(analytics_hook);
```

### Notification Hook with Email Integration

```rust
// Hook for sending email notifications
pub fn email_notification_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    // Only send notifications for high ratings
    if event.rating >= 4 {
        let email_data = EmailNotification {
            to: format!("creator-{}@stellar.dev", event.creator_id),
            subject: "New Positive Review Received!".to_string(),
            template: "positive_review".to_string(),
            data: serde_json::json!({
                "creator_id": event.creator_id,
                "rating": event.rating,
                "title": event.title,
                "reviewer_name": event.reviewer_name,
                "review_url": format!("https://stellar.dev/creators/{}/reviews", event.creator_id),
            }),
        };
        
        // In production: send via email service
        tracing::info!("Email notification: {:?}", email_data);
        // email_service.send(email_data)?;
    }
    
    Ok(())
}
```

### Fraud Detection Hook

```rust
// Hook for fraud detection and review quality checks
pub fn fraud_detection_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    let mut flags = Vec::new();
    
    // Check for suspicious patterns
    if event.body.len() < 10 {
        flags.push("Review too short");
    }
    
    if event.title.to_lowercase().contains("spam") {
        flags.push("Potential spam content");
    }
    
    // Check for duplicate content (simplified)
    if is_duplicate_review(&event.body) {
        flags.push("Duplicate content detected");
    }
    
    if !flags.is_empty() {
        tracing::warn!("Review {} flagged for review: {:?}", event.review_id, flags);
        
        // In production: flag for manual review
        // moderation_queue.add_for_review(event.review_id, flags)?;
    }
    
    Ok(())
}

fn is_duplicate_review(content: &str) -> bool {
    // Simplified duplicate detection
    // In production: use proper similarity algorithms
    content.len() < 20 || content.contains("copy paste")
}
```

### Cache Invalidation Hook

```rust
// Hook for cache invalidation
pub fn cache_invalidation_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    let cache_keys = vec![
        format!("creator_reputation:{}", event.creator_id),
        format!("creator_reviews:{}", event.creator_id),
        format!("creator_profile:{}", event.creator_id),
        "top_creators".to_string(),
        "recent_reviews".to_string(),
    ];
    
    for key in cache_keys {
        // In production: invalidate Redis cache
        tracing::info!("Invalidating cache key: {}", key);
        // redis_client.del(&key)?;
    }
    
    Ok(())
}
```

## Testing the Integration

### End-to-End Test

```rust
#[actix_web::test]
async fn test_complete_review_submission_flow() {
    use actix_web::test as awtest;
    use std::sync::{Arc, Mutex};
    
    // Track hook executions
    let reputation_updated = Arc::new(Mutex::new(false));
    let notification_sent = Arc::new(Mutex::new(false));
    let analytics_tracked = Arc::new(Mutex::new(false));
    
    // Register test hooks
    let reputation_flag = reputation_updated.clone();
    reputation::register_review_submitted_hook(move |event| {
        *reputation_flag.lock().unwrap() = true;
        assert_eq!(event.creator_id, "test-creator");
        Ok(())
    });
    
    let notification_flag = notification_sent.clone();
    reputation::register_review_submitted_hook(move |event| {
        if event.rating >= 4 {
            *notification_flag.lock().unwrap() = true;
        }
        Ok(())
    });
    
    let analytics_flag = analytics_tracked.clone();
    reputation::register_review_submitted_hook(move |_event| {
        *analytics_flag.lock().unwrap() = true;
        Ok(())
    });
    
    // Create test app
    let app = awtest::init_service(
        App::new()
            .route("/api/v1/reviews", web::post().to(submit_review))
            .route("/api/v1/creators/{id}/reputation", web::get().to(get_creator_reputation))
    ).await;
    
    // Submit review
    let review_req = awtest::TestRequest::post()
        .uri("/api/v1/reviews")
        .set_json(serde_json::json!({
            "bountyId": "test-bounty",
            "creatorId": "test-creator",
            "rating": 5,
            "title": "Excellent work",
            "body": "Outstanding delivery and communication throughout the project",
            "reviewerName": "John Doe"
        }))
        .to_request();
    
    let review_resp = awtest::call_service(&app, review_req).await;
    assert_eq!(review_resp.status(), actix_web::http::StatusCode::CREATED);
    
    // Verify all hooks executed
    assert!(*reputation_updated.lock().unwrap(), "Reputation should be updated");
    assert!(*notification_sent.lock().unwrap(), "Notification should be sent for high rating");
    assert!(*analytics_tracked.lock().unwrap(), "Analytics should be tracked");
    
    // Verify reputation endpoint reflects changes
    let reputation_req = awtest::TestRequest::get()
        .uri("/api/v1/creators/test-creator/reputation")
        .to_request();
    
    let reputation_resp = awtest::call_service(&app, reputation_req).await;
    assert_eq!(reputation_resp.status(), actix_web::http::StatusCode::OK);
    
    let body = awtest::read_body(reputation_resp).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["creatorId"], "test-creator");
}
```

## Performance Considerations

### Async Hook Execution (Future Enhancement)

```rust
// Future: Non-blocking hook execution
use tokio::task;

pub async fn trigger_review_submitted_hooks_async(event: &ReviewSubmittedEvent) -> Vec<String> {
    let hooks = REVIEW_HOOKS.lock().unwrap().clone();
    let mut handles = Vec::new();
    
    for hook in hooks {
        let event_clone = event.clone();
        let handle = task::spawn(async move {
            hook(&event_clone)
        });
        handles.push(handle);
    }
    
    let mut errors = Vec::new();
    for handle in handles {
        if let Ok(Err(e)) = handle.await {
            errors.push(format!("Async hook failed: {}", e));
        }
    }
    
    errors
}
```

### Hook Timeout Management

```rust
use tokio::time::{timeout, Duration};

pub async fn execute_hook_with_timeout<F>(
    hook: F,
    event: &ReviewSubmittedEvent,
    timeout_ms: u64,
) -> Result<(), String>
where
    F: Fn(&ReviewSubmittedEvent) -> Result<(), String>,
{
    match timeout(Duration::from_millis(timeout_ms), async {
        hook(event)
    }).await {
        Ok(result) => result,
        Err(_) => Err(format!("Hook execution timed out after {}ms", timeout_ms)),
    }
}
```

This comprehensive example demonstrates how the `on_review_submitted` hook system provides real-time reputation updates and seamless integration between the frontend and backend components of the Stellar Creator Portfolio platform.