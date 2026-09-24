// PM2 process definition — Zoclo API on the self-hosted VM.
//
// ⚠️ FORK MODE, NOT CLUSTER — this is a correctness decision, not a perf one:
// the app's event bus (config/bus.ts), TTL caches (config/cache.ts) and
// Socket.IO rooms are all IN-PROCESS. `exec_mode: "cluster"` would run N
// workers where a message emitted in worker A never reaches a socket in
// worker B, likes/matches notifications randomly vanish, and unread counts
// disagree between workers. Scale-out requires @socket.io/redis-adapter +
// a shared (Redis) cache FIRST — see SCALING.md §capacity ladder (~10k).
//
// Memory ceiling: 12GB VM, Postgres+Redis share it. 1500MB restart guards
// against a months-long slow leak degrading the app silently.
//
// Idempotent deploy: `pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env`
module.exports = {
  apps: [
    {
      name: 'zoclo-api',
      cwd: '/opt/zoclo/server',
      script: 'dist/server.js',
      exec_mode: 'fork',           // NEVER 'cluster' without redis-adapter (see above)
      instances: 1,
      max_memory_restart: '1500M',
      // Zero-downtime reload: `pm2 reload zoclo-api` (NOT restart) — new
      // process boots before the old one dies, in-flight requests finish.
      kill_timeout: 10000,         // matches the app's own graceful-shutdown window
      wait_ready: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      // Secrets/pool config come from /opt/zoclo/server/.env (dotenv).
      // Required there for the self-hosted stack:
      //   DATABASE_URL, DIRECT_URL, JWT_SECRET, JWT_REFRESH_SECRET,
      //   CLIENT_URL, STORAGE_DRIVER=r2 + R2_* vars,
      //   DATABASE_PGBOUNCER=0, DATABASE_HEARTBEAT_SEC=0,
      //   DATABASE_CONNECTION_LIMIT=10 (self-hosted: no 15-session ceiling)
    },
  ],
};
