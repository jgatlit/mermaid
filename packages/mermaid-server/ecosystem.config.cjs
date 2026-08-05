module.exports = {
  apps: [
    {
      name: 'mermaid-server',
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
