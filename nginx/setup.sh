#!/bin/sh
# Renders the live nginx config from the tracked templates, and obtains the
# first TLS certificate when a domain is given. Idempotent — the deploy
# pipeline runs it on every deploy, which is exactly what makes HTTPS survive
# a `git pull` (the rendered conf.d/ is gitignored; this script is the only
# thing that writes it).
#
# Usage:
#   ./setup.sh                 HTTP-only, answers on any hostname/IP
#   ./setup.sh yamin.example.com
#                              HTTPS if a cert already exists; otherwise
#                              renders HTTP, obtains the cert via certbot,
#                              then switches to HTTPS. Set CERTBOT_EMAIL the
#                              first time.
set -eu
cd "$(dirname "$0")"

DOMAIN="${1:-}"
mkdir -p conf.d certbot/www certbot/conf

render() {
    # $1 = template file, $2 = server_name value
    sed "s/\${SERVER_NAME}/$2/g" "templates/$1" > conf.d/default.conf
    cp templates/app-locations.include conf.d/app-locations.include
}

reload_nginx() {
    # Reload if nginx is already up; otherwise the next `compose up` reads the
    # fresh config anyway.
    #
    # -T and </dev/null are both load-bearing. This script is normally invoked
    # from a `ssh host 'bash -s' <<'EOF'` heredoc, where STDIN *is* the rest of
    # the deploy script. `docker compose exec` claims STDIN by default, so it
    # swallowed every remaining line — the build and restart steps silently
    # never ran, and the deploy still exited 0 and reported success.
    docker compose -f ../docker-compose.yml exec -T nginx nginx -s reload </dev/null 2>/dev/null \
        || echo "nginx not running yet — config will be picked up on next start"
}

if [ -z "$DOMAIN" ]; then
    render http.conf.template "_"
    echo "Rendered HTTP-only config (IP mode). No TLS — fine for a demo, not for real users."
    reload_nginx
    exit 0
fi

if [ -d "certbot/conf/live/$DOMAIN" ]; then
    render https.conf.template "$DOMAIN"
    echo "Certificate for $DOMAIN present — rendered HTTPS config."
    reload_nginx
    exit 0
fi

# No cert yet: serve HTTP so Let's Encrypt can reach the ACME webroot,
# request the cert, then switch to HTTPS.
: "${CERTBOT_EMAIL:?First run for $DOMAIN needs CERTBOT_EMAIL=you@example.com}"
render http.conf.template "$DOMAIN"
docker compose -f ../docker-compose.yml up -d nginx </dev/null
# --rm certbot would likewise inherit and consume the caller's STDIN.
docker compose -f ../docker-compose.yml run --rm -T certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email </dev/null
render https.conf.template "$DOMAIN"
reload_nginx
echo "HTTPS enabled for $DOMAIN."
