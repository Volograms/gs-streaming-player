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

Native WebGPU WebXR is experimental in Quest Browser and may require its WebGPU/WebXR
binding, projection-layer, and WebXR experiment flags. The showcase falls back once to
WebGL2 when compatibility or initialization fails and displays the actual backend.

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
