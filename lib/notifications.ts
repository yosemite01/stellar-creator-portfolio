// Email notification templates and service

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  template: (data: any) => string;
  htmlTemplate: (data: any) => string;
}

export const notificationTemplates: Record<string, NotificationTemplate> = {
  bountyApplicationReceived: {
    id: 'bounty_application_received',
    name: 'Bounty Application Received',
    subject: 'New application for "{bountyTitle}"',
    template: (data) => `
Hello ${data.bountyPosterName},

You've received a new application for your bounty: ${data.bountyTitle}

Applicant: ${data.applicantName}
Proposed Budget: $${data.proposedBudget}
Timeline: ${data.timeline} days

Review the application: ${data.applicationLink}

Best regards,
Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>New Bounty Application</h2>
    <p>Hello ${data.bountyPosterName},</p>
    <p>You've received a new application for your bounty:</p>
    <h3>${data.bountyTitle}</h3>
    <p>
      <strong>Applicant:</strong> ${data.applicantName}<br>
      <strong>Proposed Budget:</strong> $${data.proposedBudget}<br>
      <strong>Timeline:</strong> ${data.timeline} days
    </p>
    <p><a href="${data.applicationLink}">Review Application</a></p>
  </body>
</html>
    `,
  },

  bountyApplicationAccepted: {
    id: 'bounty_application_accepted',
    name: 'Application Accepted',
    subject: 'Your application for "{bountyTitle}" was accepted!',
    template: (data) => `
Great news! Your application for "${data.bountyTitle}" has been accepted.

Bounty Poster: ${data.bountyPosterName}
Budget: $${data.budget}

Next Steps: ${data.nextStepsLink}

Congratulations!
Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>Application Accepted!</h2>
    <p>Great news! Your application has been accepted.</p>
    <h3>${data.bountyTitle}</h3>
    <p>
      <strong>Budget:</strong> $${data.budget}<br>
      <strong>Posted by:</strong> ${data.bountyPosterName}
    </p>
    <p><a href="${data.nextStepsLink}">View Next Steps</a></p>
  </body>
</html>
    `,
  },

  reviewReceived: {
    id: 'review_received',
    name: 'New Review',
    subject: 'You received a {rating} star review',
    template: (data) => `
${data.reviewerName} left a ${data.rating} star review:

"${data.reviewText}"

View your reviews: ${data.profileLink}

Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>New Review</h2>
    <p><strong>${data.reviewerName}</strong> left a ${data.rating} star review:</p>
    <blockquote style="background: #f5f5f5; padding: 15px; border-left: 4px solid #007bff;">
      ${data.reviewText}
    </blockquote>
    <p><a href="${data.profileLink}">View Your Reviews</a></p>
  </body>
</html>
    `,
  },

  verificationStatusChanged: {
    id: 'verification_status_changed',
    name: 'Verification Status Update',
    subject: 'Your verification status has been updated',
    template: (data) => `
Hello ${data.creatorName},

Your verification status has been updated to: ${data.status}

${
  data.status === 'verified'
    ? 'Congratulations! You can now showcase the verified badge.'
    : 'Please complete the verification requirements to get verified.'
}

Learn more: ${data.verificationLink}

Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>Verification Status Updated</h2>
    <p>Hello ${data.creatorName},</p>
    <p>Your verification status: <strong>${data.status}</strong></p>
    ${
      data.status === 'verified'
        ? '<p>Congratulations! You can now showcase the verified badge.</p>'
        : '<p>Please complete the verification requirements.</p>'
    }
    <p><a href="${data.verificationLink}">Learn More</a></p>
  </body>
</html>
    `,
  },
};

// Email service
export class EmailService {
  static async sendNotification(
    to: string,
    templateId: string,
    data: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const template = notificationTemplates[templateId];
      if (!template) {
        throw new Error(`Template ${templateId} not found`);
      }

      const response = await fetch('/api/notifications/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          templateId,
          subject: template.subject.replace(/{(\w+)}/g, (_, key) => data[key] || ''),
          html: template.htmlTemplate(data),
          text: template.template(data),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send email');
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async sendBountyNotification(
    bountyPosterId: string,
    applicationData: any
  ) {
    return this.sendNotification(
      applicationData.posterEmail,
      'bounty_application_received',
      applicationData
    );
  }

  static async sendApplicationAcceptance(
    applicantId: string,
    applicationData: any
  ) {
    return this.sendNotification(
      applicationData.applicantEmail,
      'bounty_application_accepted',
      applicationData
    );
  }

  static async sendReviewNotification(creatorId: string, reviewData: any) {
    return this.sendNotification(
      reviewData.creatorEmail,
      'review_received',
      reviewData
    );
  }

  static async sendVerificationUpdate(creatorId: string, statusData: any) {
    return this.sendNotification(
      statusData.creatorEmail,
      'verification_status_changed',
      statusData
    );
  }
}
