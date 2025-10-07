export interface MonitorConfig {
  name: string;
  enabled: boolean;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface EthereumConfig extends MonitorConfig {
  wsUrl: string;
  blockTimeoutSeconds: number;
}

export interface RedisConfig extends MonitorConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  healthCheckIntervalMs: number;
  timeoutMs: number;
  memoryAlertThresholdMb?: number;
}

export interface DiskConfig extends MonitorConfig {
  path: string;  // 要监控的路径或挂载点（单个路径）
  thresholdPercent: number;  // 使用率告警阈值（百分比，0-100）
}

export interface Config {
  ethereum: EthereumConfig;
  redis: RedisConfig;
  disk: DiskConfig;
  telegram: TelegramConfig;
}

export enum MonitorStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  SHUTTING_DOWN = 'shutting_down'
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  details?: Record<string, any>;
}