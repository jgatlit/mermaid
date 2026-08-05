#!/bin/bash
set -e
sed -i '/^chart.aichemist.agency {/a\\ttls internal' /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile 2>&1 | grep -E '(Valid|ERROR)'
systemctl reload caddy
echo "Done: added tls internal to chart.aichemist.agency"
