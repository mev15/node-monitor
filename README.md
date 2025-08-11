# Ethereum Node Monitor

A simple and efficient Ethereum node monitoring tool with real-time Telegram bot alerts for node anomalies.

## Features

- 🔍 **Real-time Monitoring**: WebSocket connection to monitor Ethereum node new blocks
- ⏱️ **Timeout Detection**: Auto-alert when no new blocks received for over 1 minute
- 🔄 **Auto-reconnect**: Automatic reconnection attempts when connection is lost
- 📱 **Telegram Notifications**: Immediate Telegram alerts for anomalies
- 🛑 **Auto-exit**: Process exits automatically after sending alerts
- ✅ **Startup Notification**: Sends Telegram notification when monitoring starts
- 🌐 **Smart IP Conversion**: Automatically converts local node addresses to actual IPv4 addresses

## Quick Start

### Requirements

- Node.js >= 18.0.0
- npm >= 8.0.0
- PM2 (for production deployment)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd node-monitor

# Install dependencies
npm install

# Create environment configuration
cp .env.example .env
```

### Configuration

Edit the `.env` file:

```bash
# Ethereum WebSocket URL
ETHEREUM_WS_URL=ws://localhost:8548

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Monitoring Settings (optional)
BLOCK_TIMEOUT_SECONDS=60        # Block timeout in seconds
MAX_RECONNECT_ATTEMPTS=3        # Maximum reconnection attempts
RECONNECT_DELAY_MS=5000         # Reconnection delay in milliseconds
```

### Development Mode

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Run tests with watch mode
npm run test:watch
```

### Production Deployment

#### 1. Build the Project

```bash
npm run build
```

#### 2. Deploy with PM2

```bash
# Install PM2
npm install -g pm2

# Start the service
pm2 start ecosystem.config.js

# Check status
pm2 status eth-node-monitor

# View logs
pm2 logs eth-node-monitor

# Stop the service
pm2 stop eth-node-monitor

# Restart the service
pm2 restart eth-node-monitor

# Delete the service
pm2 delete eth-node-monitor
```

#### 3. Set up Auto-start on Boot

```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save
```

## Project Structure

```
node-monitor/
├── src/
│   ├── index.ts       # Main entry point
│   └── config.ts      # Configuration loader
├── tests/
│   └── monitor.test.ts # Unit tests
├── logs/              # Log files directory
├── dist/              # Compiled output directory
├── .env.example       # Environment variables example
├── ecosystem.config.js # PM2 configuration
├── package.json       # Project configuration
├── tsconfig.json      # TypeScript configuration
└── jest.config.js     # Jest test configuration
```

## Monitoring Logic

1. **Start Monitoring**: Connect to Ethereum WebSocket node, send startup notification
2. **Subscribe to Blocks**: Listen for new block events, update last block time
3. **Timeout Detection**: Check every 5 seconds for timeout
4. **Error Handling**:
   - Connection lost: Attempt reconnection, alert and exit after max attempts
   - Block timeout: Alert and exit when no new blocks received within timeout period
5. **Telegram Alerts**: Send detailed error information to specified group
6. **Graceful Shutdown**: Clean up resources before exit

### Special Features

- **Local IP Auto-replacement**: When node address is localhost or 127.0.0.1, automatically gets the machine's IPv4 address and displays the actual accessible address in notifications
- **Startup Confirmation**: Sends Telegram notification with configuration details when monitoring starts to confirm normal operation

## Alert Types

### 1. Connection Lost
- Trigger: WebSocket connection lost and reconnection failed
- Alert content: Connection failure details, retry count, node address

### 2. Block Timeout
- Trigger: No new blocks received within configured timeout
- Alert content: Timeout duration, last block time, node address

## Logging

Log files are located in the `logs/` directory:

- `pm2-out.log`: Standard output logs
- `pm2-error.log`: Error logs
- `pm2-combined.log`: Combined logs
- `error.log`: Application error logs
- `combined.log`: Application combined logs

## Troubleshooting

### 1. Cannot Connect to Node
- Check if `ETHEREUM_WS_URL` is correct
- Confirm node is running and WebSocket port is open
- Check network connectivity

### 2. Telegram Notification Failure
- Verify `TELEGRAM_BOT_TOKEN` is valid
- Confirm `TELEGRAM_CHAT_ID` is correct
- Check if bot has joined the group

### 3. Process Exits Abnormally
- View PM2 logs: `pm2 logs eth-node-monitor`
- Check memory usage: `pm2 monit`
- Check error logs: `logs/pm2-error.log`

## Performance Optimization

- Memory limit: 500MB (adjustable in `ecosystem.config.js`)
- Auto-restart: Automatic restart on memory limit or abnormal exit
- Exponential backoff: Increasing delay on restart failures

## Security Recommendations

1. Never hardcode sensitive information in code
2. Use environment variables for configuration management
3. Regularly update dependencies
4. Limit log file size and configure log rotation

## License

MIT