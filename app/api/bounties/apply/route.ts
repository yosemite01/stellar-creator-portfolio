import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const applicationSchema = z.object({
  bountyId: z.string().min(1),
  proposedBudget: z.number().positive(),
  timeline: z.number().positive(),
  proposal: z.string().min(50).max(2000),
  portfolio: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = applicationSchema.parse(body);

    // In production, save to database
    // const application = await db.applications.create({
    //   bountyId: data.bountyId,
    //   creatorId: session.user.id,
    //   ...data
    // });

    return NextResponse.json(
      {
        id: `app_${Date.now()}`,
        ...data,
        status: 'pending',
        appliedAt: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid application data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to submit application' },
      { status: 500 }
    );
  }
}
