import { RedisMonitor } from '../../src/monitors/RedisMonitor';
import { Logger } from '../../src/core/Logger';
import { TelegramNotifier } from '../../src/core/TelegramNotifier';
import { RedisConfig } from '../../src/types';
import Redis from 'ioredis';
import { jest } from '@jest/globals';

// Mock ioredis
jest.mock('ioredis');

// Mock Logger
jest.mock('../../src/core/Logger');

// Mock TelegramNotifier
jest.mock('../../src/core/TelegramNotifier');

describe('RedisMonitor', () => {
  let redisMonitor: RedisMonitor;
  let mockLogger: jest.Mocked<Logger>;
  let mockNotifier: jest.Mocked<TelegramNotifier>;
  let mockRedisClient: jest.Mocked<Redis>;
  let config: RedisConfig;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup config
    config = {
      name: 'Redis',
      enabled: true,
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0,
      healthCheckIntervalMs: 30000,
      timeoutMs: 5000,
      memoryAlertThresholdMb: 1000,
      maxReconnectAttempts: 3,
      reconnectDelayMs: 5000,
    };

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      createChildLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
    } as any;

    // Setup mock notifier
    mockNotifier = {
      sendMessage: jest.fn(() => Promise.resolve()),
    } as any;

    // Setup mock Redis client
    mockRedisClient = {
      connect: jest.fn(() => Promise.resolve()),
      ping: jest.fn(() => Promise.resolve('PONG')),
      info: jest.fn((section: any) => {
        if (section === 'memory') {
          return Promise.resolve('# Memory\nused_memory:524288000\n');
        }
        if (section === 'clients') {
          return Promise.resolve('# Clients\nconnected_clients:10\n');
        }
        return Promise.resolve('');
      }),
      quit: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
    } as any;

    // Mock Redis constructor
    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedisClient);

    // Create RedisMonitor instance
    redisMonitor = new RedisMonitor(config, mockLogger, mockNotifier);
  });

  describe('Connection', () => {
    test('should connect to Redis successfully', async () => {
      await redisMonitor['connect']();

      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    test('should handle connection failure', async () => {
      const error = new Error('Connection refused');
      mockRedisClient.connect = jest.fn(() => Promise.reject(error));

      await expect(redisMonitor['connect']()).rejects.toThrow('Connection refused');
    });

    test('should handle ping failure after connection', async () => {
      const error = new Error('Ping failed');
      mockRedisClient.ping = jest.fn(() => Promise.reject(error));

      await expect(redisMonitor['connect']()).rejects.toThrow('Ping failed');
    });
  });

  describe('Health Check', () => {
    beforeEach(async () => {
      // Establish connection first
      await redisMonitor['connect']();
      redisMonitor['status'] = 'connected' as any;
    });

    test('should return healthy when all checks pass', async () => {
      const result = await redisMonitor['performHealthCheck']();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('Redis is healthy');
      expect(result.details).toMatchObject({
        responseTime: expect.stringMatching(/^\d+ms$/),
        memoryUsedBytes: 524288000,
        memoryUsedMb: 500,
        connectedClients: 10,
      });
    });

    test('should return unhealthy when memory threshold exceeded', async () => {
      // Set memory threshold to 400MB (below current usage of 500MB)
      config.memoryAlertThresholdMb = 400;

      const result = await redisMonitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Redis health issues detected');
      expect(result.details?.issues).toContain(
        'Memory usage exceeds threshold (500 MB > 400 MB)'
      );
    });

    test('should return unhealthy when ping times out', async () => {
      mockRedisClient.ping = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve('PONG'), 10000))
      );

      const result = await redisMonitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Ping timeout');
    });

    test('should return unhealthy when Redis is not connected', async () => {
      redisMonitor['status'] = 'disconnected' as any;

      const result = await redisMonitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe('Redis client is not connected');
    });

    test('should handle unexpected ping response', async () => {
      mockRedisClient.ping = jest.fn(() => Promise.resolve('UNEXPECTED' as any));

      const result = await redisMonitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Unexpected ping response');
    });
  });

  describe('Startup Message', () => {
    test('should generate correct startup message', () => {
      const message = redisMonitor['getStartupMessage']();

      expect(message).toContain('Monitoring Redis: localhost:6379');
      expect(message).toContain('Database: 0');
      expect(message).toContain('Health check interval: 30 seconds');
      expect(message).toContain('Timeout: 5000ms');
      expect(message).toContain('Memory alert threshold: 1000 MB');
      expect(message).toContain('Max reconnect attempts: 3');
    });

    test('should show IP address for localhost', () => {
      // Mock getLocalIpv4 to return a specific IP
      redisMonitor['getLocalIpv4'] = jest.fn().mockReturnValue('192.168.1.100') as any;

      // Recreate monitor to apply the mock
      redisMonitor = new RedisMonitor(config, mockLogger, mockNotifier);
      redisMonitor['getLocalIpv4'] = jest.fn().mockReturnValue('192.168.1.100') as any;

      const message = redisMonitor['getStartupMessage']();

      expect(message).toContain('192.168.1.100:6379');
    });
  });

  describe('Disconnect', () => {
    test('should disconnect properly', async () => {
      await redisMonitor['connect']();
      await redisMonitor['disconnect']();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    test('should handle disconnect errors gracefully', async () => {
      const error = new Error('Quit failed');
      mockRedisClient.quit = jest.fn(() => Promise.reject(error));

      await redisMonitor['connect']();

      // Should not throw
      await expect(redisMonitor['disconnect']()).resolves.toBeUndefined();
    });
  });

  describe('Test Connection', () => {
    test('should return true when connected and ping succeeds', async () => {
      await redisMonitor['connect']();
      redisMonitor['status'] = 'connected' as any;

      const result = await redisMonitor.testConnection();

      expect(result).toBe(true);
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    test('should return false when not connected', async () => {
      const result = await redisMonitor.testConnection();

      expect(result).toBe(false);
    });

    test('should return false when ping fails', async () => {
      await redisMonitor['connect']();
      redisMonitor['status'] = 'connected' as any;
      mockRedisClient.ping = jest.fn(() => Promise.reject(new Error('Ping failed')));

      const result = await redisMonitor.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('Memory Usage Parsing', () => {
    test('should parse memory usage correctly', () => {
      const info = '# Memory\nused_memory:1073741824\nused_memory_human:1.00G\n';
      const result = redisMonitor['parseMemoryUsage'](info);

      expect(result).toBe(1073741824);
    });

    test('should return null for invalid format', () => {
      const info = '# Memory\ninvalid_format\n';
      const result = redisMonitor['parseMemoryUsage'](info);

      expect(result).toBeNull();
    });
  });

  describe('Connected Clients Parsing', () => {
    test('should parse connected clients correctly', () => {
      const info = '# Clients\nconnected_clients:42\n';
      const result = redisMonitor['parseConnectedClients'](info);

      expect(result).toBe(42);
    });

    test('should return null for invalid format', () => {
      const info = '# Clients\ninvalid_format\n';
      const result = redisMonitor['parseConnectedClients'](info);

      expect(result).toBeNull();
    });
  });
});