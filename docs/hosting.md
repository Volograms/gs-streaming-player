# Hosting datasets and the showcase

Datasets live outside this repository. Put the manifest and assets on an HTTPS CDN or
object store, preserving their relative layout.

Every response read by the player must permit the showcase origin. A minimal public
policy is `Access-Control-Allow-Origin: *`; a production deployment may instead name the
exact Pages/application origin. Allow `GET`, `HEAD`, and any range-related headers used
by the selected format. Configure `.json`, `.sog`, `.webp`, `.glb`, and audio MIME types
and avoid HTML fallback responses for missing assets.

An HTTPS showcase cannot load HTTP content. Test the manifest URL in a private browser
window, inspect CORS on every referenced asset, and verify cache invalidation after a
dataset replacement.

Set `VITE_DEFAULT_MANIFEST_URL` at showcase build time. The Pages workflow reads the
repository variable `DEFAULT_MANIFEST_URL`; if absent, it deploys the manifest picker.
Users may always override it with `#/demo?manifest=<encoded-https-url>`.

## Local development datasets

Use the showcase's Vite server instead of a `file://` URL. Point
`SHOWCASE_LOCAL_DATASET_DIR` at the directory containing the canonical manifest and set
the default manifest to its browser path:

```dotenv
SHOWCASE_LOCAL_DATASET_DIR=C:/datasets/my-sequence
VITE_DEFAULT_MANIFEST_URL=/manifest.json
```

Run `pnpm dev:showcase`, then open `http://localhost:4180/#/demo`. Vite exposes the
configured directory as its public root, so all manifest-relative assets retain their
generated layout. The manifest picker also accepts `/manifest.json` during local
development. Do not set `SHOWCASE_LOCAL_DATASET_DIR` in a Pages build. The server-only
name prevents an absolute workstation path from being exposed through `import.meta.env`.

The older demo-style arrangement also works: stage or link the dataset beneath
`apps/showcase/public/assets/my-sequence` and set
`VITE_DEFAULT_MANIFEST_URL=/assets/my-sequence/manifest.json`. These local asset
directories are ignored by Git.
