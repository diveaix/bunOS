import { spawnSync } from "node:child_process";

const suites = [
  ["core regression suite", ["test/run-tests.js"]],
  ["agent eval harness", ["test/agent-evals.js"]]
];

for (const [name, args] of suites) {
  console.log(`\n== ${name} ==`);
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
