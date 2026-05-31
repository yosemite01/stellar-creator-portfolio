import { AppState, AppStateStatus, Platform } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import DeviceInfo from 'react-native-device-info';

export type SyncPriority = 'critical' | 'high' | 'normal' | 'low' | 'deferred';

export interface SyncTask {
  id: string;
  priority: SyncPriority;
  handler: () => Promise<void>;
  requiresWifi?: boolean;
  minBatteryLevel?: number;
  retries?: number;
  timeout?: number;
}

interface SchedulerState {
  batteryLevel: number;
  isLowPowerMode: boolean;
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
  networkType: 'wifi' | 'cellular' | 'none';
  isCharging: boolean;
}

const THERMAL_THROTTLE_MAP: Record<string, SyncPriority> = {
  nominal: 'normal',
  fair: 'normal',
  serious: 'high',
  critical: 'critical',
};

const BATTERY_THRESHOLDS = {
  critical: 0.1,
  low: 0.2,
  moderate: 0.4,
};

export class SyncScheduler {
  private queue: Map<string, SyncTask> = new Map();
  private running = new Set<string>();
  private state: SchedulerState = {
    batteryLevel: 1,
    isLowPowerMode: false,
    thermalState: 'nominal',
    networkType: 'wifi',
    isCharging: false,
  };
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private netInfoUnsubscribe: (() => void) | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  constructor(private tickMs = 5000) {}

  async start(): Promise<void> {
    await this.refreshState();
    this.netInfoUnsubscribe = NetInfo.addEventListener(this.onNetworkChange);
    this.appStateSubscription = AppState.addEventListener('change', this.onAppStateChange);
    this.tickInterval = setInterval(this.tick, this.tickMs);
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.netInfoUnsubscribe?.();
    this.appStateSubscription?.remove();
  }

  enqueue(task: SyncTask): void {
    this.queue.set(task.id, task);
  }

  dequeue(taskId: string): void {
    this.queue.delete(taskId);
  }

  private async refreshState(): Promise<void> {
    const [battery, lowPower, thermal, net] = await Promise.all([
      DeviceInfo.getBatteryLevel(),
      DeviceInfo.isPowerSaveMode(),
      this.getThermalState(),
      NetInfo.fetch(),
    ]);

    this.state = {
      batteryLevel: battery,
      isLowPowerMode: lowPower,
      thermalState: thermal,
      networkType: this.resolveNetworkType(net),
      isCharging: await DeviceInfo.isBatteryCharging(),
    };
  }

  private getThermalState(): Promise<'nominal' | 'fair' | 'serious' | 'critical'> {
    if (Platform.OS === 'ios') {
      // react-native-thermal-state or native bridge would be used here
      return Promise.resolve('nominal');
    }
    // Android: use DeviceInfo or native thermal headroom API
    return Promise.resolve('nominal');
  }

  private resolveNetworkType(net: NetInfoState): 'wifi' | 'cellular' | 'none' {
    if (!net.isConnected) return 'none';
    if (net.type === 'wifi') return 'wifi';
    if (net.type === 'cellular') return 'cellular';
    return 'none';
  }

  private onNetworkChange = (state: NetInfoState): void => {
    this.state.networkType = this.resolveNetworkType(state);
    if (this.state.networkType === 'wifi') {
      // Opportunity: flush wifi-only tasks
      this.tick();
    }
  };

  private onAppStateChange = (nextState: AppStateStatus): void => {
    if (nextState === 'background') {
      // Throttle further when backgrounded under battery pressure
    }
    if (nextState === 'active') {
      this.refreshState().then(() => this.tick());
    }
  };

  private effectivePriority(task: SyncTask): SyncPriority {
    const { batteryLevel, isLowPowerMode, thermalState, isCharging } = this.state;

    if (thermalState === 'critical') return 'critical';
    if (thermalState === 'serious' && task.priority !== 'critical') return 'high';

    if (isLowPowerMode && task.priority === 'low') return 'deferred';
    if (!isCharging && batteryLevel <= BATTERY_THRESHOLDS.critical && task.priority !== 'critical') return 'deferred';
    if (!isCharging && batteryLevel <= BATTERY_THRESHOLDS.low && task.priority === 'low') return 'deferred';

    return task.priority;
  }

  private canRun(task: SyncTask): boolean {
    const eff = this.effectivePriority(task);
    if (eff === 'deferred') return false;
    if (task.requiresWifi && this.state.networkType !== 'wifi') return false;
    if (this.state.networkType === 'none' && task.priority !== 'critical') return false;
    if (task.minBatteryLevel && this.state.batteryLevel < task.minBatteryLevel) return false;
    if (this.running.has(task.id)) return false;
    return true;
  }

  private tick = async (): Promise<void> => {
    await this.refreshState();

    const runnable = Array.from(this.queue.values())
      .filter((t) => this.canRun(t))
      .sort((a, b) => this.priorityWeight(b) - this.priorityWeight(a));

    const concurrency = this.resolveConcurrency();

    for (const task of runnable) {
      if (this.running.size >= concurrency) break;
      this.running.add(task.id);
      this.executeTask(task).finally(() => {
        this.running.delete(task.id);
        this.queue.delete(task.id);
      });
    }
  };

  private async executeTask(task: SyncTask): Promise<void> {
    const maxRetries = task.retries ?? 2;
    const timeout = task.timeout ?? 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await Promise.race([
          task.handler(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SyncTask timeout')), timeout)
          ),
        ]);
        return;
      } catch {
        if (attempt === maxRetries) throw new Error(`Task ${task.id} failed after ${maxRetries} retries`);
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
  }

  private priorityWeight(task: SyncTask): number {
    const weights: Record<SyncPriority, number> = {
      critical: 100,
      high: 75,
      normal: 50,
      low: 25,
      deferred: 0,
    };
    return weights[task.priority];
  }

  private resolveConcurrency(): number {
    const { thermalState, isLowPowerMode, batteryLevel, isCharging } = this.state;
    if (thermalState === 'critical') return 1;
    if (thermalState === 'serious') return 1;
    if (isLowPowerMode) return 1;
    if (!isCharging && batteryLevel <= BATTERY_THRESHOLDS.moderate) return 2;
    return 4;
  }

  getState(): SchedulerState {
    return { ...this.state };
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  getRunningCount(): number {
    return this.running.size;
  }
}

export const syncScheduler = new SyncScheduler();
export default SyncScheduler;
