import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Single shared connection pool used across all routes.
// postgres() is safe to call at module load time — it creates a lazy pool.
const sql = postgres(process.env.DATABASE_URL, {
  max: 10,                  // max pool connections
  idle_timeout: 30,         // close idle connections after 30s
  connect_timeout: 10,      // fail fast if DB is unreachable
  transform: {
    // Return column names as-is (snake_case); routes map to camelCase explicitly.
    column: (col: string) => col,
  },
});

export default sql;