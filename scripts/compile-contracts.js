import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = fileURLToPath(new URL("..", import.meta.url));
const contracts = ["ArcPerpsOracle.sol", "ArcPerpsVault.sol"];
const sources = {};

for (const file of contracts) {
  sources[file] = {
    content: await readFile(join(root, "contracts", file), "utf8")
  };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((item) => item.severity === "error");
const warnings = (output.errors || []).filter((item) => item.severity !== "error");

for (const warning of warnings) {
  console.warn(warning.formattedMessage);
}

if (errors.length) {
  for (const error of errors) {
    console.error(error.formattedMessage);
  }
  process.exit(1);
}

for (const [sourceName, sourceContracts] of Object.entries(output.contracts || {})) {
  for (const [contractName, artifact] of Object.entries(sourceContracts)) {
    if (!artifact.evm?.bytecode?.object) {
      continue;
    }

    const artifactPath = join(root, "build", "contracts", `${contractName}.json`);
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({
      contractName,
      sourceName,
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`
    }, null, 2));
    console.log(`compiled ${contractName} -> ${artifactPath}`);
  }
}
