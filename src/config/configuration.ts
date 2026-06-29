// Typed, namespaced access to env. Inject ConfigService and read via these keys.
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  // frontend origin used to build reset-password links
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN, // comma-separated list; undefined = allow all
  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: process.env.DATABASE_PORT ?? '27017',
    name: process.env.DATABASE_NAME ?? 'codex',
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET as string,
    expires: process.env.JWT_EXPIRES ?? '1d',
    rememberExpires: process.env.JWT_REMEMBER_EXPIRES ?? '30d',
  },
  upload: {
    maxBytes: 2 * 1024 * 1024, // 2 MB
  },
});
