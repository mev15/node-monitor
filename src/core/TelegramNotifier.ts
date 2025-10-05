import TelegramBot from 'node-telegram-bot-api';
import { TelegramConfig } from '../types';

interface TelegramMessageOptions {
  parse_mode?: 'Markdown' | 'HTML';
  disable_notification?: boolean;
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
}

export class TelegramNotifier {
  private static instance: TelegramNotifier | null = null;
  private bot: TelegramBot;
  private config: TelegramConfig;

  private constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new TelegramBot(config.botToken, { polling: false });
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: TelegramConfig): TelegramNotifier {
    if (!TelegramNotifier.instance) {
      if (!config) {
        throw new Error('TelegramNotifier requires configuration on first initialization');
      }
      TelegramNotifier.instance = new TelegramNotifier(config);
    }
    return TelegramNotifier.instance;
  }

  /**
   * Send a message to the configured chat
   */
  async sendMessage(message: string, options?: TelegramMessageOptions): Promise<void> {
    try {
      await this.bot.sendMessage(this.config.chatId, message, options);
    } catch (error) {
      throw new Error(`Failed to send Telegram message: ${error}`);
    }
  }

  /**
   * Reset singleton instance (mainly for testing)
   */
  static resetInstance(): void {
    TelegramNotifier.instance = null;
  }
}