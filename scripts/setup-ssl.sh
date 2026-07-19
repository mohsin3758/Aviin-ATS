#!/usr/bin/env bash
# Run ONCE on the VPS to get Let's Encrypt SSL cert
# Usage: bash scripts/setup-ssl.sh ats.yourdomain.com admin@yourdomain.com
set -e
DOMAIN=${1:?Usage: setup-ssl.sh DOMAIN EMAIL}
EMAIL=${2:?Usage: setup-ssl.sh DOMAIN EMAIL}
apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true
certbot certonly --standalone -d "$DOMAIN" --email "$EMAIL"   --agree-tos --non-interactive --redirect
echo "Cert obtained for $DOMAIN"
echo "Now update nginx/nginx.prod.conf — replace YOUR_DOMAIN with $DOMAIN"
echo "Then: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
# Auto-renew cron
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker exec airecruit_nginx nginx -s reload") | crontab -
echo "Auto-renew cron added."
