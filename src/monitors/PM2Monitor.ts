import { execFileSync } from 'child_process';
import { BaseMonitor } from '../core/BaseMonitor';
import { PM2Config, HealthCheckResult, MonitorStatus } from '../types';
import { Logger, ContextLogger } from '../core/Logger';
import { TelegramNotifier } from '../core/TelegramNotifier';

/**
 * PM2 进程信息接口
 */
interface PM2Process {
  name: string;
  pm_id: number;
  pid: number;
  pm2_env: {
    status: string;  // 'online' | 'stopped' | 'errored' | 'launching' | 'stopping'
    restart_time: number;
  };
}

/**
 * PM2Monitor - 监控 PM2 管理的所有进程健康状况
 *
 * 使用 `pm2 jlist` 命令获取进程状态，检测非 online 状态的进程并发送告警
 */
export class PM2Monitor extends BaseMonitor {
  private contextLogger: ContextLogger;
  private localIp: string;
  private processCount: number = 0;

  constructor(
    config: PM2Config,
    logger: Logger,
    notifier: TelegramNotifier
  ) {
    super(config, logger, notifier);
    this.contextLogger = logger.createChildLogger('PM2Monitor');
    this.localIp = this.getLocalIpv4() || 'Unknown';
  }

  /**
   * Connect - 验证 pm2 命令可用并获取初始进程列表
   */
  protected async connect(): Promise<void> {
    try {
      this.contextLogger.info('Verifying PM2 availability...');

      // 获取进程列表以验证 pm2 可用
      const processes = this.getPM2Processes();
      this.processCount = processes.length;

      this.status = MonitorStatus.CONNECTED;
      this.contextLogger.info(`PM2 connected successfully. Monitoring ${this.processCount} process(es)`);

      if (this.processCount > 0) {
        const processNames = processes.map(p => p.name).join(', ');
        this.contextLogger.info(`Processes: ${processNames}`);
      }

    } catch (error) {
      this.contextLogger.error('Failed to connect to PM2:', error);
      throw error;
    }
  }

  /**
   * 获取 PM2 进程列表
   */
  private getPM2Processes(): PM2Process[] {
    try {
      // 使用 execFileSync 安全执行命令，避免 shell 注入
      const output = execFileSync('pm2', ['jlist'], {
        encoding: 'utf8',
        timeout: 10000  // 10秒超时
      });

      // 验证输出
      if (!output || typeof output !== 'string') {
        throw new Error('Invalid pm2 output');
      }

      // 解析 JSON 输出
      const processes: PM2Process[] = JSON.parse(output);

      if (!Array.isArray(processes)) {
        throw new Error('PM2 output is not an array');
      }

      return processes;

    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Failed to parse PM2 output as JSON');
      }
      throw error;
    }
  }

  /**
   * 执行健康检查 - 检查所有进程状态
   */
  protected async performHealthCheck(): Promise<HealthCheckResult> {
    if (this.status !== MonitorStatus.CONNECTED) {
      return {
        healthy: false,
        message: 'PM2 monitor is not connected',
        details: { status: this.status }
      };
    }

    try {
      const processes = this.getPM2Processes();
      this.processCount = processes.length;

      // 检查是否有进程
      if (processes.length === 0) {
        this.contextLogger.info('No PM2 processes found');
        return {
          healthy: true,
          message: 'No PM2 processes to monitor',
          details: { processCount: 0 }
        };
      }

      // 找出不健康的进程（状态不是 online 且不是 launching）
      const unhealthyProcesses = processes.filter(p => {
        const status = p.pm2_env?.status;
        return status !== 'online' && status !== 'launching';
      });

      // 记录检查结果
      const onlineCount = processes.filter(p => p.pm2_env?.status === 'online').length;
      this.contextLogger.info(
        `PM2 health check: ${onlineCount}/${processes.length} processes online`
      );

      // 如果有不健康的进程，发送告警
      if (unhealthyProcesses.length > 0) {
        const alertMessage = this.buildAlertMessage(unhealthyProcesses);

        await this.sendAlert('Process Alert', alertMessage, {
          unhealthyCount: unhealthyProcesses.length,
          totalCount: processes.length
        });

        return {
          healthy: false,
          message: `${unhealthyProcesses.length} process(es) unhealthy`,
          details: {
            unhealthy: unhealthyProcesses.map(p => ({
              name: p.name,
              status: p.pm2_env?.status,
              restarts: p.pm2_env?.restart_time
            })),
            totalCount: processes.length
          }
        };
      }

      return {
        healthy: true,
        message: `All ${processes.length} process(es) are online`,
        details: {
          processCount: processes.length,
          processes: processes.map(p => ({
            name: p.name,
            status: p.pm2_env?.status,
            pid: p.pid
          }))
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.contextLogger.error('PM2 health check failed:', error);

      return {
        healthy: false,
        message: `PM2 health check failed: ${errorMessage}`,
        details: { error: errorMessage }
      };
    }
  }

  /**
   * 构建告警消息
   */
  private buildAlertMessage(unhealthyProcesses: PM2Process[]): string {
    const lines = [`Server: ${this.localIp}\n\nUnhealthy Processes:\n`];

    for (const proc of unhealthyProcesses) {
      const status = proc.pm2_env?.status || 'unknown';
      const restarts = proc.pm2_env?.restart_time || 0;
      const pid = proc.pid > 0 ? proc.pid : '-';

      lines.push(
        `\n${proc.name}`,
        `  Status: ${status}`,
        `  PID: ${pid}`,
        `  Restarts: ${restarts}`
      );
    }

    return lines.join('\n');
  }

  /**
   * 启动健康检查定时器
   */
  protected startHealthCheck(): void {
    const config = this.config as PM2Config;

    this.contextLogger.info(
      `Starting health check interval: every ${config.checkIntervalMs / 1000} seconds`
    );

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      const result = await this.performHealthCheck();

      if (!result.healthy && result.message) {
        this.contextLogger.warn(result.message);
      }
    }, config.checkIntervalMs);
  }

  /**
   * 断开连接 - 清理资源
   */
  protected async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.contextLogger.info('PM2 monitor disconnected');
  }

  /**
   * 获取启动消息
   */
  protected getStartupMessage(): string {
    const config = this.config as PM2Config;

    try {
      const processes = this.getPM2Processes();
      const onlineCount = processes.filter(p => p.pm2_env?.status === 'online').length;

      return `Server: ${this.localIp}\n` +
             `Processes: ${onlineCount}/${processes.length} online\n` +
             `Check Interval: ${config.checkIntervalMs / 1000}s`;
    } catch (error) {
      return `Server: ${this.localIp}\n` +
             `Check Interval: ${config.checkIntervalMs / 1000}s\n` +
             `Error: ${error instanceof Error ? error.message : error}`;
    }
  }
}
