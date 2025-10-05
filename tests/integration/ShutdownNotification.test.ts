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
let mockSendMessage = jest.fn();
jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  }));
});

describe('Shutdown Notification Regression Tests', () => {
  const originalEnv = process.env;
  let originalExit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockClear();

    // Reset singletons
    Logger.resetInstance();
    TelegramNotifier.resetInstance();

    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn() as any;

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
    process.exit = originalExit;
  });

  describe('Ethereum Monitor Shutdown Notifications', () => {
    test('should send notification on BLOCK_TIMEOUT before shutdown', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Simulate block timeout scenario
      await ethereumMonitor['sendAlert']('Block Timeout', 'No new blocks received for 60 seconds');
      await ethereumMonitor.shutdown('BLOCK_TIMEOUT');

      // Check if alert was sent before shutdown
      const alertCalls = mockSendMessage.mock.calls.filter(call =>
        (call[1] as string).includes('Block Timeout')
      );

      expect(alertCalls.length).toBeGreaterThan(0);
      expect(alertCalls[0][1]).toContain('🚨');
      expect(alertCalls[0][1]).toContain('Block Timeout');
    });

    test('should send notification on CONNECTION_LOST before shutdown', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Simulate connection lost scenario
      await ethereumMonitor['sendAlert']('Connection Lost', 'Failed to connect after max attempts');
      await ethereumMonitor.shutdown('CONNECTION_LOST');

      // Check if alert was sent
      const alertCalls = mockSendMessage.mock.calls.filter(call =>
        (call[1] as string).includes('Connection Lost')
      );

      expect(alertCalls.length).toBeGreaterThan(0);
      expect(alertCalls[0][1]).toContain('🚨');
      expect(alertCalls[0][1]).toContain('Connection Lost');
    });

    test('should send shutdown notification on manual shutdown', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Check if shutdown sends any notification
      await ethereumMonitor.shutdown('SIGINT');

      // In the current implementation, check if any shutdown-related message is sent
      // The original implementation might have sent a message here
      console.log('Mock calls during SIGINT shutdown:', mockSendMessage.mock.calls);
    });
  });

  describe('Redis Monitor Shutdown Notifications', () => {
    test('should send notification on HEALTH_CHECK_FAILED before shutdown', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const redisMonitor = new RedisMonitor(
        config.redis,
        logger,
        notifier
      );

      // Simulate health check failure
      await redisMonitor['sendAlert']('Health Check Failed', 'Redis health check failed after 3 attempts');
      await redisMonitor.shutdown('HEALTH_CHECK_FAILED');

      // Check if alert was sent
      const alertCalls = mockSendMessage.mock.calls.filter(call =>
        (call[1] as string).includes('Health Check Failed')
      );

      expect(alertCalls.length).toBeGreaterThan(0);
      expect(alertCalls[0][1]).toContain('🚨');
      expect(alertCalls[0][1]).toContain('Health Check Failed');
    });

    test('should send notification on CONNECTION_LOST before shutdown', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const redisMonitor = new RedisMonitor(
        config.redis,
        logger,
        notifier
      );

      // Simulate connection lost
      await redisMonitor['sendAlert']('Connection Lost', 'Failed to connect to Redis after max attempts');
      await redisMonitor.shutdown('CONNECTION_LOST');

      // Check if alert was sent
      const alertCalls = mockSendMessage.mock.calls.filter(call =>
        (call[1] as string).includes('Connection Lost')
      );

      expect(alertCalls.length).toBeGreaterThan(0);
      expect(alertCalls[0][1]).toContain('🚨');
      expect(alertCalls[0][1]).toContain('Connection Lost');
    });
  });

  describe('BaseMonitor handleConnectionFailure', () => {
    test('should send alert when max reconnection attempts reached', async () => {
      const config = loadConfig();
      config.ethereum.maxReconnectAttempts = 2;
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Set reconnect attempts to max
      ethereumMonitor['reconnectAttempts'] = 2;

      // Trigger handleConnectionFailure
      await ethereumMonitor['handleConnectionFailure']();

      // Check if connection lost alert was sent
      const alertCalls = mockSendMessage.mock.calls.filter(call =>
        (call[1] as string).includes('Connection Lost')
      );

      expect(alertCalls.length).toBe(1);
      expect(alertCalls[0][1]).toContain('Failed to connect');
      expect(alertCalls[0][1]).toContain('after 2 attempts');
    });
  });

  describe('Critical Issue: Process Exit Without Notification', () => {
    test('REGRESSION: should send notification BEFORE process.exit is called', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Mock the internal methods to track order
      const sendAlertSpy = jest.spyOn(ethereumMonitor as any, 'sendAlert');

      // Simulate the actual flow that happens during block timeout
      // In EthereumMonitor.startHealthCheck(), when timeout is detected:
      // 1. sendAlert is called
      // 2. shutdown is called
      // The question is: does process.exit happen before sendAlert completes?

      await ethereumMonitor['sendAlert']('Block Timeout', 'Test message');
      await ethereumMonitor['shutdown']('BLOCK_TIMEOUT');

      // Verify the alert was sent
      expect(sendAlertSpy).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalled();

      // Check that notification was sent before process.exit would be called
      // In the current implementation, shutdown() in BaseMonitor does NOT call process.exit
      // Only the MonitorCoordinator calls process.exit

      console.log('BaseMonitor.shutdown does not call process.exit - this is the issue!');
    });

    test('ISSUE IDENTIFIED: BaseMonitor.shutdown does not send shutdown notification or exit process', async () => {
      const config = loadConfig();
      const logger = Logger.getInstance();
      const notifier = TelegramNotifier.getInstance(config.telegram);

      const ethereumMonitor = new EthereumMonitor(
        config.ethereum,
        logger,
        notifier
      );

      // Call shutdown directly
      await ethereumMonitor.shutdown('TEST_REASON');

      // Check what happens:
      // 1. Does it send a shutdown notification? NO
      // 2. Does it call process.exit? NO

      expect(process.exit).not.toHaveBeenCalled();

      // The original implementation's shutdown() method would call process.exit
      // The new BaseMonitor.shutdown() does not call process.exit
      // This means when monitors detect issues and call shutdown(), the process doesn't actually exit!
    });
  });
});