#!/bin/bash
# FinStack Staffing OS — SSL Certificate Initializer (Let's Encrypt)
# Run ONCE before starting docker-compose.prod.yml
# Requires: domain DNS pointing to this VPS, port 80 reachable
#
# Usage: bash scripts/ssl-init.sh <your-domain> <your-email>

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: bash scripts/ssl-init.sh <domain> <email>"
  echo "Example: bash scripts/ssl-init.sh ats.yourcompany.com admin@yourcompany.com"
  echo ""
  echo "IMPORTANT: Do NOT use finstack.aviinjobs.com — that may belong to an unrelated product."
  exit 1
fi

echo "=== FinStack P14: SSL Init for $DOMAIN ==="
echo ""

# Create the certbot directories
mkdir -p nginx/letsencrypt/lib nginx/letsencrypt/www

# Download recommended TLS params if not already present
if [[ ! -f "nginx/letsencrypt/lib/options-ssl-nginx.conf" ]]; then
  echo "[1/3] Downloading recommended TLS params..."
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    -o nginx/letsencrypt/lib/options-ssl-nginx.conf
  openssl dhparam -out nginx/letsencrypt/lib/ssl-dhparams.pem 2048 2>/dev/null
  echo "  Done."
fi

# Generate nginx config from template
echo "[2/3] Generating nginx config for $DOMAIN..."
sed "s/\${DOMAIN}/$DOMAIN/g" nginx/nginx.conf.template > nginx/nginx.conf
echo "  Written to nginx/nginx.conf"

# Start nginx with HTTP only (no SSL yet — need to get cert first)
echo "[3/3] Starting nginx for ACME challenge..."
cat > /tmp/nginx-init.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / { return 200 'ok'; add_header Content-Type text/plain; }
}
EOF

# Run certbot to get certificate
sg docker -c "docker run --rm \
  -v $(pwd)/nginx/letsencrypt/lib:/etc/letsencrypt \
  -v $(pwd)/nginx/letsencrypt/www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot:latest certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email '$EMAIL' \
  -d '$DOMAIN' \
  -d 'www.$DOMAIN'" || {
    echo ""
    echo "WARNING: certbot failed. Check that:"
    echo "  1. DNS for $DOMAIN points to this VPS ($(curl -s ifconfig.me))"
    echo "  2. Port 80 is open (check VPS firewall/security group)"
    echo "  3. No other service is using port 80"
    echo ""
    echo "If you can't get a real cert, a self-signed cert can be used for testing:"
    echo "  openssl req -x509 -nodes -newkey rsa:4096 -days 365"
    echo "    -keyout nginx/letsencrypt/lib/live/$DOMAIN/privkey.pem"
    echo "    -out nginx/letsencrypt/lib/live/$DOMAIN/fullchain.pem"
    exit 1
}

echo ""
echo "=== SSL certificates obtained for $DOMAIN ==="
echo "Next: run 'bash scripts/deploy-prod.sh' to start all services"
