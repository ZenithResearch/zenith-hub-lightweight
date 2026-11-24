/** Owner-selected Linux targets. Host keys, credentials and paths never come from browser inputs. */
import path from "node:path";
import { readFile, lstat } from "node:fs/promises";
import { check, digest } from "./catalog.mjs";
import { readPrivate, atomic } from "./state.mjs";
const id = /^[a-z][a-z0-9-]{0,47}$/;
const shellQuote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
export function vpsAdapter({ env, run, setupRoot }) {
  async function targetFor(item) {
    check(item, id.test(item.targetId || ""), "vps_target_required");
    check(
      env,
      !!env.ZENITH_SETUP_VPS_TARGETS_FILE,
      "vps_target_configuration_required",
    );
    const bytes = await readPrivate(env.ZENITH_SETUP_VPS_TARGETS_FILE);
    const config = JSON.parse(bytes);
    check(
      config,
      config.schema === "zenith.hub-vps-targets.v1" &&
        Array.isArray(config.targets),
      "invalid_vps_targets",
    );
    const t = config.targets.find((t) => t.id === item.targetId);
    check(
      t,
      t &&
        /^[a-z_][a-z0-9_-]{0,31}$/.test(t.user) &&
        /^[A-Za-z0-9.-]{1,240}$/.test(t.host) &&
        Number.isInteger(t.port) &&
        t.port > 0 &&
        t.port < 65536 &&
        /^\/(home|srv|opt)\/[A-Za-z0-9_./-]+$/.test(t.root) &&
        !t.root.split("/").includes(".."),
      "invalid_vps_target",
    );
    for (const f of [t.identityFile, t.knownHostsFile, t.artifactManifestFile])
      check(
        f,
        typeof f === "string" && path.isAbsolute(f),
        "invalid_vps_target_file",
      );
    await readPrivate(t.identityFile, 65536);
    const hostKeys = await readPrivate(t.knownHostsFile, 1048576);
    const artifactBytes = await readPrivate(t.artifactManifestFile, 1048576);
    const artifacts = JSON.parse(artifactBytes);
    check(
      artifacts,
      artifacts.schema === "zenith.hub-vps-artifacts.v1" &&
        artifacts.platform === "linux-x86_64" &&
        artifacts.componentId === item.componentId &&
        artifacts.version === item.descriptor.source.version &&
        Array.isArray(artifacts.files) &&
        artifacts.files.length > 0,
      "incompatible_vps_artifacts",
    );
    return {
      ...t,
      configurationDigest: digest(bytes),
      hostKeysDigest: digest(hostKeys),
      artifactManifestDigest: digest(artifactBytes),
      artifacts,
    };
  }
  const sshArgs = (t) => [
    "-p",
    String(t.port),
    "-i",
    t.identityFile,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "UserKnownHostsFile=" + t.knownHostsFile,
    t.user + "@" + t.host,
  ];
  async function ssh(t, script, input) {
    return run(
      "/usr/bin/ssh",
      [...sshArgs(t), "python3 -c " + shellQuote(script)],
      { input: JSON.stringify(input), timeout: 300000 },
    );
  }
  async function prepare(item) {
    try {
      const t = await targetFor(item),
        prerequisites = [];
      if (item.componentId !== "matrix")
        prerequisites.push("This VPS adapter currently supports Matrix only.");
      if (
        item.config.domainMode === "managed" &&
        !t.managedDomains?.includes(item.config.serverName)
      )
        prerequisites.push(
          "A confirmed managed Zenith subdomain reservation is required on this target.",
        );
      if (item.config.access !== "private" && !t.publicAccessReady)
        prerequisites.push(
          "Verify this target’s TLS reverse proxy and DNS delegation before public access.",
        );
      if (item.config.tailscale && !t.tailscaleReady)
        prerequisites.push(
          "Install and authenticate Tailscale on the selected target; it does not enable federation.",
        );
      const artifacts = [];
      for (const f of t.artifacts.files) {
        check(
          f,
          /^[A-Za-z0-9_.+-]+\.whl$/.test(f.filename) &&
            /^[a-f0-9]{64}$/.test(f.sha256),
          "invalid_vps_artifact",
        );
        const file = path.join(t.artifactDirectory, f.filename);
        check(
          file,
          digest(await readFile(file)) === f.sha256,
          "vps_artifact_mismatch",
        );
        artifacts.push({ ...f, path: file });
      }
      return {
        artifacts,
        prerequisites,
        effects: [
          "Connect by SSH to " +
            t.user +
            "@" +
            t.host +
            ":" +
            t.port +
            " with the owner-pinned host key.",
          "Install into " +
            t.root +
            "/" +
            item.instanceId +
            " using the exact Linux wheel closure; do not start services.",
          "Preserve all other target instances, users and data.",
        ],
        target: {
          id: t.id,
          host: t.host,
          root: t.root + "/" + item.instanceId,
          configurationDigest: t.configurationDigest,
          hostKeysDigest: t.hostKeysDigest,
          artifactManifestDigest: t.artifactManifestDigest,
        },
      };
    } catch (e) {
      return {
        artifacts: [],
        prerequisites: [
          e.code?.replaceAll("_", " ") ||
            "Owner VPS configuration is unavailable.",
        ],
        effects: [
          "No remote operation is available until the target prerequisites are supplied.",
        ],
      };
    }
  }
  async function execute(plan, action) {
    const t = await targetFor(plan);
    check(
      t,
      t.configurationDigest === plan.target.configurationDigest &&
        t.hostKeysDigest === plan.target.hostKeysDigest &&
        t.artifactManifestDigest === plan.target.artifactManifestDigest,
      "vps_target_changed",
    );
    const remoteRoot = plan.target.root;
    check(
      remoteRoot,
      remoteRoot === t.root + "/" + plan.instanceId,
      "vps_destination_changed",
    );
    if (action === "install") {
      await ssh(
        t,
        "import json,sys,pathlib,platform; assert sys.version_info[:2]==(3,12) and platform.machine()=='x86_64', 'Python 3.12 on Linux x86_64 required'; p=json.load(sys.stdin); r=pathlib.Path(p['root']); assert not r.exists(), 'target exists; reconcile instead'; s=r.parent/('.hub-stage-'+p['id']); s.mkdir(mode=0o700,parents=True); print(str(s))",
        { root: remoteRoot, id: plan.instanceId },
      );
      const stage = t.root + "/.hub-stage-" + plan.instanceId;
      const local = {
        ...plan,
        root: remoteRoot,
        planFile: stage + "/plan.json",
        artifacts: plan.artifacts.map((f) => ({
          ...f,
          path: stage + "/" + path.basename(f.path),
        })),
      };
      const localPlan = path.join(
        setupRoot,
        "plans",
        "vps-" + path.basename(plan.planFile),
      );
      await atomic(localPlan, local);
      const sourceFiles = [
        path.join(process.cwd(), "scripts/setup/instance.py"),
        localPlan,
        ...plan.artifacts.map((f) => f.path),
      ];
      for (const file of sourceFiles) {
        const remoteName =
          file === localPlan ? "plan.json" : path.basename(file);
        await run(
          "/usr/bin/scp",
          [
            "-P",
            String(t.port),
            "-i",
            t.identityFile,
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "UserKnownHostsFile=" + t.knownHostsFile,
            file,
            t.user + "@" + t.host + ":" + stage + "/" + remoteName,
          ],
          { timeout: 180000 },
        );
      }
      return ssh(
        t,
        "import json,sys,subprocess; p=json.load(sys.stdin); subprocess.run(['python3',p['stage']+'/instance.py','install','--plan',p['stage']+'/plan.json'],check=True)",
        { stage },
      );
    }
    return ssh(
      t,
      "import json,sys,subprocess,pathlib; p=json.load(sys.stdin); root=pathlib.Path(p['root']); f=root/'hub-action.json'; f.write_text(json.dumps(p['plan'])); f.chmod(0o600); subprocess.run(['python3',str(root/'controller.py'),p['action'],'--plan',str(f)],check=True)",
      {
        root: remoteRoot,
        action,
        plan: {
          ...plan,
          root: remoteRoot,
          planFile: remoteRoot + "/hub-action.json",
        },
      },
    );
  }
  return { prepare, execute, targetFor };
}
