import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseMonitor } from '../core/BaseMonitor';
import { DiskConfig, HealthCheckResult, MonitorStatus } from '../types';
import { Logger, ContextLogger } from '../core/Logger';
import { TelegramNotifier } from '../core/TelegramNotifier';

interface DiskUsage {
  total: number;      // Total space in bytes
  used: number;       // Used space in bytes
  available: number;  // Available space in bytes
  usedPercent: number; // Used percentage (0-100)
}

export class DiskMonitor extends BaseMonitor {
  private contextLogger: ContextLogger;
  private nextCheckTimeout: NodeJS.Timeout | null = null;
  private localIp: string;

  constructor(
    config: DiskConfig,
    logger: Logger,
    notifier: TelegramNotifier
  ) {
    super(config, logger, notifier);
    this.contextLogger = logger.createChildLogger('DiskMonitor');
    this.localIp = this.getLocalIpv4() || 'Unknown';
  }

  /**
   * Get local IPv4 address
   */
  private getLocalIpv4(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) {
            return addr.address;
          }
        }
      }
    }
    return null;
  }

  /**
   * Connect - Verify path exists and is accessible
   */
  protected async connect(): Promise<void> {
    const config = this.config as DiskConfig;

    try {
      this.contextLogger.info(`Verifying disk path: ${config.path}`);

      // Check if path exists
      if (!fs.existsSync(config.path)) {
        throw new Error(`Path does not exist: ${config.path}`);
      }

      // Try to get disk usage to verify access
      const usage = this.getDiskUsage(config.path);

      this.status = MonitorStatus.CONNECTED;
      this.contextLogger.info(`Successfully verified disk path: ${config.path}`);
      this.contextLogger.info(`Current disk usage: ${usage.usedPercent.toFixed(2)}% (${this.formatBytes(usage.used)} / ${this.formatBytes(usage.total)})`);

    } catch (error) {
      this.contextLogger.error('Failed to verify disk path:', error);
      // 硬盘监控不需要重连机制，直接抛出错误
      throw error;
    }
  }

  /**
   * Validate path against whitelist to prevent path traversal
   */
  private validatePath(diskPath: string): void {
    // 白名单路径 - 只允许监控这些路径及其子路径
    const ALLOWED_PATHS = ['/', '/data', '/var', '/home', '/tmp', '/opt', '/usr', '/mnt'];

    // 规范化路径，去除 .. 和 . 等
    const normalizedPath = path.normalize(diskPath);

    // 检查路径是否包含危险字符
    if (normalizedPath !== diskPath || diskPath.includes('..')) {
      throw new Error(`Invalid path format: ${diskPath}`);
    }

    // 检查路径是否在白名单中
    const isAllowed = ALLOWED_PATHS.some(allowed =>
      normalizedPath === allowed || normalizedPath.startsWith(allowed + '/')
    );

    if (!isAllowed) {
      throw new Error(`Path not in whitelist. Allowed paths: ${ALLOWED_PATHS.join(', ')}`);
    }
  }

  /**
   * Get disk usage for a path using df command
   */
  private getDiskUsage(diskPath: string): DiskUsage {
    try {
      // 验证路径安全性
      this.validatePath(diskPath);

      // 使用绝对路径调用 df 命令，避免命令替换攻击
      const DF_PATH = '/bin/df';

      // 检查 df 命令是否存在
      if (!fs.existsSync(DF_PATH)) {
        throw new Error('df command not found at /bin/df');
      }

      // 使用 execFileSync 避免 shell 注入，-B1 设置块大小为 1 字节
      const output = execFileSync(DF_PATH, ['-B1', diskPath], {
        encoding: 'utf8',
        timeout: 5000  // 5秒超时，防止挂起
      });

      // 验证输出格式
      if (!output || typeof output !== 'string') {
        throw new Error('Invalid df output');
      }

      // Parse df output
      // Format: Filesystem 1B-blocks Used Available Use% Mounted
      const lines = output.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('Unexpected df output format');
      }

      // 验证第一行包含预期的标题
      if (!lines[0].includes('Filesystem') || !lines[0].includes('blocks')) {
        throw new Error('Invalid df output header');
      }

      const parts = lines[1].split(/\s+/);
      if (parts.length < 5) {
        throw new Error('Unexpected df output format');
      }

      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const available = parseInt(parts[3], 10);
      const usedPercentStr = parts[4].replace('%', '');
      const usedPercent = parseFloat(usedPercentStr);

      // 验证解析的值是否合理
      if (isNaN(total) || isNaN(used) || isNaN(available) || isNaN(usedPercent)) {
        throw new Error('Failed to parse disk usage values');
      }

      if (total <= 0 || used < 0 || available < 0 || usedPercent < 0 || usedPercent > 100) {
        throw new Error('Invalid disk usage values');
      }

      return {
        total,
        used,
        available,
        usedPercent
      };

    } catch (error) {
      this.contextLogger.error('Failed to get disk usage:', error);
      throw error;
    }
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Perform health check - Check disk usage against threshold
   */
  protected async performHealthCheck(): Promise<HealthCheckResult> {
    const config = this.config as DiskConfig;

    if (this.status !== MonitorStatus.CONNECTED) {
      return {
        healthy: false,
        message: 'Disk monitor is not connected',
        details: {
          status: this.status
        }
      };
    }

    try {
      const usage = this.getDiskUsage(config.path);

      this.contextLogger.info(
        `Disk usage check: ${usage.usedPercent.toFixed(2)}% ` +
        `(${this.formatBytes(usage.used)} / ${this.formatBytes(usage.total)}) ` +
        `on ${config.path}`
      );

      // Check if usage exceeds threshold
      if (usage.usedPercent > config.thresholdPercent) {
        const message = `Server: ${this.localIp}\nPath: ${config.path}\nUsage: ${usage.usedPercent.toFixed(1)}% exceeds threshold ${config.thresholdPercent}%`;

        await this.sendAlert(
          'Disk Usage Alert',
          message,
          {
            used: `${this.formatBytes(usage.used)} / ${this.formatBytes(usage.total)}`
          }
        );

        return {
          healthy: false,
          message,
          details: {
            path: config.path,
            usedPercent: usage.usedPercent,
            threshold: config.thresholdPercent,
            used: usage.used,
            total: usage.total,
            available: usage.available
          }
        };
      }

      return {
        healthy: true,
        message: 'Disk usage is within threshold',
        details: {
          path: config.path,
          usedPercent: usage.usedPercent,
          threshold: config.thresholdPercent,
          used: usage.used,
          total: usage.total,
          available: usage.available
        }
      };

    } catch (error) {
      return {
        healthy: false,
        message: `Disk health check failed: ${error}`,
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Calculate milliseconds until next hour
   */
  private getMillisecondsUntilNextHour(): number {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return nextHour.getTime() - now.getTime();
  }

  /**
   * Start health check - Schedule checks at the top of each hour
   */
  protected startHealthCheck(): void {
    const scheduleNextCheck = () => {
      if (this.isShuttingDown) return;

      const delay = this.getMillisecondsUntilNextHour();
      const nextCheckTime = new Date(Date.now() + delay);

      this.contextLogger.info(
        `Next disk check scheduled at ${nextCheckTime.toLocaleString()} ` +
        `(in ${Math.round(delay / 1000 / 60)} minutes)`
      );

      this.nextCheckTimeout = setTimeout(async () => {
        if (this.isShuttingDown) return;

        this.contextLogger.info('Performing hourly disk check...');
        const result = await this.performHealthCheck();

        if (!result.healthy && result.message) {
          this.contextLogger.warn(result.message);
        }

        // Schedule next check
        scheduleNextCheck();
      }, delay);
    };

    // Start the scheduling
    scheduleNextCheck();
  }

  /**
   * Disconnect - Clean up resources
   */
  protected async disconnect(): Promise<void> {
    if (this.nextCheckTimeout) {
      clearTimeout(this.nextCheckTimeout);
      this.nextCheckTimeout = null;
    }
    this.contextLogger.info('Disk monitor disconnected');
  }

  /**
   * Get startup message with current disk status
   */
  protected getStartupMessage(): string {
    const config = this.config as DiskConfig;

    try {
      const usage = this.getDiskUsage(config.path);
      const isOverThreshold = usage.usedPercent >= config.thresholdPercent;

      return `Server: ${this.localIp}\n` +
             `Path: ${config.path}\n` +
             `Usage: ${usage.usedPercent.toFixed(1)}% (${this.formatBytes(usage.used)} / ${this.formatBytes(usage.total)})\n` +
             `${isOverThreshold ? `⚠️ Exceeds threshold: ${config.thresholdPercent}%` : `Threshold: ${config.thresholdPercent}%`}`;
    } catch (error) {
      return `Server: ${this.localIp}\n` +
             `Path: ${config.path}\n` +
             `Threshold: ${config.thresholdPercent}%\n` +
             `Error getting disk status: ${error}`;
    }
  }
}
