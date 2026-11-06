import { spawn } from "node:child_process";
import { accessConfig } from "../src/lib/preview-auth.ts";

try { process.loadEnvFile(".env.local"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
process.env.LAVIN_LOCAL = "0";
accessConfig(); // Refuse to listen publicly without a valid password and origin.
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], {
  stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", code => process.exit(code ?? 1));
