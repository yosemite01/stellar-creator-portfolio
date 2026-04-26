'use client';

import React from 'react';
import { CorridorCharts } from '@/components/corridor-charts';

const mockChartData = [
  { name: 'Jan', value: 400 },
  { name: 'Feb', value: 300 },
  { name: 'Mar', value: 200 },
  { name: 'Apr', value: 278 },
  { name: 'May', value: 190 },
  { name: 'Jun', value: 239 },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">Welcome back to your analytics</p>
        </div>
      </div>

      {/* Main Content - Responsive Grid Layout */}
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Sidebar - Full width on mobile/tablet, 1 column on desktop */}
          <aside className="lg:col-span-1 space-y-4">
            <div className="bg-card rounded-lg border p-4">
              <h2 className="font-semibold mb-4">Filters</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Date Range</label>
                  <select className="w-full mt-1 px-3 py-2 border rounded-md text-sm">
                    <option>Last 7 days</option>
                    <option>Last 30 days</option>
                    <option>Last 90 days</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Category</label>
                  <select className="w-full mt-1 px-3 py-2 border rounded-md text-sm">
                    <option>All</option>
                    <option>Revenue</option>
                    <option>Users</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4">
              <h3 className="font-semibold mb-3">Quick Stats</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Revenue</span>
                  <span className="font-medium">$12,450</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Users</span>
                  <span className="font-medium">1,234</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Conversion</span>
                  <span className="font-medium">3.2%</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Charts - Full width on mobile/tablet, 3 columns on desktop */}
          <main className="lg:col-span-3 space-y-6">
            {/* Chart 1 */}
            <div className="bg-card rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Revenue Trend</h2>
              <CorridorCharts data={mockChartData} title="Revenue" type="line" />
            </div>

            {/* Chart 2 */}
            <div className="bg-card rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">User Activity</h2>
              <CorridorCharts data={mockChartData} title="Users" type="bar" />
            </div>

            {/* Chart 3 */}
            <div className="bg-card rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Performance Metrics</h2>
              <CorridorCharts data={mockChartData} title="Metrics" type="line" />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
