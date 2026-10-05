// ecosystem.config.cjs – PM2 configuration for aiSupport
module.exports = {
  apps: [
    {
      name: 'ai-support-bot',
      script: 'index.js',
      node_args: '--disable-warning=ExperimentalWarning',
      instances: 1, // Telegram Bot long-polling va UserBot uchun faqat 1 ta instance bo'lishi shart!
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 15,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: '300M',
      time: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODEJS_VERSION: '22',
      },
    },
  ],
};
