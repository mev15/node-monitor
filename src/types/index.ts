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

export interface Config {
  ethereum: EthereumConfig;
  redis: RedisConfig;
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