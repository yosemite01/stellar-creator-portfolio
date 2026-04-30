import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Clear session cookies
    const response = NextResponse.json(
      { success: true, message: 'Signed out successfully' },
      { status: 200 }
    );

    // Clear cookies
    response.cookies.set('supabase_token', '', {
      httpOnly: true,
      maxAge: 0, // Expire immediately
    });

    response.cookies.set('supabase_refresh_token', '', {
      httpOnly: true,
      maxAge: 0, // Expire immediately
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
