# Quest and WebXR

The showcase targets room-scale immersive VR on Quest 3. It does not add teleport or
smooth locomotion.

## Local HTTPS

Install [mkcert](https://github.com/FiloSottile/mkcert), create its local authority, and
generate a certificate in the ignored `.cert/` directory. Include the development
machine's LAN IP because the Quest connects by IP rather than `localhost`:

```powershell
mkcert -install
New-Item -ItemType Directory -Force .cert
mkcert -key-file .cert/localhost-key.pem `
  -cert-file .cert/localhost-cert.pem `
  localhost 127.0.0.1 ::1 <development-machine-ip>
```

Keep dataset configuration in the ignored `apps/showcase/.env.local`, for example:

```dotenv
SHOWCASE_LOCAL_DATASET_DIR=C:/datasets/my-sequence
VITE_DEFAULT_MANIFEST_URL=/manifest.json
```

Start the LAN-accessible HTTPS server:

```bash
pnpm dev:showcase:https
```

Open `https://localhost:4180/#/demo` locally or
`https://<development-machine-ip>:4180/#/demo` from the headset. The mkcert authority
must be trusted on the device; accepting an untrusted page warning is not equivalent to
a secure context for WebXR. The committed HTTPS mode enables XR and binds to `0.0.0.0`,
while `.env.local` continues to supply the external dataset path and manifest URL.

### A separate server or VPN address

The repository includes the `dev:showcase:https` startup command, but certificate
generation uses `mkcert` directly. Both `.cert/` and `apps/showcase/.env.local` are
ignored by Git: configure them separately on the server.

Include every hostname or IP used in the browser in the certificate. A certificate for
`localhost` alone does not cover the server's VPN IP. On a development machine where you
use the browser, run the following from the repository root, replacing
`SERVER_VPN_IP_OR_HOSTNAME` with the actual address:

```powershell
mkcert -install
New-Item -ItemType Directory -Force .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost-cert.pem localhost 127.0.0.1 ::1 SERVER_VPN_IP_OR_HOSTNAME
```

This replaces the development certificate pair; include any existing LAN addresses you
still need in the same command. Copy the resulting `localhost-cert.pem` and
`localhost-key.pem` securely into the server checkout's `.cert/` directory, then run:

```bash
pnpm dev:showcase:https
```

Open `https://SERVER_VPN_IP_OR_HOSTNAME:4180/`. The certificate was issued by the CA
trusted on your development machine. If you generate the certificate on the server
instead, each browser device must trust that server's issuing CA: its public
`rootCA.pem` is in the directory reported by `mkcert -CAROOT`. The CA private key,
`rootCA-key.pem`, stays on the issuing machine. See
[mkcert's instructions for installing the CA on other systems](https://github.com/FiloSottile/mkcert#installing-the-ca-on-other-systems).

The HTTPS mode already selects `VITE_HOST=0.0.0.0`. The server's VPN/network policy must
also permit access to TCP port 4180.

## Native WebGPU WebXR on Quest Browser 146+

Native WebGPU-backed immersive XR is experimental and is not enabled by the Quest
Browser version alone. On Quest Browser 146 or newer, open each URL in the headset
browser, set the flag to **Enabled**, and relaunch:

1. `chrome://flags/#webxr-webgpu-binding` — WebXR/WebGPU Binding
2. `chrome://flags/#webxr-projection-layers` — WebXR Projection Layers
3. `chrome://flags/#webxr-experiments` — WebXR Experiments

If Relaunch does not apply all three flags, fully close the browser or restart the
headset. Browser updates may reset experimental flags.

WebGPU page rendering does not prove that WebGPU can host an immersive session.
PlayCanvas also requires the browser to expose `XRGPUBinding`. Verify that the player
reports WebGPU as the graphics backend and that WebXR is ready before entering VR. If it
reports a missing WebGPU binding, recheck the browser version and all three flags.

The showcase falls back once to WebGL2 when WebGPU XR compatibility or initialization
fails and displays the backend actually in use. The diagnostic PlayCanvas application
can instead enforce strict WebGPU XR for measurements; see
[Native WebGPU WebXR in the PlayCanvas integration guide](playcanvas-renderer-integration.md#native-webgpu-webxr-on-quest-browser-146).

## Input

The world-space transport accepts controller rays and the WebXR `select` event. Hand
pinch uses the same route when hand tracking is exposed. On Meta Touch, A/X toggles
playback, B/Y toggles the panel, and a debounced horizontal thumbstick seeks. The panel
also provides recentering.

Fixed foveation and resolution reduction are disabled by default. They are potential
optimizations, not validated recommendations. Test both eyes, entry/exit, controller and
hand input, buffering/audio recovery, and both graphics backends on real hardware.

See
[PlayCanvas XR input sources](https://developer.playcanvas.com/user-manual/xr/input-sources/).
