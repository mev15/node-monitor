import { loadConfig } from '../../src/config';
import { Logger } from '../../src/core/Logger';
import { TelegramNotifier } from '../../src/core/TelegramNotifier';
import { EthereumMonitor } from '../../src/monitors/EthereumMonitor';
import { RedisMonitor } from '../../src/monitors/RedisMonitor';
import { jest } from '@jest/globals';

// Mock viem
jest.mock('viem', () => ({
  createPublicClient: jest.fn(),
  webSocket: jest.fn(),
  mainnet: {},
}));

// Mock ioredis
jest.mock('ioredis');

// Mock node-telegram-bot-api
jest.mock('node-telegram-bot-api');

describe('Multi-Monitor Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singletons
    Logger.resetInstance();
    TelegramNotifier.resetInstance();

    // Setup environment
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: 'test_token',
      TELEGRAM_CHAT_ID: 'test_chat',
      ETHEREUM_WS_URL: 'ws://localhost:8545',
      ENABLE_ETHEREUM_MONITOR: 'true',
      ENABLE_REDIS_MONITOR: 'true',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Configuration Loading', () => {
    test('should load configuration for both monitors', () => {
      const config = loadConfig();

      expect(config.ethereum.enabled).toBe(true);
      expect(config.redis.enabled).toBe(true);
      expect(config.telegram.botToken).toBe('test_token');
      expect(config.telegram.chatId).toBe('test_chat');
    });
  });

  describe('Monitor Initialization', () => {
    test('should initialize both monitors with shared services', () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      const redisMonitor = new RedisMonitor(
        config.redis,
        logger,
        notifier
      );

      expect(ethereumMonitor).toBeDefined();
      expect(redisMonitor).toBeDefined();
      expect(ethereumMonitor.isEnabled()).toBe(true);
      expect(redisMonitor.isEnabled()).toBe(true);
    });

    test('should share the same Logger instance', () => {
      const logger1 = Logger.getInstance();
      const logger2 = Logger.getInstance();

      expect(logger1).toBe(logger2);
    });

    test('should share the same TelegramNotifier instance', () => {
      const config = loadConfig();
      const notifier1 = TelegramNotifier.getInstance(config.telegram);
      const notifier2 = TelegramNotifier.getInstance();

      expect(notifier1).toBe(notifier2);
    });
  });

  describe('Selective Monitor Enabling', () => {
    test('should only initialize Ethereum monitor when Redis is disabled', () => {
      process.env.ENABLE_REDIS_MONITOR = 'false';

      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      expect(ethereumMonitor.isEnabled()).toBe(true);
      expect(config.redis.enabled).toBe(false);
    });

    test('should only initialize Redis monitor when Ethereum is disabled', () => {
      process.env.ENABLE_ETHEREUM_MONITOR = 'false';

      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const redisMonitor = new RedisMonitor(
        config.redis,
        logger,
        notifier
      );

      expect(redisMonitor.isEnabled()).toBe(true);
      expect(config.ethereum.enabled).toBe(false);
    });
  });

  describe('Monitor Status', () => {
    test('should track monitor status independently', () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      const redisMonitor = new RedisMonitor(
        config.redis,
        logger,
        notifier
      );

      expect(ethereumMonitor.getStatus()).toBe('idle');
      expect(redisMonitor.getStatus()).toBe('idle');

      // Status should be independent
      ethereumMonitor['status'] = 'connecting' as any;
      expect(ethereumMonitor.getStatus()).toBe('connecting');
      expect(redisMonitor.getStatus()).toBe('idle');
    });
  });

  describe('Backward Compatibility', () => {
    test('should work with legacy environment variables', () => {
      // Remove new flags to simulate legacy setup
      delete process.env.ENABLE_ETHEREUM_MONITOR;
      delete process.env.ENABLE_REDIS_MONITOR;

      const config = loadConfig();

      // Ethereum should be enabled by default
      expect(config.ethereum.enabled).toBe(true);
      // Redis should be disabled by default
      expect(config.redis.enabled).toBe(false);
    });
  });
});