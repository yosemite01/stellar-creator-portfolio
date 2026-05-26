'use client';

import React from 'react';

type PaymentFlow = {
  jurisdiction: string;
  volume: number;
  transactions?: number;
  coordinates?: {
    x: number;
    y: number;
  };
};

type GeographicMapProps = {
  flows?: PaymentFlow[];
};

const DEFAULT_FLOWS: PaymentFlow[] = [
  { jurisdiction: 'United States', volume: 125000, transactions: 420, coordinates: { x: 23, y: 40 } },
  { jurisdiction: 'United Kingdom', volume: 84000, transactions: 280, coordinates: { x: 47, y: 34 } },
  { jurisdiction: 'Nigeria', volume: 68000, transactions: 240, coordinates: { x: 50, y: 55 } },
  { jurisdiction: 'Singapore', volume: 52000, transactions: 180, coordinates: { x: 72, y: 61 } },
  { jurisdiction: 'Brazil', volume: 41000, transactions: 150, coordinates: { x: 36, y: 69 } },
];

function formatVolume(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export default function GeographicMap({ flows = DEFAULT_FLOWS }: GeographicMapProps) {
  const maxVolume = Math.max(...flows.map((flow) => flow.volume), 1);
  const sortedFlows = [...flows].sort((a, b) => b.volume - a.volume);

  return (
    <section className="w-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Payment Flow Density</h3>
          <p className="text-sm text-slate-500">Volume by anchor jurisdiction</p>
        </div>
        <span className="text-sm font-medium text-slate-600">{flows.length} jurisdictions</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="relative min-h-72 overflow-hidden rounded-md bg-slate-950">
          <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(90deg,rgba(148,163,184,.18)_1px,transparent_1px),linear-gradient(rgba(148,163,184,.18)_1px,transparent_1px)] [background-size:12.5%_20%]" />
          <div className="absolute inset-x-6 top-1/2 h-px bg-slate-500/35" />
          {sortedFlows.map((flow) => {
            const coordinates = flow.coordinates ?? { x: 50, y: 50 };
            const intensity = flow.volume / maxVolume;
            const size = 24 + intensity * 44;

            return (
              <div
                key={flow.jurisdiction}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/40 ring-2 ring-cyan-200/80"
                style={{
                  left: `${coordinates.x}%`,
                  top: `${coordinates.y}%`,
                  width: size,
                  height: size,
                  boxShadow: `0 0 ${Math.round(18 + intensity * 34)}px rgba(34, 211, 238, ${0.2 + intensity * 0.45})`,
                }}
                title={`${flow.jurisdiction}: ${formatVolume(flow.volume)}`}
              >
                <span className="sr-only">
                  {flow.jurisdiction} payment volume {flow.volume}
                </span>
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          {sortedFlows.map((flow) => {
            const width = `${Math.max((flow.volume / maxVolume) * 100, 8)}%`;

            return (
              <div key={flow.jurisdiction} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-700">{flow.jurisdiction}</span>
                  <span className="shrink-0 text-slate-500">{formatVolume(flow.volume)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
