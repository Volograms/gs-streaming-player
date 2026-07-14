#!/usr/bin/env node

import { runCli } from "./cli/runCli.js";

const exitCode = await runCli(process.argv.slice(2), {
  stderr: (message) => console.error(message),
  stdout: (message) => console.log(message),
});

process.exitCode = exitCode;
