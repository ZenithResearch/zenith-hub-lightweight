import { spawn } from "node:child_process";
/** Spawn creates a dedicated process group; unlike execFile it honors detached.
 * Never unlock the caller before the controller and its descendants are gone. */
export function executeOwned(
  file,
  args,
  options,
  { signalGroup = process.kill.bind(process) } = {},
) {
  return new Promise((resolve, reject) => {
    let timer,
      error,
      stdout = [],
      stderr = [],
      size = 0;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    function terminate() {
      if (child.pid)
        try {
          signalGroup(-child.pid, "SIGKILL");
        } catch (e) {
          if (e.code === "ESRCH") child.kill("SIGKILL");
          else error = e;
        }
    }
    function collect(target, chunk) {
      size += chunk.length;
      if (size > options.maxBuffer) {
        error = new Error("Controller output exceeded its bound");
        terminate();
      } else target.push(chunk);
    }
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.on("error", (e) => {
      error = e;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      void (async () => {
        const deadline = Date.now() + 5000;
        if (child.pid)
          while (true) {
            try {
              signalGroup(-child.pid, "SIGKILL");
            } catch (e) {
              if (e.code === "ESRCH") break;
              const failure = new Error(
                "Controller cleanup could not be confirmed",
              );
              failure.code = "OPERATOR_CLEANUP_UNRESOLVED";
              throw failure;
            }
            if (Date.now() >= deadline) {
              const e = new Error("Controller cleanup could not be confirmed");
              e.code = "OPERATOR_CLEANUP_UNRESOLVED";
              throw e;
            }
            await new Promise((r) => setTimeout(r, 20));
          }
        if (error || code !== 0 || signal)
          throw error || new Error("Controller failed");
        return {
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };
      })().then(resolve, reject);
    });
    timer = setTimeout(() => {
      error = new Error("Controller timed out");
      terminate();
    }, options.timeout);
  });
}
