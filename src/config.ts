import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  ethereum: {
    wsUrl: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  monitoring: {
    blockTimeoutSeconds: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
  };
}

export function loadConfig(): Config {
  const wsUrl = process.env.ETHEREUM_WS_URL;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!wsUrl) {
    throw new Error('ETHEREUM_WS_URL is required');
  }
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID is required');
  }

  return {
    ethereum: {
      wsUrl,
    },
    telegram: {
      botToken,
      chatId,
    },
    monitoring: {
      blockTimeoutSeconds: parseInt(process.env.BLOCK_TIMEOUT_SECONDS || '60', 10),
      maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '3', 10),
      reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
    },
  };
}