import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isAuth = !!token;
    const isAuthPage = req.nextUrl.pathname.startsWith('/auth');
    const isDashboard = req.nextUrl.pathname.startsWith('/dashboard');
    const isAdmin = req.nextUrl.pathname.startsWith('/admin');
    const isDisputes = req.nextUrl.pathname.startsWith('/disputes');

    if (isAuthPage && isAuth) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    if (isDashboard && !isAuth) {
      return NextResponse.redirect(new URL('/auth/login', req.url));
    }

    if (isDisputes && !isAuth) {
      return NextResponse.redirect(new URL('/auth/login', req.url));
    }

    // Admin routes require ADMIN role
    if (isAdmin) {
      if (!isAuth) {
        return NextResponse.redirect(new URL('/auth/login', req.url));
      }
      if (token?.role !== 'ADMIN') {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow public access to non-protected routes
        const pathname = req.nextUrl.pathname;
        if (
          pathname.startsWith('/admin') ||
          pathname.startsWith('/dashboard') ||
          pathname.startsWith('/disputes')
        ) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/disputes/:path*',
    '/auth/:path*',
    '/api/auth/:path*',
  ],
};
