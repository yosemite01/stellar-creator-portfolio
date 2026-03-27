'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  User, 
  Briefcase, 
  DollarSign, 
  Clock, 
  TrendingUp,
  Plus,
  FileText,
  Users
} from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (status === 'authenticated') {
      setIsLoading(false);
    }
  }, [status, router]);

  if (status === 'loading' || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Skeleton className="h-8 w-64 mb-8" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const userRole = session.user.role;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Welcome back, {session.user.name || session.user.email}!
          </h1>
          <p className="text-muted-foreground">
            Here&apos;s what&apos;s happening with your account today.
          </p>
        </div>

        {/* Role Badge */}
        <div className="mb-8">
          <Badge variant={userRole === 'ADMIN' ? 'destructive' : 'default'} className="text-sm">
            {userRole.charAt(0) + userRole.slice(1).toLowerCase()}
          </Badge>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Bounties</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground">
                Active bounties
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Applications</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground">
                Pending applications
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Earnings</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">$0</div>
              <p className="text-xs text-muted-foreground">
                Total earnings
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Time Spent</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0h</div>
              <p className="text-xs text-muted-foreground">
                This week
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Role-Specific Actions */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Create Bounty Card (for Clients) */}
          {(userRole === 'CLIENT' || userRole === 'ADMIN') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Create Bounty
                </CardTitle>
                <CardDescription>
                  Post a new bounty and find talented freelancers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">Create Bounty</Button>
              </CardContent>
            </Card>
          )}

          {/* Profile Card (for Creators) */}
          {(userRole === 'CREATOR' || userRole === 'ADMIN') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Creator Profile
                </CardTitle>
                <CardDescription>
                  Manage your creator profile and portfolio
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Edit Profile
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Browse Bounties Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Browse Bounties
              </CardTitle>
              <CardDescription>
                Find interesting bounties to work on
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/bounties">
                <Button variant="outline" className="w-full">
                  View All Bounties
                </Button>
              </Link>
            </CardContent>
          </Card>

          {(userRole === 'CREATOR' || userRole === 'ADMIN') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  My applications
                </CardTitle>
                <CardDescription>
                  Track proposals, timelines, and client messages
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard/applications">
                  <Button variant="outline" className="w-full">
                    Open applications
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {(userRole === 'CLIENT' || userRole === 'ADMIN') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Bounty applications
                </CardTitle>
                <CardDescription>
                  Review and accept proposals for your roles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard/bounties">
                  <Button variant="outline" className="w-full">
                    Manage applications
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Find Talent Card (for Clients) */}
          {(userRole === 'CLIENT' || userRole === 'ADMIN') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Find Talent
                </CardTitle>
                <CardDescription>
                  Discover skilled creators and freelancers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/freelancers">
                  <Button variant="outline" className="w-full">
                    Browse Freelancers
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Analytics
              </CardTitle>
              <CardDescription>
                Track your performance and growth
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/analytics">
                <Button variant="outline" className="w-full">
                  View Analytics
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Payments & escrow
              </CardTitle>
              <CardDescription>
                Fund bounties, subscriptions, and manage escrow receipts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/payments">
                <Button variant="outline" className="w-full">
                  Open payments
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
