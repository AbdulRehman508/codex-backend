/**
 * pm2 process file — the no-Docker path (a Windows shop PC, or a plain VPS).
 *
 *   npm run build
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup      # restart with the machine
 *
 * Real values live in .env beside this file; nothing secret belongs here.
 */
module.exports = {
  apps: [
    {
      name: 'codex-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      // the stock guards are safe under concurrency, but a single instance
      // keeps the in-memory rate limiter honest. Move to Redis before cluster.
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true,
    },
  ],
};
