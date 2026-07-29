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
