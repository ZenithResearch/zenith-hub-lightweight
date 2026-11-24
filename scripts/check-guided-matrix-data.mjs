/** Disposable-user/room persistence checks for a Matrix instance installed and restarted through the UI. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { requestJSON } from "../src/lib/setup/network.mjs";
import { readPrivate } from "../src/lib/setup/state.mjs";
import { runOwned } from "../src/lib/setup/adapters.mjs";
const [root, instanceId, mode = "create"] = process.argv.slice(2);
assert.ok(
  root?.startsWith("/private/tmp/zenith-hub-ui-") &&
    /^[a-z][a-z0-9-]+$/.test(instanceId),
  "Only explicitly disposable UI qualification roots are supported",
);
const instance = path.join(root, "instances", instanceId),
  receipt = JSON.parse(await readPrivate(path.join(instance, "receipt.json"))),
  config = JSON.parse(
    await readPrivate(path.join(instance, "config/selection.json")),
  );
assert.equal(receipt.componentId, "matrix");
assert.ok(config.serverName.endsWith(".invalid"));
const base = "http://127.0.0.1:" + config.port,
  dir = path.join(root, "qualification"),
  file = path.join(dir, "matrix-data.json");
const segment = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
async function call(route, options = {}) {
  const r = await requestJSON(base, route, options);
  assert.equal(r.status, 200, JSON.stringify(r.value));
  return r.value;
}
if (mode === "create") {
  const secret = (
    await runOwned(path.join(instance, "venv/bin/python"), [
      "-I",
      "-c",
      'import yaml,sys;print(yaml.safe_load(open(sys.argv[1]))["registration_shared_secret"])',
      path.join(instance, "config/homeserver.yaml"),
    ])
  ).trim();
  const username = "ui-proof-" + randomBytes(4).toString("hex"),
    password = randomBytes(24).toString("hex"),
    nonce = (await call("/_synapse/admin/v1/register")).nonce;
  const mac = createHmac("sha1", secret)
    .update([nonce, username, password, "notadmin"].join("\0"))
    .digest("hex");
  const user = await call("/_synapse/admin/v1/register", {
    method: "POST",
    body: { nonce, username, password, admin: false, mac },
  });
  const login = await call("/_matrix/client/v3/login", {
    method: "POST",
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
    },
  });
  const token = login.access_token;
  const room = await call("/_matrix/client/v3/createRoom", {
    method: "POST",
    token,
    body: {
      visibility: "private",
      preset: "private_chat",
      name: "Disposable Hub qualification",
    },
  });
  const message = await call(
    "/_matrix/client/v3/rooms/" +
      segment(room.room_id) +
      "/send/m.room.message/" +
      randomBytes(8).toString("hex"),
    {
      method: "PUT",
      token,
      body: {
        msgtype: "m.text",
        body: "Disposable Hub persistence proof; no other participants.",
      },
    },
  );
  await mkdir(dir, { mode: 0o700 });
  await writeFile(
    file,
    JSON.stringify({
      token,
      userId: user.user_id,
      roomId: room.room_id,
      eventId: message.event_id,
    }),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      passed: true,
      disposableUserLogin: true,
      privateRoom: true,
      messageToSelfOnly: true,
      readyForUIRestart: true,
    }),
  );
} else {
  assert.equal(mode, "verify");
  const proof = JSON.parse(await readPrivate(file));
  const who = await call("/_matrix/client/v3/account/whoami", {
    token: proof.token,
  });
  assert.equal(who.user_id, proof.userId);
  const event = await call(
    "/_matrix/client/v3/rooms/" +
      segment(proof.roomId) +
      "/event/" +
      segment(proof.eventId),
    { token: proof.token },
  );
  assert.match(event.content.body, /Disposable Hub persistence proof/);
  console.log(
    JSON.stringify({
      passed: true,
      userTokenPersistent: true,
      privateRoomPersistent: true,
      messagePersistent: true,
      verifiedAfterUIRestart: true,
    }),
  );
}
