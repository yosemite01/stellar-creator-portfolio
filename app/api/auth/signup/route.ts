import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/db';
import { z } from 'zod';

const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = SignUpSchema.parse(body);

    // Sign up user with Supabase Auth
    const { data: authData, error: authError } = await supabaseServer.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        name,
      },
      email_confirm: false, // Require email confirmation
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Failed to create user' },
        { status: 400 }
      );
    }

    // Create user profile in users table (optional, for additional data)
    const { error: profileError } = await supabaseServer
      .from('users')
      .insert([
        {
          id: authData.user.id,
          email,
          name,
        },
      ]);

    if (profileError) {
      console.error('Error creating user profile:', profileError);
      // User is created in auth, but profile creation failed
      // This is not critical, continue
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Sign up successful. Please check your email to confirm your account.',
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
