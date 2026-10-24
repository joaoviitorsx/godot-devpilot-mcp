#!/usr/bin/env node
if (process.argv[2] === "doctor") {
  process.argv.splice(2, 1);
  await import("../scripts/doctor.mjs");
} else {
  await import("../scripts/install.mjs");
}
