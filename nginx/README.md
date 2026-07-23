# Getting HTTPS working (one-time setup)

Nginx can't get its own certificate — Certbot does that. Because Certbot
proves domain ownership over plain HTTP, there's a chicken-and-egg problem:
Nginx needs a cert to serve HTTPS, but Certbot needs Nginx running (on plain
HTTP) to obtain that cert. Hence the two phases below.

Before starting: replace every `api.yamin.yourdomain.com` in `conf.d/default.conf`
and `conf.d/default.conf.https-template` with your real domain, and make sure
its DNS A record already points at this server's IP — Let's Encrypt will
fail if the domain doesn't resolve here yet.

## Phase 1 — get the first certificate

1. Start everything except you don't need to touch this step — `default.conf`
   is already the HTTP-only bootstrap version.
   ```
   docker compose up -d
   ```
2. Request the certificate (one-time; replace the email):
   ```
   docker compose run --rm certbot certonly \
     --webroot -w /var/www/certbot \
     -d api.yamin.yourdomain.com \
     --email you@example.com --agree-tos --no-eff-email
   ```
   If this succeeds, the certificate now lives in the `certbot_certs` volume,
   which Nginx already has mounted read-only.

## Phase 2 — switch Nginx to HTTPS

3. Replace the contents of `conf.d/default.conf` with
   `conf.d/default.conf.https-template` (same domain placeholder already
   filled in from phase 1).
4. Reload Nginx so it picks up the new config:
   ```
   docker compose restart nginx
   ```
5. Confirm `https://api.yamin.yourdomain.com/api/v1/health/ready` loads.

## After that

The `certbot` service in `docker-compose.yml` already runs `certbot renew`
every 12 hours in a loop — renewal is a no-op until the cert is within 30
days of expiring, so nothing else needs to be scheduled. This one manual
bootstrap is a one-time cost, not a recurring one.
