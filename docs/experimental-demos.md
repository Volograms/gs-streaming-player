# Experimental demos

The three original applications remain diagnostic laboratories. They are not examples of
the minimal public product UI and may expose unsafe performance combinations.

| Command               | Laboratory | Content                                         |
| --------------------- | ---------- | ----------------------------------------------- |
| `pnpm dev:playcanvas` | PlayCanvas | SOG, GPU/CPU sorting, WebGPU/WebGL2, XR metrics |
| `pnpm dev:babylon`    | Babylon.js | SPZ v4 decoding and WebXR comparison            |
| `pnpm dev:spark`      | Spark      | RAD hierarchy, flat SPZ, LoD and CPU behavior   |

Use `apps/showcase` for integration. Use these apps to reproduce measurements, tune a
specific renderer, or investigate future improvements. Keep diagnostics, simulators,
private URLs, and experimental controls out of the showcase.
