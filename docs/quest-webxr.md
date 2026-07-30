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
