# Public-repository audit

Audit date: 2026-07-29

## Working tree

- Pattern scan found no likely embedded API keys, passwords, access tokens, or private
  key blocks outside dependency/generated directories.
- URL scan found only documented localhost/LAN examples and public placeholder URLs; no
  private dataset endpoint is configured.
- The five tracked root Quest photos were removed. The intended public binary assets are
  the two curated PNG showcase captures in `docs/assets` plus the existing SPZ license
  text.
- Datasets, traces, local certificates, environment-local files, JPEGs, and videos are
  ignored. No sample dataset is bundled.

## Dependencies and attribution

The installed dependency metadata reports MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, MPL-2.0, BlueOak-1.0.0, and CC-BY-4.0 license identifiers. No installed package
inspected by the metadata pass lacked a license field. Upstream projects are
acknowledged in `THIRD_PARTY_NOTICES.md`; Niantic's SPZ license remains in
`packages/codec-spz/LICENSE.spz`.

This metadata pass is not legal advice. Re-run it from a clean frozen-lockfile install
and review the actual license texts before a tagged release.

## Git history — owner action required

The history name scan found prior WhatsApp JPEG and MP4 experiment artifacts, including
the five files removed from the current tree and additional July 27 captures. Example
`.env.example` revisions were also found and should be content-scanned before
publication.

No history rewrite was performed. Repository owners must decide whether the media has
publication consent. If not, remove the objects with an owner-approved history rewrite,
rotate any affected clone/remote references, and repeat the secret and object audit
before changing repository visibility.
