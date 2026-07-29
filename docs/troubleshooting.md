# Troubleshooting

## The manifest does not load

Confirm the URL is HTTPS on an HTTPS page, returns JSON rather than an HTML error page,
and has CORS headers. Validate it with `pnpm gs-content validate <manifest>` and inspect
every relative asset URL.

## Playback remains buffering

Check that the minimum tier exists for every frame, splat/byte metadata matches the
files, at least two startup frames fit in memory, and the CDN is not serializing or
throttling requests. Lower the minimum detail only after producing a corresponding tier.

## WebGPU falls back

This is expected when WebGPU initialization or WebGPU/WebXR binding support fails. The
backend badge reports the path actually in use. On Quest, check browser flags and then
test WebGL2 as the supported fallback.

## Audio does not start

Call `play()` from a user gesture and handle its promise. Verify the audio URL, CORS,
codec support, and manifest offset. Buffering deliberately pauses audio.

## The scene is rotated or displaced

The player performs no implicit source convention conversion. Fix the manifest or
authoring transform. Apple SHARP output, for example, uses OpenCV coordinates.

## Quest performance is poor

Reduce the dynamic render budget and static-scene pressure first. The recorded ~20 ms
stereo case is content/configuration-specific. Do not assume fixed foveation or reduced
resolution helps until it is measured on the target build.
