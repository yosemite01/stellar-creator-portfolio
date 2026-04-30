import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const emailSchema = z.object({
  to: z.string().email(),
  templateId: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = emailSchema.parse(body);

    // In production, use a service like SendGrid, Resend, or Mailgun
    // const response = await sendEmail({
    //   to: data.to,
    //   from: 'notifications@stellar.app',
    //   subject: data.subject,
    //   html: data.html,
    //   text: data.text,
    // });

    console.log('[Email Notification]', {
      to: data.to,
      templateId: data.templateId,
      subject: data.subject,
    });

    return NextResponse.json(
      {
        success: true,
        messageId: `msg_${Date.now()}`,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid email data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
