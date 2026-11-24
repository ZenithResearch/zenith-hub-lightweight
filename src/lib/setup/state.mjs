import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import { check } from "./catalog.mjs";
export async function privateDirectory(root) {
  check(
    root,
    path.isAbsolute(root) && !root.split(path.sep).includes(".."),
    "invalid_setup_root",
  );
  for (let p = root; ; p = path.dirname(p)) {
    try {
      const s = await lstat(p);
      check(
        s,
        s.isDirectory() && !s.isSymbolicLink(),
        "unsafe_setup_directory",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (path.dirname(p) === p) break;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const s = await lstat(root);
  check(
    s,
    s.uid === process.getuid() && (s.mode & 0o077) === 0,
    "setup_directory_not_private",
  );
}
export async function readPrivate(file, limit = 1048576) {
  const f = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    const l = await lstat(file);
    check(
      s,
      s.isFile() &&
        !l.isSymbolicLink() &&
        s.uid === process.getuid() &&
        s.nlink === 1 &&
        (s.mode & 0o077) === 0 &&
        s.size <= limit,
      "unsafe_setup_file",
    );
    return await f.readFile("utf8");
  } finally {
    await f.close();
  }
}
export async function atomic(file, value) {
  const tmp = file + ".pending-" + randomUUID();
  const f = await open(tmp, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, file);
}
export function stateStore(root) {
  const file = path.join(root, "setup.json");
  const application=async()=>{const {activation,applicationForRoot,assertNoPendingMigration}=await import('../application/owner.mjs');if(await activation(root))return applicationForRoot(root);await assertNoPendingMigration(root);return null;};
  return {
    root,
    async database(){return application();},
    async saveReview(plan){const app=await application();return app?app.saveReview(plan):null;},
    async getReview(id){const app=await application();return app?app.getReview(id):null;},
    async retireReview(id){const app=await application();if(app)await app.deleteReview(id);},
    async read() {
      const app=await application();if(app)return app.readSetup();
      try {
        const s = JSON.parse(await readPrivate(file));
        check(
          s,
          s.schema === "zenith.hub-setup-state.v1" &&
            Number.isSafeInteger(s.revision),
          "invalid_setup_state",
        );
        return s;
      } catch (e) {
        if (e.code === "ENOENT")
          return {
            schema: "zenith.hub-setup-state.v1",
            revision: 0,
            step: "welcome",
            selection: [],
            instances: [],
            operations: {},
          };
        throw e;
      }
    },
    async write(fn,options) {
      const app=await application();if(app)return app.writeSetup(fn,options);
      await privateDirectory(root);
      const lock = path.join(root, "setup.lock");
      let f;
      try {
        f = await open(lock, "wx", 0o600);
      } catch (e) {
        if (e.code === "EEXIST") check(null, false, "setup_busy_reconcile");
        throw e;
      }
      try {
        const s = await this.read();
        const result = await fn(s);
        s.revision++;
        await atomic(file, s);
        return result;
      } finally {
        await f.close();
        await unlink(lock);
      }
    },
  };
}
