import { spawn, spawnSync } from "node:child_process";

const port = process.env.NGROK_PORT || "8000";
const proto = process.env.NGROK_PROTO || "http";
const extraArgs = process.argv.slice(2);

try {
  const probe = spawnSync("ngrok", ["version"], { stdio: "ignore" });
  if (probe.error || probe.status === null) {
    throw probe.error || new Error("ngrok is unavailable");
  }
} catch {
  console.error(
    [
      "ngrok was not found on this machine.",
      "Install it first, then run `npm run tunnel` again.",
      "If you already installed it somewhere else, make sure it is on your PATH.",
    ].join(" ")
  );
  process.exit(1);
}

const child = spawn("ngrok", [proto, port, ...extraArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
