import { spawn } from "node:child_process";
/** Spawn creates a dedicated process group; unlike execFile it honors detached.
 * Never unlock the caller before the controller and its descendants are gone. */
export function executeOwned(
  file,
  args,
  options,
  { signalGroup = process.kill.bind(process), spawnProcess = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    // Snapshot caller input before spawning. Only the private pipe receives it.
    const suppliedInput = options.input;
    let input;
    if (suppliedInput !== undefined) {
      const invalid = (code) => {
        const failure = new Error("Controller input must be bounded UTF-8 text");
        failure.code = code;
        reject(failure);
      };
      if (typeof suppliedInput !== "string") {
        invalid("OPERATOR_INVALID_INPUT");
        return;
      }
      if (Buffer.byteLength(suppliedInput, "utf8") > 65536) {
        invalid("OPERATOR_INPUT_TOO_LARGE");
        return;
      }
      input = Buffer.from(suppliedInput, "utf8");
      if (input.toString("utf8") !== suppliedInput) {
        invalid("OPERATOR_INVALID_INPUT");
        return;
      }
    }
    let timer,
      error,
      stdout = [],
      stderr = [],
      size = 0;
    const child = spawnProcess(file, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
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
    if (input !== undefined) {
      const inputFailed = (cause) => {
        const failure = new Error("Controller input stream failed");
        failure.code = cause?.code === "EPIPE"
          ? "OPERATOR_INPUT_CLOSED" : "OPERATOR_INPUT_FAILED";
        error = error || failure;
        terminate();
      };
      // Writable errors are asynchronous, including EPIPE after an early exit.
      // Keep the ordinary close/group-cleanup gate responsible for completion.
      child.stdin.on("error", inputFailed);
      try {
        child.stdin.end(input);
      } catch (cause) {
        inputFailed(cause);
      }
    }
  });
}
