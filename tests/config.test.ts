import { loadConfig } from '../src/config';
import { jest } from '@jest/globals';

describe('Config - Extended', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Monitor Enable/Disable Flags', () => {
    test('should enable Ethereum monitor by default for backward compatibility', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ETHEREUM_WS_URL = 'ws://localhost:8545';
      // Not setting ENABLE_ETHEREUM_MONITOR should default to true

      const config = loadConfig();

      expect(config.ethereum.enabled).toBe(true);
      expect(config.redis.enabled).toBe(false);
    });

    test('should respect explicit monitor enable flags', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ETHEREUM_WS_URL = 'ws://localhost:8545';
      process.env.ENABLE_ETHEREUM_MONITOR = 'false';
      process.env.ENABLE_REDIS_MONITOR = 'true';

      const config = loadConfig();

      expect(config.ethereum.enabled).toBe(false);
      expect(config.redis.enabled).toBe(true);
    });

    test('should throw error if no monitors are enabled', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ENABLE_ETHEREUM_MONITOR = 'false';
      process.env.ENABLE_REDIS_MONITOR = 'false';
      process.env.ENABLE_DISK_MONITOR = 'false';
      process.env.ENABLE_PM2_MONITOR = 'false';

      expect(() => loadConfig()).toThrow('At least one monitor must be enabled');
    });
  });

  describe('Redis Configuration', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ENABLE_REDIS_MONITOR = 'true';
      process.env.ENABLE_ETHEREUM_MONITOR = 'false';
    });

    test('should load Redis configuration with defaults', () => {
      const config = loadConfig();

      expect(config.redis.host).toBe('localhost');
      expect(config.redis.port).toBe(6379);
      expect(config.redis.db).toBe(0);
      expect(config.redis.password).toBeUndefined();
      expect(config.redis.healthCheckIntervalMs).toBe(30000);
      expect(config.redis.timeoutMs).toBe(5000);
      expect(config.redis.memoryAlertThresholdMb).toBeUndefined();
      expect(config.redis.maxReconnectAttempts).toBe(3);
      expect(config.redis.reconnectDelayMs).toBe(5000);
    });

    test('should load Redis configuration from environment', () => {
      process.env.REDIS_HOST = '192.168.1.100';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_PASSWORD = 'secret';
      process.env.REDIS_DB = '2';
      process.env.REDIS_HEALTH_CHECK_INTERVAL_MS = '60000';
      process.env.REDIS_TIMEOUT_MS = '10000';
      process.env.REDIS_MEMORY_ALERT_THRESHOLD_MB = '2000';
      process.env.REDIS_MAX_RECONNECT_ATTEMPTS = '5';
      process.env.REDIS_RECONNECT_DELAY_MS = '10000';

      const config = loadConfig();

      expect(config.redis.host).toBe('192.168.1.100');
      expect(config.redis.port).toBe(6380);
      expect(config.redis.password).toBe('secret');
      expect(config.redis.db).toBe(2);
      expect(config.redis.healthCheckIntervalMs).toBe(60000);
      expect(config.redis.timeoutMs).toBe(10000);
      expect(config.redis.memoryAlertThresholdMb).toBe(2000);
      expect(config.redis.maxReconnectAttempts).toBe(5);
      expect(config.redis.reconnectDelayMs).toBe(10000);
    });

    test('should fall back to common reconnect settings for Redis', () => {
      process.env.MAX_RECONNECT_ATTEMPTS = '10';
      process.env.RECONNECT_DELAY_MS = '15000';
      // Not setting REDIS_MAX_RECONNECT_ATTEMPTS or REDIS_RECONNECT_DELAY_MS

      const config = loadConfig();

      expect(config.redis.maxReconnectAttempts).toBe(10);
      expect(config.redis.reconnectDelayMs).toBe(15000);
    });
  });

  describe('Backward Compatibility', () => {
    test('should maintain backward compatibility with existing configuration', () => {
      // Set up environment as it would be for existing users
      process.env.ETHEREUM_WS_URL = 'ws://localhost:8545';
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.BLOCK_TIMEOUT_SECONDS = '120';
      process.env.MAX_RECONNECT_ATTEMPTS = '5';
      process.env.RECONNECT_DELAY_MS = '10000';

      const config = loadConfig();

      // Ethereum should be enabled by default
      expect(config.ethereum.enabled).toBe(true);
      expect(config.ethereum.wsUrl).toBe('ws://localhost:8545');
      expect(config.ethereum.blockTimeoutSeconds).toBe(120);
      expect(config.ethereum.maxReconnectAttempts).toBe(5);
      expect(config.ethereum.reconnectDelayMs).toBe(10000);

      // Redis should be disabled by default
      expect(config.redis.enabled).toBe(false);
    });
  });

  describe('Validation', () => {
    test('should require ETHEREUM_WS_URL when Ethereum monitor is enabled', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ENABLE_ETHEREUM_MONITOR = 'true';
      // Not setting ETHEREUM_WS_URL

      expect(() => loadConfig()).toThrow('ETHEREUM_WS_URL is required when Ethereum monitor is enabled');
    });

    test('should not require ETHEREUM_WS_URL when Ethereum monitor is disabled', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test_token';
      process.env.TELEGRAM_CHAT_ID = 'test_chat';
      process.env.ENABLE_ETHEREUM_MONITOR = 'false';
      process.env.ENABLE_REDIS_MONITOR = 'true';
      // Not setting ETHEREUM_WS_URL

      expect(() => loadConfig()).not.toThrow();
    });
  });
});