// Typed, namespaced access to env. Inject ConfigService and read via these keys.
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
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
  },
  upload: {
    maxBytes: 2 * 1024 * 1024, // 2 MB
  },
});
