module.exports = {
  apps: [
    {
      name: 'mermaid-server',
      // Pinned to the nvm Node 22 runtime rather than the host default (v20.20.2).
      // The system Node is shared with every other PM2 app on this box, so it is not
      // ours to bump; this keeps the change scoped to the service that needs it.
      interpreter: process.env.HOME + '/.nvm/versions/node/v22.23.2/bin/node',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: '/home/jgatlit/apps/mermaid/mermaid/packages/mermaid-server',
      env: {
        PORT: 3001,
        HOST: '0.0.0.0',
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
