#!/bin/bash
set -e

# Remove old chart.aichemist.agency entries
sed -i '/chart\.aichemist\.agency/d' /etc/hosts
# Remove the old Caddy block (chart.aichemist.agency)
sed -i '/^# =.*$/N;/chart\.aichemist\.agency/,/^}$/d' /etc/caddy/Caddyfile

# Add chart.chem.dev to /etc/hosts
grep -q 'chart.chem.dev' /etc/hosts || echo '127.0.1.1	chart.chem.dev	chart' >> /etc/hosts

# Append chart.chem.dev Caddy block
cat >> /etc/caddy/Caddyfile << 'CADDY'

# ========================================
# chart.chem.dev - Mermaid Server API
# ========================================
chart.chem.dev {
	encode zstd gzip

	reverse_proxy localhost:3001 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Proto https
	}

	header {
		-Server
		Strict-Transport-Security "max-age=31536000;"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
	}

	log {
		output file /var/log/caddy/chart-chem-dev.log {
			roll_size 10mb
			roll_keep 5
		}
		format json
	}
}
CADDY

# Validate and reload
caddy validate --config /etc/caddy/Caddyfile 2>&1 | grep -E '(Valid|ERROR)'
systemctl reload caddy

echo "Done: chart.chem.dev -> localhost:3001"
