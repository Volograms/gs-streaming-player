# AGENT.md

## Purpose
Develop a reusable web player library for playback of composited Gaussian Splat content consisting of:

* one or more persistent static Gaussian Splat objects;
* one dynamic Gaussian Splat sequence, initially represented as one `.RAD` file per frame;
* optional conventional Three.js meshes;
* local rendering on mobile, tablet and desktop devices;
* temporal buffering similar to a conventional video player;
* progressive per-frame spatial Level of Detail;
* adaptive quality driven first by generic network measurements and later by network telemetry supplied by the 6G testbed.

A separate demo application will integrate the library and provide:

* content loading;
* playback controls;
* scene navigation;
* quality controls;
* network simulation;
* diagnostic visualisation;
* 6G telemetry integration;
* experiment logging.

## Project management
- use `docs/project/TODO.md` to pick new tasks and keep track of their status
- when given feedback or new priorities, update `docs/project/TODO.md`
- when agreed on a rule or direction, record it in `docs/project/DECISIONS.md`
- when completed a meaningful slice, add it to `CHANGELOG.md`
- when adding user or admin facing configuration files, document them in `docs` folder.

## Code quality rules
- Prefer small focused modules over large multi-purpose files.
- make function and files focused on one domain and functionality, do not spread duplicated code accross code base

## If unsure
When a change might violate the rules, stop and ask questions.
