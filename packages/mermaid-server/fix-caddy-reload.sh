#!/bin/bash
set -e
touch /var/log/caddy/chart-chem-dev.log
chown caddy:caddy /var/log/caddy/chart-chem-dev.log
caddy reload --config /etc/caddy/Caddyfile --force
echo "Caddy reloaded successfully"
