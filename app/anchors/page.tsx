'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Anchor {
  id: string;
  name: string;
  code: string;
  issuer: string;
  balance: number;
  trustline: boolean;
}

const MOCK_ANCHORS: Anchor[] = [
  {
    id: '1',
    name: 'Stellar Lumens',
    code: 'XLM',
    issuer: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B',
    balance: 1000,
    trustline: true,
  },
  {
    id: '2',
    name: 'USD Anchor',
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4IHTZMZMJRMBT7YJGKFTLKNQGO5OJ2H',
    balance: 500,
    trustline: true,
  },
  {
    id: '3',
    name: 'EUR Anchor',
    code: 'EURT',
    issuer: 'GAP5LETOV6YIE62YAM56STDANPRDO7ZJYGLUCSTQCIUHTZ4CCISHVJA',
    balance: 250,
    trustline: false,
  },
];

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i} className="p-4">
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AnchorsPage() {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    const fetchAnchors = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setAnchors(MOCK_ANCHORS);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch anchors');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnchors();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Anchors</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          Manage your Stellar anchors and trustlines
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Anchors List */}
          <div className="lg:col-span-2">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Available Anchors</h2>

              {isLoading ? (
                <LoadingSkeleton />
              ) : error ? (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-800 dark:text-red-200">
                  {error}
                </div>
              ) : anchors.length === 0 ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                  No anchors found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anchors.map((anchor) => (
                        <TableRow
                          key={anchor.id}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() => setSelectedAnchor(anchor)}
                        >
                          <TableCell className="font-medium">{anchor.name}</TableCell>
                          <TableCell>{anchor.code}</TableCell>
                          <TableCell>{anchor.balance.toLocaleString()}</TableCell>
                          <TableCell>
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-medium ${
                                anchor.trustline
                                  ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                  : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                              }`}
                            >
                              {anchor.trustline ? 'Active' : 'Pending'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <button className="text-indigo-600 dark:text-indigo-400 hover:underline">
                              View
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </div>

          {/* Detail View */}
          <div>
            <Card className="p-6 sticky top-8">
              <h2 className="text-xl font-semibold mb-4">Details</h2>

              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : selectedAnchor ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Name</p>
                    <p className="font-semibold">{selectedAnchor.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Code</p>
                    <p className="font-semibold">{selectedAnchor.code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Issuer</p>
                    <p className="font-mono text-xs break-all">{selectedAnchor.issuer}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Balance</p>
                    <p className="text-2xl font-bold">{selectedAnchor.balance.toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                  Select an anchor to view details
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
