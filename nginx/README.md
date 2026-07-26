# nginx layout

The live config (`conf.d/`) is **rendered, never edited by hand, and never
committed**. `setup.sh` writes it from the tracked files in `templates/`.
That is what fixes the old failure mode where switching to HTTPS meant
overwriting a tracked file on the server — which the next `git pull`
silently reverted back to plain HTTP.

```
templates/http.conf.template    HTTP-only (IP mode / pre-certificate)
templates/https.conf.template   TLS termination + HTTP->HTTPS redirect
templates/app-locations.include shared routing, rate limits, upload size
setup.sh                        renders conf.d/ and bootstraps the first cert
conf.d/                         rendered output (gitignored)
certbot/                        Let's Encrypt state + ACME webroot (gitignored)
```

One origin serves everything: the web app at `/`, the API at `/api`,
socket.io at `/socket.io`. Because page and API share an origin, browser
CORS is a non-issue for the web build.

## No domain yet (serve by EC2 IP)

```sh
./setup.sh
docker compose up -d
```

Plain HTTP. Fine for a demo; the Android APK then needs
`usesCleartextTraffic: true` (already set) and `EXPO_PUBLIC_API_URL=http://<EC2-IP>`.

## With a domain (recommended)

Point the domain's A record at the server first, then:

```sh
CERTBOT_EMAIL=you@example.com ./setup.sh yamin.example.com
docker compose up -d
```

On the first run this renders HTTP, obtains the certificate through the ACME
webroot, switches the config to HTTPS, and reloads nginx. On every later run
(the deploy pipeline calls it each deploy) it detects the existing
certificate and simply re-renders the HTTPS config — idempotent by design.

Renewals: the `certbot` service in docker-compose.yml already loops
`certbot renew` every 12h; nothing to schedule.

## What the rendered config enforces

- `client_max_body_size 50m` — voice uploads; nginx's 1 MB default used to
  413 every real recording.
- Per-IP rate limits: 10 req/s (burst 30) on `/api/`, 10 req/min (burst 5)
  on `/api/v1/auth/` — brute-forcing logins gets a 429 long before the
  backend sees it.
- WebSocket upgrade headers only on `/socket.io/`, driven by a
  `map $http_upgrade` block instead of being forced on every request.
- On HTTPS: TLS 1.2/1.3 only, HSTS, nosniff, frame-deny, referrer policy.
