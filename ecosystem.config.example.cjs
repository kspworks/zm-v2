// pm2 config for the self-hosted deploy (see .gitlab-ci.yml). Copy it next
// to the deployed bundle's directory as ecosystem.config.cjs, and keep the
// production .env inside the bundle directory: the standalone server loads it
// at boot. Cluster mode with 2 processes: all shared state (rate limits,
// locks) lives in Postgres.
module.exports = {
  apps: [
    {
      name: "zm",
      cwd: `${__dirname}/zm`,
      script: "server.js",
      exec_mode: "cluster",
      instances: 2,
      env: { PORT: 3000, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
    },
  ],
};
