'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChartData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface CorridorData {
  from: string;
  to: string;
  volume: number;
  transactions: number;
}

interface CorridorChartsProps {
  data?: ChartData[];
  title?: string;
  type?: 'line' | 'bar';
  period?: '1d' | '7d' | '30d' | '90d';
}

const ChartContent: React.FC<CorridorChartsProps> = ({
  data = [],
  title = 'Chart',
  type = 'line',
  period = '30d',
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>(data);

  useEffect(() => {
    const fetchCorridorData = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/analytics/corridors?period=${period}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch corridor data: ${response.statusText}`);
        }

        const result = await response.json();

        // Transform corridor data to chart format
        const transformed: ChartData[] = (result.corridors || []).map(
          (corridor: CorridorData) => ({
            name: `${corridor.from} → ${corridor.to}`,
            value: corridor.volume,
            transactions: corridor.transactions,
          })
        );

        setChartData(transformed);
      } catch (err) {
        console.error('Error fetching corridor data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    // Only fetch if no data provided as prop
    if (data.length === 0) {
      fetchCorridorData();
    } else {
      setChartData(data);
      setLoading(false);
    }
  }, [data, period]);

  // Validate data structure
  const isValidData = (arr: unknown[]): arr is ChartData[] => {
    return (
      Array.isArray(arr) &&
      arr.every(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'name' in item &&
          'value' in item &&
          typeof (item as ChartData).value === 'number'
      )
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading corridor data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <div className="text-center">
          <p className="font-medium mb-1">Error loading data</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!chartData || chartData.length === 0 || !isValidData(chartData)) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data available
      </div>
    );
  }

  const Chart = type === 'line' ? LineChart : BarChart;
  const DataComponent = type === 'line' ? Line : Bar;

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <DataComponent type="monotone" dataKey="value" stroke="#8884d8" />
        </Chart>
      </ResponsiveContainer>
    </div>
  );
};

export const CorridorCharts: React.FC<CorridorChartsProps> = (props) => {
  return <ChartContent {...props} />;
};
