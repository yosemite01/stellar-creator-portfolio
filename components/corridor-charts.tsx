'use client';

import React from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ErrorBoundary } from './error-boundary';

interface ChartData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface CorridorChartsProps {
  data?: ChartData[];
  title?: string;
  type?: 'line' | 'bar';
}

const ChartContent: React.FC<CorridorChartsProps> = ({ data = [], title = 'Chart', type = 'line' }) => {
  // Validate data structure
  const isValidData = (arr: unknown[]): arr is ChartData[] => {
    return Array.isArray(arr) && arr.every(item => 
      typeof item === 'object' && 
      item !== null && 
      'name' in item && 
      'value' in item &&
      typeof (item as ChartData).value === 'number'
    );
  };

  if (!data || data.length === 0 || !isValidData(data)) {
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
        <Chart data={data}>
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
  return (
    <ErrorBoundary>
      <ChartContent {...props} />
    </ErrorBoundary>
  );
};
