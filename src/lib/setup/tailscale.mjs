/** Private serving only. Existing listeners and public Funnel are never adopted or changed. */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { check, digest } from "./catalog.mjs";
export function tailscaleAdapter({ env, run }) {
  const executable =
    env.ZENITH_SETUP_TAILSCALE_EXECUTABLE || "/usr/local/bin/tailscale";
  async function prepare(item) {
    try {
      check(
        executable,
        path.isAbsolute(executable),
        "invalid_tailscale_executable",
      );
      const executableSha256 = digest(await readFile(executable));
      const status = JSON.parse(
        await run(executable, ["status", "--json"], { timeout: 10000 }),
      );
      check(
        status,
        status.BackendState === "Running" &&
          typeof status.Self?.DNSName === "string",
        "tailscale_login_required",
      );
      const port = item.config.tailscaleHttpsPort || 18443;
      const serve = JSON.parse(
        await run(executable, ["serve", "status", "--json"], {
          timeout: 10000,
        }),
      );
      check(
        serve,
        !serve.TCP?.[String(port)],
        "tailscale_listener_already_owned",
      );
      return {
        prerequisites: [],
        tailscale: {
          executableSha256,
          port,
          dnsName: status.Self.DNSName.replace(/\.$/, ""),
        },
        effects: [
          "Add one private Tailscale HTTPS listener on port " +
            port +
            " forwarding to the selected local component.",
          "Existing listeners are preserved. Public Funnel and federation remain disabled.",
        ],
      };
    } catch (e) {
      return {
        prerequisites: [
          e.code?.replaceAll("_", " ") ||
            "Install and authenticate Tailscale before enabling private serving.",
        ],
        effects: [
          "No network settings will change while prerequisites are missing.",
        ],
      };
    }
  }
  async function enable(plan) {
    check(
      plan,
      digest(await readFile(executable)) === plan.tailscale.executableSha256,
      "tailscale_executable_changed",
    );
    const fresh = await prepare(plan);
    check(
      fresh,
      fresh.prerequisites.length === 0 &&
        fresh.tailscale.dnsName === plan.tailscale.dnsName,
      "tailscale_state_changed",
    );
    return run(
      executable,
      [
        "serve",
        "--bg",
        "--https=" + plan.tailscale.port,
        "http://127.0.0.1:" + plan.config.port,
      ],
      { timeout: 20000 },
    );
  }
  return { prepare, enable };
}
