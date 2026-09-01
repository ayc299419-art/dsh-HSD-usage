// dsh-HSD-usage 类型声明（实现为纯 JS，本文件供 TS 使用者参考）

export type TimeRange = '5h' | 'week' | 'month';
export type Unit = 'tokens' | 'requests' | 'cost';

export interface UsageData {
  value: number | null;
  unit: Unit;
  timestamp: number;
  available: boolean;
  source?: 'api' | 'estimate' | 'local';
  reason?: string;
  meta?: Record<string, any>;
}

export interface ProviderInstance {
  id: string;
  type: string;
  name: string;
  credentials: Record<string, string>;
  quotaLimit?: number;
  enabled: boolean;
  createdAt: number;
}

export interface InstanceUsage {
  instanceId: string;
  usage5h?: UsageData;
  usageWeek?: UsageData;
  usageMonth?: UsageData;
  lastUpdated: number;
  refreshing?: boolean;
}

export interface UsageProviderAdapter {
  type: string;
  fetchUsage(credentials: Record<string, string>, timeRange: TimeRange): Promise<UsageData>;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
}

export class InstanceManager {
  constructor(options?: { storage?: any });
  getAll(): ProviderInstance[];
  getEnabled(): ProviderInstance[];
  getById(id: string): ProviderInstance | undefined;
  add(input: Omit<ProviderInstance, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean }): ProviderInstance;
  update(id: string, updates: Partial<ProviderInstance>): boolean;
  remove(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
  toggleEnabled(id: string): boolean;
  showAll(): void; hideAll(): void; invert(): void;
}

export class Controller {
  constructor(options: { manager: InstanceManager; adapters?: ((type: string) => UsageProviderAdapter | undefined) | null; localSource?: any; refreshIntervalMs?: number; useLocalFallback?: boolean; modelMapping?: any; });
  config: Record<string, any>;
  start(): void; stop(): void;
  setRefreshInterval(ms: number): void;
  refreshAll(): Promise<void>;
  refreshInstance(id: string): Promise<InstanceUsage | undefined>;
  getCachedUsage(id: string): InstanceUsage | undefined;
  getAllCachedUsages(): Map<string, InstanceUsage>;
  onModelChanged(modelName: string): void;
  updateConfig(patch: Record<string, any>): void;
}

export function registerAdapter(adapter: UsageProviderAdapter): void;
export function getAdapter(type: string): UsageProviderAdapter | undefined;
export function getAllAdapterTypes(): string[];
export async function createMonitor(options?: { configPath?: string; localCachePath?: string; localSource?: boolean; refreshIntervalMs?: number }): Promise<{ manager: InstanceManager; controller: Controller; localSource: any; storage: any; configPath: string }>;
export function renderReport(usages: Map<string, InstanceUsage>, instances: ProviderInstance[]): string;
export function main(argv?: string[]): Promise<number>;
