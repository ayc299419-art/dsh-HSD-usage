#!/usr/bin/env node
import { main } from "../lib/index.js";
main(process.argv.slice(2)).then((code) => process.exitCode = code ?? 0);
