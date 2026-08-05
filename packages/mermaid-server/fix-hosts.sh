#!/bin/bash
set -e
sed -i '/chart\.chem\.dev/d' /etc/hosts
echo "Removed chart.chem.dev from /etc/hosts (public DNS via Cloudflare will route traffic)"
