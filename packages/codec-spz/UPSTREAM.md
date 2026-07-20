# Niantic SPZ provenance

This package vendors the official browser/WASM SPZ implementation from
<https://github.com/nianticlabs/spz>.

- Upstream revision: `21715c3b481380ad51809698a6ba24c9d88145b0`
- Emscripten used for the checked-in build: `6.0.3`
- Vendored output: `src/vendor/spz.js` and `src/vendor/spz.d.ts`
- Upstream license copy: `LICENSE.spz`

The generated JavaScript contains its WASM payload, so applications do not depend on a
CDN or a separately located `.wasm` file. Rebuild it from a clean upstream checkout:

```bash
git clone https://github.com/nianticlabs/spz.git /tmp/niantic-spz
git -C /tmp/niantic-spz checkout 21715c3b481380ad51809698a6ba24c9d88145b0
git clone https://github.com/emscripten-core/emsdk.git /tmp/emsdk-spz
/tmp/emsdk-spz/emsdk install 6.0.3
/tmp/emsdk-spz/emsdk activate 6.0.3
bash -lc 'source /tmp/emsdk-spz/emsdk_env.sh && cd /tmp/niantic-spz && npm run build'
cp /tmp/niantic-spz/dist/spz.js packages/codec-spz/src/vendor/spz.js
cp /tmp/niantic-spz/dist/spz.d.ts packages/codec-spz/src/vendor/spz.d.ts
```

Review the upstream revision and regenerate the browser smoke fixture whenever this pin
changes. Do not hand-edit the generated module.
