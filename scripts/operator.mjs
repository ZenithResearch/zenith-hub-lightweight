import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env.operator.local"))
  process.loadEnvFile(".env.operator.local");
const port = Number(process.env.ZENITH_OPERATOR_PORT || 4208);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid local port");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    ...(process.argv.includes("--production") ? ["start"] : ["dev"]),
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ZENITH_LOCAL_OPERATOR: "1",
      ZENITH_OPERATOR_ORIGIN: `http://127.0.0.1:${port}`,
    },
    shell: false,
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
