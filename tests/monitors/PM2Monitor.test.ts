import { PM2Monitor } from '../../src/monitors/PM2Monitor';
import { PM2Config } from '../../src/types';
import { Logger } from '../../src/core/Logger';
import { TelegramNotifier } from '../../src/core/TelegramNotifier';
import { execFileSync } from 'child_process';

// Mock dependencies
jest.mock('child_process');
jest.mock('../../src/core/Logger');
jest.mock('../../src/core/TelegramNotifier');

describe('PM2Monitor', () => {
  let pm2Monitor: PM2Monitor;
  let mockConfig: PM2Config;
  let mockLogger: jest.Mocked<Logger>;
  let mockNotifier: jest.Mocked<TelegramNotifier>;

  // Sample PM2 process data
  const mockProcessesAllOnline = JSON.stringify([
    {
      name: 'app-server',
      pm_id: 0,
      pid: 1234,
      pm2_env: { status: 'online', restart_time: 0 }
    },
    {
      name: 'worker',
      pm_id: 1,
      pid: 1235,
      pm2_env: { status: 'online', restart_time: 2 }
    }
  ]);

  const mockProcessesWithErrored = JSON.stringify([
    {
      name: 'app-server',
      pm_id: 0,
      pid: 1234,
      pm2_env: { status: 'online', restart_time: 0 }
    },
    {
      name: 'worker',
      pm_id: 1,
      pid: 0,
      pm2_env: { status: 'errored', restart_time: 5 }
    }
  ]);

  const mockProcessesWithStopped = JSON.stringify([
    {
      name: 'app-server',
      pm_id: 0,
      pid: 0,
      pm2_env: { status: 'stopped', restart_time: 0 }
    }
  ]);

  const mockEmptyProcesses = JSON.stringify([]);

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup config
    mockConfig = {
      name: 'PM2',
      enabled: true,
      checkIntervalMs: 30000,
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
    pm2Monitor = new PM2Monitor(mockConfig, mockLogger, mockNotifier);
  });

  describe('connect', () => {
    it('should successfully connect when pm2 is available', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesAllOnline);

      await pm2Monitor['connect']();

      expect(execFileSync).toHaveBeenCalledWith('pm2', ['jlist'], expect.any(Object));
      expect(pm2Monitor['status']).toBe('connected');
      expect(pm2Monitor['processCount']).toBe(2);
    });

    it('should connect even with no processes', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockEmptyProcesses);

      await pm2Monitor['connect']();

      expect(pm2Monitor['status']).toBe('connected');
      expect(pm2Monitor['processCount']).toBe(0);
    });

    it('should throw error when pm2 command fails', async () => {
      (execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('pm2 command not found');
      });

      await expect(pm2Monitor['connect']()).rejects.toThrow('pm2 command not found');
    });

    it('should throw error when pm2 returns invalid JSON', async () => {
      (execFileSync as jest.Mock).mockReturnValue('invalid json');

      await expect(pm2Monitor['connect']()).rejects.toThrow('Failed to parse PM2 output as JSON');
    });
  });

  describe('getPM2Processes', () => {
    it('should parse pm2 jlist output correctly', () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesAllOnline);

      const processes = pm2Monitor['getPM2Processes']();

      expect(processes).toHaveLength(2);
      expect(processes[0].name).toBe('app-server');
      expect(processes[0].pm2_env.status).toBe('online');
      expect(processes[1].name).toBe('worker');
    });

    it('should throw error for non-array output', () => {
      (execFileSync as jest.Mock).mockReturnValue('{}');

      expect(() => pm2Monitor['getPM2Processes']()).toThrow('PM2 output is not an array');
    });
  });

  describe('performHealthCheck', () => {
    beforeEach(() => {
      pm2Monitor['status'] = 'connected' as any;
    });

    it('should return healthy when all processes are online', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesAllOnline);

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('All 2 process(es) are online');
      expect(mockNotifier.sendMessage).not.toHaveBeenCalled();
    });

    it('should return healthy when no processes exist', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockEmptyProcesses);

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('No PM2 processes to monitor');
    });

    it('should return unhealthy and send alert when process is errored', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesWithErrored);

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('1 process(es) unhealthy');
      expect(mockNotifier.sendMessage).toHaveBeenCalled();

      // Verify alert content includes process details
      const alertCall = mockNotifier.sendMessage.mock.calls[0][0];
      expect(alertCall).toContain('worker');
      expect(alertCall).toContain('errored');
    });

    it('should return unhealthy when process is stopped', async () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesWithStopped);

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.details?.unhealthy[0].status).toBe('stopped');
    });

    it('should not alert for launching processes', async () => {
      const mockLaunching = JSON.stringify([
        {
          name: 'app',
          pm_id: 0,
          pid: 0,
          pm2_env: { status: 'launching', restart_time: 0 }
        }
      ]);
      (execFileSync as jest.Mock).mockReturnValue(mockLaunching);

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(true);
      expect(mockNotifier.sendMessage).not.toHaveBeenCalled();
    });

    it('should return unhealthy when not connected', async () => {
      pm2Monitor['status'] = 'idle' as any;

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe('PM2 monitor is not connected');
    });

    it('should handle pm2 command failure during health check', async () => {
      (execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('pm2 connection lost');
      });

      const result = await pm2Monitor['performHealthCheck']();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('PM2 health check failed');
    });
  });

  describe('buildAlertMessage', () => {
    it('should build correct alert message', () => {
      const unhealthyProcesses = [
        {
          name: 'worker',
          pm_id: 1,
          pid: 0,
          pm2_env: { status: 'errored', restart_time: 5 }
        }
      ];

      const message = pm2Monitor['buildAlertMessage'](unhealthyProcesses);

      expect(message).toContain('Unhealthy Processes');
      expect(message).toContain('worker');
      expect(message).toContain('Status: errored');
      expect(message).toContain('PID: -');
      expect(message).toContain('Restarts: 5');
    });

    it('should handle multiple unhealthy processes', () => {
      const unhealthyProcesses = [
        {
          name: 'app',
          pm_id: 0,
          pid: 0,
          pm2_env: { status: 'stopped', restart_time: 0 }
        },
        {
          name: 'worker',
          pm_id: 1,
          pid: 0,
          pm2_env: { status: 'errored', restart_time: 3 }
        }
      ];

      const message = pm2Monitor['buildAlertMessage'](unhealthyProcesses);

      expect(message).toContain('app');
      expect(message).toContain('worker');
      expect(message).toContain('stopped');
      expect(message).toContain('errored');
    });
  });

  describe('startHealthCheck', () => {
    it('should set up interval for health checks', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      pm2Monitor['status'] = 'connected' as any;
      pm2Monitor['startHealthCheck']();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        mockConfig.checkIntervalMs
      );

      setIntervalSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should clear health check interval', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      // Set up an interval first
      pm2Monitor['healthCheckInterval'] = setInterval(() => {}, 1000);

      await pm2Monitor['disconnect']();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(pm2Monitor['healthCheckInterval']).toBeNull();

      clearIntervalSpy.mockRestore();
    });
  });

  describe('getStartupMessage', () => {
    it('should generate correct startup message with processes', () => {
      (execFileSync as jest.Mock).mockReturnValue(mockProcessesAllOnline);

      const message = pm2Monitor['getStartupMessage']();

      expect(message).toContain('Processes: 2/2 online');
      expect(message).toContain('Check Interval: 30s');
      // Should NOT contain individual process names (simplified message)
      expect(message).not.toContain('app-server');
    });

    it('should handle no processes', () => {
      (execFileSync as jest.Mock).mockReturnValue(mockEmptyProcesses);

      const message = pm2Monitor['getStartupMessage']();

      expect(message).toContain('Processes: 0/0 online');
      expect(message).toContain('Check Interval: 30s');
    });

    it('should handle pm2 error gracefully', () => {
      (execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('pm2 not available');
      });

      const message = pm2Monitor['getStartupMessage']();

      expect(message).toContain('Error getting PM2 status');
    });
  });
});
