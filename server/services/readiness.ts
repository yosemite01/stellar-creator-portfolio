export type DependencyCriticality = "critical" | "optional";

export type DependencyStatus = "up" | "down";

export interface DependencyCheck {
  name: string;
  criticality: DependencyCriticality;
  check: () => Promise<boolean>;
}

export interface DependencyResult {
  name: string;
  criticality: DependencyCriticality;
  status: DependencyStatus;
}

export interface ReadinessResult {
  ready: boolean;
  degraded: boolean;
  dependencies: DependencyResult[];
}

/**
 * Classify dependencies by criticality. Critical dependencies (e.g. the
 * primary database) must be up for the service to be ready. Optional
 * dependencies (e.g. Redis cache) may be down without taking the service
 * out of rotation; instead the service reports a degraded state.
 */
export const DEPENDENCY_CRITICALITY: Record<string, DependencyCriticality> = {
  database: "critical",
  redis: "optional",
};

export function classifyDependency(name: string): DependencyCriticality {
  return DEPENDENCY_CRITICALITY[name] ?? "critical";
}

async function runCheck(dep: DependencyCheck): Promise<DependencyResult> {
  let status: DependencyStatus = "down";
  try {
    status = (await dep.check()) ? "up" : "down";
  } catch {
    status = "down";
  }
  return {
    name: dep.name,
    criticality: dep.criticality,
    status,
  };
}

/**
 * Evaluate readiness across all dependencies.
 *
 * - Any critical dependency down => ready=false.
 * - Only optional dependencies down => ready=true, degraded=true.
 * - All dependencies up => ready=true, degraded=false.
 */
export async function checkReadiness(
  dependencies: DependencyCheck[],
): Promise<ReadinessResult> {
  const results = await Promise.all(dependencies.map(runCheck));

  const criticalDown = results.some(
    (r) => r.criticality === "critical" && r.status === "down",
  );
  const optionalDown = results.some(
    (r) => r.criticality === "optional" && r.status === "down",
  );

  return {
    ready: !criticalDown,
    degraded: !criticalDown && optionalDown,
    dependencies: results,
  };
}
