import { DiskMonitor } from '../../src/monitors/DiskMonitor';
import { DiskConfig } from '../../src/types';
import { Logger } from '../../src/core/Logger';
import { TelegramNotifier } from '../../src/core/TelegramNotifier';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

// Mock dependencies
jest.mock('fs');
jest.mock('child_process');
jest.mock('../../src/core/Logger');
jest.mock('../../src/core/TelegramNotifier');

// Mock path module to avoid normalization issues in tests
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  normalize: jest.fn((p) => p)
}));

describe('DiskMonitor', () => {
  let diskMonitor: DiskMonitor;
  let mockConfig: DiskConfig;
  let mockLogger: jest.Mocked<Logger>;
  let mockNotifier: jest.Mocked<TelegramNotifier>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup config
    mockConfig = {
      name: 'Disk',
      enabled: true,
      path: '/',
      thresholdPercent: 80,
      maxReconnectAttempts: 3,
      reconnectDelayMs: 5000
    };

    // Setup logger mock
    mockLogger = {
      createChildLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    // Setup notifier mock
    mockNotifier = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Create monitor instance
    diskMonitor = new DiskMonitor(mockConfig, mockLogger, mockNotifier);
  });

  describe('connect', () => {
    it('should successfully connect when path exists', async () => {
      // Mock fs.existsSync to return true for both path and df command
      (fs.existsSync as jest.Mock).mockImplementation((path) => {
        return path === '/' || path === '/bin/df';
      });

      // Mock df output for normal usage
      (execFileSync as jest.Mock).mockReturnValue(
        'Filesystem     1B-blocks         Used    Available Use% Mounted on\n' +
        '/dev/sda1      500000000000  250000000000  250000000000  50% /'
      );

      await diskMonitor['connect']();

      expect(fs.existsSync).toHaveBeenCalledWith('/');
      expect(diskMonitor['status']).toBe('connected');
    });

    it('should throw error when path does not exist', async () => {
      // Mock fs.existsSync to return false
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(diskMonitor['connect']()).rejects.toThrow('Path does not exist: /');
    });
  });

  describe('getDiskUsage', () => {
    it('should correctly parse df output', () => {
      // Mock fs.existsSync for df command
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // Mock df output
      (execFileSync as jest.Mock).mockReturnValue(
        'Filesystem     1B-blocks         Used    Available Use% Mounted on\n' +
        '/dev/sda1      1000000000000  700000000000  300000000000  70% /'
      );

      const usage = diskMonitor['getDiskUsage']('/');

      expect(usage).toEqual({
        total: 1000000000000,
        used: 700000000000,
        available: 300000000000,
        usedPercent: 70
      });
    });
  });

  describe('performHealthCheck', () => {
    beforeEach(() => {
      // Set status to connected
      diskMonitor['status'] = 'connected' as any;
    });

    it('should return healthy when disk usage is below threshold', async () => {
      // Mock fs.existsSync for df command
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // Mock df output for 70% usage (below 80% threshold)
      (execFileSync as jest.Mock).mockReturnValue(
        'Filesystem     1B-blocks         Used    Available Use% Mounted on\n' +
        '/dev/sda1      1000000000000  700000000000  300000000000  70% /'
      );

      const result = await diskMonitor['performHealthCheck']();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('Disk usage is within threshold');
      expect(mockNotifier.sendMessage).not.toHaveBeenCalled();
    });

    it('should return unhealthy and send alert when disk usage exceeds threshold', async () => {
      // Mock fs.existsSync for df command
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // Mock df output for 85% usage (above 80% threshold)
      (execFileSync as jest.Mock).mockReturnValue(
        'Filesystem     1B-blocks         Used    Available Use% Mounted on\n' +
        '/dev/sda1      1000000000000  850000000000  150000000000  85% /'
      );

      const result = await diskMonitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Disk usage exceeds threshold: 85.00% > 80%');
      expect(mockNotifier.sendMessage).toHaveBeenCalled();
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(diskMonitor['formatBytes'](1024)).toBe('1.00 KB');
      expect(diskMonitor['formatBytes'](1048576)).toBe('1.00 MB');
      expect(diskMonitor['formatBytes'](1073741824)).toBe('1.00 GB');
      expect(diskMonitor['formatBytes'](1099511627776)).toBe('1.00 TB');
    });
  });

  describe('getMillisecondsUntilNextHour', () => {
    it('should calculate correct milliseconds until next hour', () => {
      // Mock current time to 14:30:00
      const mockDate = new Date('2024-01-01T14:30:00');
      const originalDate = global.Date;

      // Mock Date constructor but preserve Date.now
      global.Date = jest.fn(() => mockDate) as any;
      global.Date.now = originalDate.now;

      const ms = diskMonitor['getMillisecondsUntilNextHour']();

      // Restore original Date
      global.Date = originalDate;

      // Should be 30 minutes (1800000 ms) until 15:00:00
      expect(ms).toBe(1800000);
    });
  });

  describe('startHealthCheck', () => {
    it('should schedule check at next hour', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      diskMonitor['status'] = 'connected' as any;
      diskMonitor['startHealthCheck']();

      // Verify timeout was set
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });
  });

  describe('getStartupMessage', () => {
    it('should generate correct startup message', () => {
      // Mock fs.existsSync for df command
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      (execFileSync as jest.Mock).mockReturnValue(
        'Filesystem     1B-blocks         Used    Available Use% Mounted on\n' +
        '/dev/sda1      1000000000000  700000000000  300000000000  70% /'
      );

      // Mock Date to avoid errors in getMillisecondsUntilNextHour
      const RealDate = Date;
      global.Date = jest.fn(() => new RealDate('2024-01-01T14:30:00')) as any;
      global.Date.now = RealDate.now;
      global.Date.parse = RealDate.parse;
      global.Date.UTC = RealDate.UTC;

      const message = diskMonitor['getStartupMessage']();

      // Restore Date
      global.Date = RealDate;

      expect(message).toContain('Monitoring disk path: /');
      expect(message).toContain('Current usage: 70.00%');
      expect(message).toContain('Alert threshold: 80%');
      expect(message).toContain('Check schedule: Top of each hour');
    });
  });
});