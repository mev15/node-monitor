import * as dotenv from 'dotenv';
import { Config, EthereumConfig, RedisConfig, DiskConfig, TelegramConfig } from './types';

dotenv.config();

export function loadConfig(): Config {
  // Telegram configuration (always required)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID is required');
  }

  const telegram: TelegramConfig = {
    botToken,
    chatId,
  };

  // Ethereum configuration
  const ethereumEnabled = process.env.ENABLE_ETHEREUM_MONITOR !== 'false'; // Default to true for backward compatibility
  const wsUrl = process.env.ETHEREUM_WS_URL || '';

  if (ethereumEnabled && !wsUrl) {
    throw new Error('ETHEREUM_WS_URL is required when Ethereum monitor is enabled');
  }

  const ethereum: EthereumConfig = {
    name: 'Ethereum',
    enabled: ethereumEnabled,
    wsUrl,
    blockTimeoutSeconds: parseInt(process.env.BLOCK_TIMEOUT_SECONDS || '60', 10),
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '3', 10),
    reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
  };

  // Redis configuration
  const redisEnabled = process.env.ENABLE_REDIS_MONITOR === 'true'; // Default to false
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  if (redisEnabled && !process.env.REDIS_HOST) {
    console.warn('REDIS_HOST not specified, using localhost');
  }

  const redis: RedisConfig = {
    name: 'Redis',
    enabled: redisEnabled,
    host: redisHost,
    port: redisPort,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    healthCheckIntervalMs: parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL_MS || '30000', 10),
    timeoutMs: parseInt(process.env.REDIS_TIMEOUT_MS || '5000', 10),
    memoryAlertThresholdMb: process.env.REDIS_MEMORY_ALERT_THRESHOLD_MB
      ? parseInt(process.env.REDIS_MEMORY_ALERT_THRESHOLD_MB, 10)
      : undefined,
    maxReconnectAttempts: parseInt(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || process.env.MAX_RECONNECT_ATTEMPTS || '3', 10),
    reconnectDelayMs: parseInt(process.env.REDIS_RECONNECT_DELAY_MS || process.env.RECONNECT_DELAY_MS || '5000', 10),
  };

  // Disk configuration
  const diskEnabled = process.env.ENABLE_DISK_MONITOR === 'true'; // Default to false
  const diskPath = process.env.DISK_PATH || '/';
  const diskThresholdPercent = parseInt(process.env.DISK_THRESHOLD_PERCENT || '80', 10);

  if (diskThresholdPercent < 0 || diskThresholdPercent > 100) {
    throw new Error('DISK_THRESHOLD_PERCENT must be between 0 and 100');
  }

  // 路径安全验证
  if (diskEnabled && diskPath) {
    // 白名单路径
    const ALLOWED_PATHS = ['/', '/data', '/var', '/home', '/tmp', '/opt', '/usr', '/mnt'];

    // 规范化路径
    const normalizedPath = diskPath.replace(/\/+$/, '') || '/';

    // 检查危险字符
    if (diskPath.includes('..') || diskPath.includes('~')) {
      throw new Error('DISK_PATH contains invalid characters (.., ~)');
    }

    // 检查是否在白名单中
    const isAllowed = ALLOWED_PATHS.some(allowed =>
      normalizedPath === allowed || normalizedPath.startsWith(allowed + '/')
    );

    if (!isAllowed) {
      throw new Error(`DISK_PATH not in whitelist. Allowed: ${ALLOWED_PATHS.join(', ')}`);
    }
  }

  const disk: DiskConfig = {
    name: 'Disk',
    enabled: diskEnabled,
    path: diskPath,
    thresholdPercent: diskThresholdPercent,
    maxReconnectAttempts: parseInt(process.env.DISK_MAX_RECONNECT_ATTEMPTS || process.env.MAX_RECONNECT_ATTEMPTS || '3', 10),
    reconnectDelayMs: parseInt(process.env.DISK_RECONNECT_DELAY_MS || process.env.RECONNECT_DELAY_MS || '5000', 10),
  };

  // Ensure at least one monitor is enabled
  if (!ethereum.enabled && !redis.enabled && !disk.enabled) {
    throw new Error('At least one monitor must be enabled (ENABLE_ETHEREUM_MONITOR, ENABLE_REDIS_MONITOR, or ENABLE_DISK_MONITOR)');
  }

  return {
    ethereum,
    redis,
    disk,
    telegram,
  };
}

// Export for backward compatibility
export { Config } from './types';