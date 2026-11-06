import { spawn } from "node:child_process";
// Explicit single-user development launcher. Never bind this workspace publicly.
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    process.argv[2] || "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PORT || "3000",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, LAVIN_LOCAL: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
