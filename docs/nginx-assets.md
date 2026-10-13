# nginx asset delivery

The 6G showcase can load its entire dataset from nginx without player changes. A
manifest-relative dynamic frame, static Streamed SOG tree, mesh or audio URL resolves on
the manifest's origin. The explainer has its own configurable asset-index URL.

The supplied configuration serves files directly, enables anonymous CORS and byte
ranges, uses HTTP/1.1, and returns 404 for missing files. Browser caches revalidate on
reload. The player's in-memory compressed cache still operates normally; start a fresh
player session when comparing network delivery.

## Logging

Per-request access logging is disabled by default with
[`access_log off`](https://nginx.org/en/docs/http/ngx_http_log_module.html#access_log).
Warnings and errors remain enabled: Docker sends them to stderr, and the native Windows
launcher writes them to `.nginx/runtime/logs/error.log`. The RAM-cache origin also
disables access logging so cache misses do not produce duplicate lines.

This removes request-log formatting and writes from the streaming path. The throughput
benefit has not been measured; do not assume logging accounts for the transfer delays.
Existing Docker log history remains visible, but successful requests add no new lines.

For temporary request diagnostics, change the HTTP-level `access_log off;` in
`config/nginx/assets.conf.template` to `access_log /dev/stdout assets;` for Docker, or
`access_log logs/access.log assets;` for native Windows. Recreate the Docker service
with the same Compose files, or reload the native launcher. Docker recreation clears the
RAM cache, so prewarm it again before a run. Restore `access_log off;` afterwards.

## Shared RAM cache for multi-device runs

Use this mode when the serving machine should minimise its contribution to download
latency. It caches binary responses once in Linux RAM and shares them across clients,
bypassing the Windows filesystem bridge on a hit. Each device still receives the
response over HTTPS. Enable it with both Compose files:

```powershell
docker compose --env-file config/nginx/.env -f config/nginx/compose.yaml -f config/nginx/compose.ram-cache.yaml up -d --force-recreate assets
```

The defaults are 5 GiB of cached responses, a 6 GiB tmpfs for cached and in-flight
files, and a 7 GiB container memory limit. The matching memory-plus-swap limit disables
container swap. Startup validates the tmpfs and available Linux/cgroup memory before
nginx starts. The maximum cache size is enforced by nginx's asynchronous cache manager;
the tmpfs is the hard filesystem bound. Memory is allocated as files are requested. See
[Docker memory limits](https://docs.docker.com/engine/containers/resource_constraints/)
and
[nginx cache configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_path).

The RAM profile uses multiple nginx workers. Cache locking coalesces simultaneous
requests for the same missing file into one origin fetch. JSON indexes bypass this cache
so manifests and LOD metadata remain refreshable. Binary cache entries are fresh for 24
hours; **freeze binary files during a run and recreate the service after any dataset
replacement**. Browser `no-cache` does not invalidate the server cache. Recreation
empties the RAM cache. Existing source files are mounted read-only.

Prewarm the selected tiers **before** starting the devices. Otherwise, the first request
still reads the source and other clients can wait for cache-lock release. From
PowerShell 7 in the repository root:

```powershell
pwsh -File scripts/warm-nginx-assets.ps1
```

This defaults to all preview and minimum dynamic frames, plus non-JSON static, audio and
explainer assets. It uses the local HTTP listener so warm-up traffic does not traverse
the device network. Warm URLs are identical to playback URLs, with no cache-busting
query parameters. To warm only medium dynamic frames instead:

```powershell
pwsh -File scripts/warm-nginx-assets.ps1 -Tiers medium
```

The helper checks the selected byte total against 95% of the cache budget, keeps six
requests in flight, reports progress, and fails if the server is not in RAM-cache mode.
Use `-PublicDirectory` if the source directory differs from the default, `-BaseUrl` if
the local HTTP port differs, and `-MaximumCacheBytes` to match a changed server budget.
`-MaximumFrames` limits each tier for a short validation run; omit it to warm the whole
selected sequence. A working set larger than the cache cannot stay fully resident.

Configuration overrides belong in `config/nginx/.env`:

```dotenv
ASSET_CACHE_MAX_SIZE_BYTES=5368709120
ASSET_CACHE_SIZE_BYTES=6442450944
ASSET_CACHE_MEMORY_LIMIT_BYTES=7516192768
ASSET_CACHE_HEADROOM_BYTES=536870912
```

Leave room between the maximum cached data, the tmpfs capacity and the container memory
limit for in-flight files and nginx workers. Also leave physical RAM for Windows and
other workloads; startup validation is a snapshot, not a reservation against later host
activity. The complete asset tree was approximately 8.7 GiB when this mode was prepared,
so the default cache is intended for selected working tiers.

Inspect `X-Asset-Cache` in the response headers: `MISS` fills the cache, `HIT` serves
from RAM, and `BYPASS` identifies an uncached JSON index. Query variations create
separate entries. Byte ranges and CORS remain supported. A same-machine six-browser
check (36 concurrent requests, 26.6 MB) measured warm batches at 243–262 ms with RAM
caching versus 286–329 ms with the original static bind mount. This is a bounded host
delivery check, not a six-Quest or over-Wi-Fi result.

Include both Compose files in subsequent recreate and validation commands. To return to
direct file serving, recreate using only `compose.yaml`. That drops the RAM cache; it
does not remove source assets.

## Local streaming performance

The Linux image enables `aio threads` so file reads do not block nginx's request
handler. The native Windows launcher omits this Linux-only directive. Increasing
`worker_connections` is unnecessary for the player's default six concurrent fetches.
`Timing-Allow-Origin: *` exposes cross-origin Resource Timing data so browser
diagnostics can distinguish connection setup, waiting and body transfer.

A bounded browser comparison on 2026-10-13 used six simultaneous uncached requests for
the same 1,773,990-byte full-tier SOG, with warmed server storage and connections:

| Configuration                    | Six-file batch time |
| -------------------------------- | ------------------- |
| Windows bind mount, one worker   | 247–318 ms          |
| Windows bind mount, auto workers | 152–189 ms          |
| Windows bind mount, HTTP/2       | 257–300 ms          |
| Windows bind mount, I/O threads  | 114–126 ms          |
| Linux storage, I/O threads       | 89–97 ms            |

The final configuration was also checked with six **distinct** frame files. Full-tier
batches took 117–149 ms; warm minimum-tier batches took 77–92 ms. These are small fetch
measurements, not sustained playback or Quest frame-rate results. Concurrent playback
and host activity can change the timings. Benchmark scratch files stay in ignored
`.nginx/`.

For further improvement, put the served dataset on a Linux filesystem, such as a Docker
named volume or WSL ext4 storage. Docker documents
[higher filesystem performance for Linux-backed files](https://docs.docker.com/desktop/features/wsl/best-practices/).
The Windows bind mount is convenient for development, but adds a filesystem-sharing
boundary. Keep the same relative dataset layout when moving it. On a Linux server, set
`ASSET_PUBLIC_DIR` to the Linux dataset directory; the existing Compose bind mount then
reads that filesystem directly.

Copying the complete current local asset tree would duplicate approximately 10.75 GiB.
The Windows drive containing both the source and configured Docker data directory had
only about 7.4 GiB free during this investigation. The full copy was deferred; check
available space on the disk backing Docker before staging a named volume.

The player already prefetches compressed bytes with a 200,000,000-byte default budget. A
larger budget gives more playback headroom, but first-time files still need to be
delivered. Fully preloading a long full-quality sequence can require several gigabytes.
Long browser cache lifetimes help repeat sessions only; use versioned asset URLs before
enabling immutable caching so regenerated files remain refreshable.

HTTP/2 did not improve this particular bind-mount test. HTTP/3 is not enabled: it adds
QUIC/UDP deployment requirements while leaving filesystem costs in place. Re-evaluate
protocols on the actual network path after storage and file-I/O improvements.

## Local Docker setup

Run commands from the repository root with Docker Desktop running. The default read-only
asset mount is `apps/6g-showcase/public`; the TLS mounts are the existing
`.cert/localhost-cert.pem` and `.cert/localhost-key.pem`. Create those certificates
first if absent, following the [Quest/WebXR guide](quest-webxr.md#local-https).

```powershell
docker compose -f config/nginx/compose.yaml up -d
docker compose -f config/nginx/compose.yaml exec -T assets nginx -t
```

The WebXR asset endpoint is `https://localhost:8443/`. nginx and Vite use the same local
mkcert certificate; **no public certificate or domain is required**. Trust its issuing
local CA on the browser device, as described in the
[Quest/WebXR guide](quest-webxr.md#local-https). Both nginx listeners bind only to this
machine by default. Configure the ignored `apps/6g-showcase/.env.local` for the existing
local dataset:

```dotenv
VITE_DEFAULT_MANIFEST_URL=https://localhost:8443/assets/6g-path-demo/manifest.json
VITE_EXPLAINER_ASSETS_URL=https://localhost:8443/assets/explainer/truck/explainer-assets.json
```

Start or restart `pnpm dev:6g-showcase:https`, then open
`https://localhost:4182/#/demo`. An explicit `manifest` hash parameter overrides the
default, so remove an old parameter when testing the new configuration. No assets need
to be copied or regenerated.

An HTTPS app requires **HTTPS for both asset URLs**. If the address bar still contains
`#/demo?manifest=http%3A...`, replace that parameter or open the clean URL above;
changing the environment default does not override an explicit URL parameter. An
existing certificate file alone does not establish CA trust. Installing a new local CA
also requires regenerating any certificate previously issued by a different CA. After
regeneration, restart Vite and recreate nginx to load the new certificate pair.

The HTTP listener at `http://localhost:8080/` is available for non-WebXR HTTP testing;
do not use it as an asset URL from the HTTPS showcase.

For a Quest on the LAN, first create the actual Compose environment file if absent:

```powershell
if (!(Test-Path config/nginx/.env)) {
  Copy-Item config/nginx/.env.example config/nginx/.env
}
```

Set `ASSET_BIND_ADDRESS=0.0.0.0` in **`config/nginx/.env`**, then recreate the service
using that file explicitly:

```powershell
docker compose --env-file config/nginx/.env -f config/nginx/compose.yaml up -d --force-recreate assets
docker compose --env-file config/nginx/.env -f config/nginx/compose.yaml ps
```

The published TLS port should show `0.0.0.0:8443->443/tcp`. Editing `.env.example` alone
does not change the running container or the values supplied to this command. Use
`https://<development-machine-ip>:8443/...` in **both** asset URLs, and open
`https://<development-machine-ip>:4182/#/demo` on the headset. Its certificate must
cover that IP and the headset must trust the same local CA. `localhost` in a headset URL
refers to the headset. See
[certificate trust and alternate addresses](quest-webxr.md#a-separate-server-or-vpn-address).

```powershell
docker compose -f config/nginx/compose.yaml logs --tail 30 assets
docker compose -f config/nginx/compose.yaml stop
docker compose -f config/nginx/compose.yaml start
```

After editing the template, recreate this service to render it again:

```powershell
docker compose -f config/nginx/compose.yaml up -d --force-recreate assets
```

## Another machine or a general deployment

Copy `config/nginx/.env.example` to `config/nginx/.env`. Set absolute host paths for
`ASSET_PUBLIC_DIR`, `ASSET_CERT_FILE` and `ASSET_KEY_FILE`. The served directory must
contain the layout referenced by your URLs, for example:

```text
/srv/gs-streaming/public/
  assets/
    6g-path-demo/
      manifest.json
      dynamic/
      static/
      audio/
    explainer/truck/
      explainer-assets.json
      checkpoints/
      ...
```

You can instead mount a directory that contains `manifest.json` directly and use
`https://HOST:PORT/manifest.json`. Preserve each index's relative asset paths, and check
any pre-existing absolute URLs separately.

Set `ASSET_BIND_ADDRESS=0.0.0.0` for LAN or remote access and permit the chosen ports
through the server's firewall/network policy. For a public HTTPS endpoint,
`ASSET_PORT=443` publishes the container's TLS listener on port 443. Use a certificate
covering the actual hostname or IP; mkcert certificates are intended for development
devices that trust their local CA. Change the two showcase asset URLs to that address
and restart Vite, or rebuild the deployed app.

```bash
docker compose --env-file config/nginx/.env -f config/nginx/compose.yaml up -d
```

Repeat `--env-file config/nginx/.env` for subsequent Compose commands. The image is
pinned to `nginx:1.31.6-alpine`. The
[official image entrypoint](https://hub.docker.com/_/nginx) renders the shared template
into `/etc/nginx/nginx.conf`; its filter preserves nginx variables such as `$uri`.
Certificates and datasets are mounted read-only and stay out of the image. After
renewing a certificate, recreate this service so nginx loads it.

## Native Windows alternative

The Windows launcher downloads the pinned official nginx mainline ZIP on its first
`-Install` invocation. Binaries, generated configurations and logs stay in ignored
`.nginx/`. Stop the Docker service before using the same ports.

```powershell
pwsh -File scripts/nginx-assets.ps1 -Install
pwsh -File scripts/nginx-assets.ps1 -Action reload
pwsh -File scripts/nginx-assets.ps1 -Action stop
```

The default is HTTPS on port 8443 with the repository's local certificate pair. Use
`-Http -Port 8080` only for an HTTP app. Other options are `-PublicDirectory`,
`-ListenAddress 0.0.0.0`, `-CertificatePath`, `-CertificateKeyPath` and `-Port`. Supply
the same options when reloading. `-Action check` validates a candidate configuration
without changing a running server. Warning/error logs are in `.nginx/runtime/logs`;
per-request access logging is disabled by default.

The launcher validates configuration before starting or reloading and signals only the
nginx executable installed for this checkout. nginx's
[Windows documentation](https://nginx.org/en/docs/windows.html) describes its native
build as beta and notes that only one worker does work. Use the Linux Docker deployment
for broader deployment and compare performance on your actual storage/network path.

## Verify delivery

Windows curl may fail revocation checks for a local CA without a revocation service.
`--ssl-no-revoke` below disables that check while retaining certificate-chain and
hostname verification. Browser testing should use normal certificate validation.

```powershell
curl.exe --ssl-no-revoke -I https://localhost:8443/assets/6g-path-demo/manifest.json
curl.exe --ssl-no-revoke -i -H "Range: bytes=0-15" https://localhost:8443/assets/6g-path-demo/dynamic/frame_00001-preview.sog
curl.exe --ssl-no-revoke -i -X OPTIONS -H "Origin: https://localhost:4182" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: Range" https://localhost:8443/assets/6g-path-demo/dynamic/frame_00001-preview.sog
```

Expect 200 JSON for the manifest, 206 with `Content-Range` and 16 bytes for the range,
and 204 with CORS headers for preflight. A missing `.sog` must return 404 rather than
the app shell. Also check the static `lod-meta.json`, one of its WebP files, the audio
URL and the explainer index. In browser Network tools, their host/port should be the
nginx endpoint instead of Vite's port 4182. Sustained playback and Quest acceptance
remain device measurements; these server checks do not establish playback throughput.
