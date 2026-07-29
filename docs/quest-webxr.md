# Quest and WebXR

The showcase targets room-scale immersive VR on Quest 3. It does not add teleport or
smooth locomotion.

## Local HTTPS

Create a trusted local certificate in the ignored `.cert/` directory and put this in
`apps/showcase/.env.local`:

```dotenv
VITE_HTTPS=true
VITE_HOST=0.0.0.0
VITE_DEFAULT_MANIFEST_URL=https://your-cdn.example/manifest.json
```

Open `https://<development-machine-ip>:4180/#/demo` from the headset. The certificate
authority must be trusted on the device. Native WebGPU WebXR is experimental in Quest
Browser and may require its WebGPU/WebXR binding, projection-layer, and WebXR experiment
flags. The showcase falls back once to WebGL2 when compatibility or initialization fails
and displays the actual backend.

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
