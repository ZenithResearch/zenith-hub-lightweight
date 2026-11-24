import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
  rename,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hermesInstallations } from "../../src/lib/setup/hermes-installations.mjs";
import { digest } from "../../src/lib/setup/catalog.mjs";

test("native install discovery is read-only and does not expose a profile's credentials", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "hermes-discovery-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "software"),
    home = path.join(root, "user"),
    runtime = path.join(root, "runtime"),
    profile = path.join(home, ".hermes"),
    envRoot = path.join(root, "venv");
  const manifest = JSON.parse(
    await readFile("profiles/setup/hermes-installer.json", "utf8"),
  );
  for (const p of [
    path.join(home, ".local/bin"),
    path.join(source, "hermes_cli"),
    path.join(runtime, manifest.tools.python.directory, "bin"),
    path.join(envRoot, "bin"),
    path.join(profile, "installs", digest(source).slice(0, 16)),
    path.join(profile, "profiles", "team"),
  ])
    await mkdir(p, { recursive: true, mode: 0o700 });
  const write = (p, v) =>
    writeFile(p, typeof v === "string" ? v : JSON.stringify(v), {
      mode: 0o600,
    });
  await write(path.join(source, "install-stamp.json"), {
    commit: manifest.source.commit,
  });
  await write(path.join(source, "hermes_cli/main.py"), "# installed entry");
  await write(
    path.join(runtime, manifest.tools.python.directory, "bin/python3.14"),
    "not executed",
  );
  await write(path.join(envRoot, "bin/python"), "not executed");
  await write(
    path.join(profile, "installs", digest(source).slice(0, 16), "facts.json"),
    { packages: { venv: { environment: envRoot } } },
  );
  await write(path.join(profile, "config.yaml"), {
    model: { provider: "custom", default: "sample" },
  });
  await write(path.join(profile, ".env"), "EXAMPLE_API_KEY=do-not-disclose");
  await write(path.join(profile, "profiles/team/config.yaml"), {
    model: { default: "team" },
  });
  await write(
    path.join(home, ".local/bin/hermes"),
    "#!/bin/sh\nexport HERMES_RUNTIME_DIR=" +
      runtime +
      "\nexec " +
      source +
      '/.hermes/bin/hermes "$@"\n',
  );
  const discovery = hermesInstallations({
    env: { HOME: home, PATH: "" },
    setupRoot: path.join(root, "hub"),
  });
  const rows = await discovery.public();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].compatible, true);
  assert.deepEqual(
    rows[0].profiles.map((p) => p.name),
    ["Default", "team"],
  );
  assert.ok(!JSON.stringify(rows).includes("do-not-disclose"));
  await assert.rejects(access(path.join(root, "hub")));
  await assert.rejects(
    discovery.inspect(rows[0].id),
    /ENOENT|hermes_installed_source_changed/,
  );
  assert.equal(
    await readFile(path.join(profile, ".env"), "utf8"),
    "EXAMPLE_API_KEY=do-not-disclose",
  );
  let executions = 0, verifications = 0;
  const reuse = hermesInstallations({ env: { HOME: home, PATH: "" }, setupRoot: path.join(root, "hub"), verifier: async () => { verifications++; }, run: async () => { executions++; throw Error("No native profile command is allowed"); } });
  const prepared = await reuse.prepare({instanceId: "default"}, {installationId: rows[0].id, defaultConfiguration: true});
  assert.equal(prepared.guideBinding.configurationHome, profile);
  assert.equal(prepared.guideBinding.template, null);
  await assert.rejects(access(path.join(root, "hub")));
  const destination = path.join(root, "hub/instances/default");
  const result = await reuse.create({...prepared,root:destination,instanceId:"default",digest:"fixture",planFile:"unused"});
  const receipt = JSON.parse(await readFile(path.join(destination,"receipt.json")));
  assert.equal(result.configurationHome, profile);
  assert.equal(receipt.configurationHome, profile);
  assert.equal(receipt.profile, undefined);
  await assert.rejects(access(path.join(destination,"profiles")));
  assert.equal(executions, 0); assert.ok(verifications >= 2);
  assert.equal(await readFile(path.join(profile,".env"),"utf8"),"EXAMPLE_API_KEY=do-not-disclose");
  assert.deepEqual(JSON.parse(await readFile(path.join(profile,"config.yaml"))),{model:{provider:"custom",default:"sample"}});
  const changed = await reuse.prepare({instanceId:"changed"},{installationId:rows[0].id,defaultConfiguration:true});
  await rename(profile,profile+"-retained");await mkdir(profile,{mode:0o700});
  const invalidRoot=path.join(root,"hub/instances/changed");
  await assert.rejects(reuse.create({...changed,root:invalidRoot,instanceId:"changed",digest:"fixture",planFile:"unused"}),/hermes_configuration_changed/);
  await assert.rejects(access(path.join(invalidRoot,"receipt.json")));

});
test("an unverified existing launcher is installed software, not a missing installation", async (t) => {
  const home = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "hermes-launcher-")),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, ".local/bin"), { recursive: true });
  await writeFile(path.join(home, ".local/bin/hermes"), "#!/bin/sh\nexit 0\n");
  const rows = await hermesInstallations({
    env: { HOME: home, PATH: "" },
  }).public();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].compatible, false);
  assert.match(rows[0].reason, /could not be verified/);
});
