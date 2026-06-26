/**
 * useFeeEstimation Hook
 * Fetches and manages fee estimates for contract operations
 */

import { useEffect, useState } from "react";
import apiClient from "../services/ApiClient";

export interface FeeEstimate {
  platform_fee: number;
  network_fee: number;
  resource_fee: number;
  total_fee: number;
  base_resource_fee?: number;
}

export interface FeeEstimationState {
  estimate: FeeEstimate | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetch fee estimate for a contract method
 */
export function useFeeEstimation(
  contract: string | null,
  method: string | null,
  budget: number | null,
): FeeEstimationState {
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEstimate = async () => {
    if (!contract || !method || budget === null || budget < 0) {
      setEstimate(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `/api/estimate?contract=${encodeURIComponent(contract)}&method=${encodeURIComponent(method)}&budget=${budget}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setEstimate(data.estimates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch fee estimate");
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  };

  // Fetch when dependencies change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchEstimate();
    }, 300); // Debounce by 300ms

    return () => clearTimeout(timeoutId);
  }, [contract, method, budget]);

  return {
    estimate,
    loading,
    error,
    refetch: fetchEstimate,
  };
}

/**
 * Hook to calculate bounty creation fee
 */
export function useBountyCreationFee(budget: number | null): FeeEstimationState {
  return useFeeEstimation("bounty", "create_bounty", budget);
}

/**
 * Hook to calculate escrow funding fee
 */
export function useEscrowFundingFee(amount: number | null): FeeEstimationState {
  return useFeeEstimation("escrow", "fund_escrow", amount);
}
