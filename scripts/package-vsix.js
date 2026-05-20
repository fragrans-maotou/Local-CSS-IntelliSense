const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(workspaceRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;
const outputVsix = path.join(workspaceRoot, `local-css-intellisense-${version}.vsix`);
const tempRoot = path.join(workspaceRoot, ".packaging-temp", `${Date.now()}-${process.pid}`);
const slimVsix = path.join(tempRoot, "slim.vsix");
const slimZip = path.join(tempRoot, "slim.zip");
const bundleZip = path.join(tempRoot, "bundle.zip");
const extractDir = path.join(tempRoot, "extract");

try {
  prepareTempRoot();
  runVsceSlimPackage();
  fs.copyFileSync(slimVsix, slimZip);
  expandArchive(slimZip, extractDir);
  copyProductionDependencies(path.join(extractDir, "extension"));
  if (fs.existsSync(outputVsix)) {
    fs.unlinkSync(outputVsix);
  }
  compressArchive(path.join(extractDir, "*"), bundleZip);
  fs.copyFileSync(bundleZip, outputVsix);
  console.log(`Created ${path.basename(outputVsix)}`);
} finally {
  removeDirectory(tempRoot);
}

function runVsceSlimPackage() {
  const relativeSlimVsix = path.relative(workspaceRoot, slimVsix).replace(/\\/g, "/");
  if (process.platform === "win32") {
    execFileSync(
      "cmd.exe",
      ["/d", "/s", "/c", `npx @vscode/vsce package --no-dependencies --no-yarn --out ${relativeSlimVsix}`],
      {
        cwd: workspaceRoot,
        stdio: "inherit"
      }
    );
    return;
  }

  execFileSync("npx", ["@vscode/vsce", "package", "--no-dependencies", "--no-yarn", "--out", relativeSlimVsix], {
    cwd: workspaceRoot,
    stdio: "inherit"
  });
}

function prepareTempRoot() {
  removeDirectory(tempRoot);
  fs.mkdirSync(tempRoot, { recursive: true });
}

function copyProductionDependencies(extensionDir) {
  const nodeModulesDir = path.join(extensionDir, "node_modules");
  fs.mkdirSync(nodeModulesDir, { recursive: true });

  const lockfile = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package-lock.json"), "utf8"));
  const packageEntries = lockfile.packages || {};

  for (const [packagePath, metadata] of Object.entries(packageEntries)) {
    if (!packagePath || !packagePath.startsWith("node_modules/")) {
      continue;
    }

    if (metadata && metadata.dev === true) {
      continue;
    }

    const sourcePath = path.join(workspaceRoot, packagePath);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const targetPath = path.join(extensionDir, packagePath);
    copyPathRecursively(sourcePath, targetPath);
  }
}

function copyPathRecursively(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const name of fs.readdirSync(sourcePath)) {
      copyPathRecursively(path.join(sourcePath, name), path.join(targetPath, name));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function expandArchive(zipPath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });
  runPowerShell(
    `Expand-Archive -LiteralPath '${escapePowerShell(zipPath)}' -DestinationPath '${escapePowerShell(destinationPath)}' -Force`
  );
}

function compressArchive(sourceGlob, destinationZipPath) {
  runPowerShell(
    `Compress-Archive -Path '${escapePowerShell(sourceGlob)}' -DestinationPath '${escapePowerShell(destinationZipPath)}' -Force`
  );
}

function removeDirectory(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore temp cleanup failures on Windows file-lock edge cases.
  }
}

function runPowerShell(command) {
  const shellExecutable = process.platform === "win32" ? "powershell.exe" : "pwsh";
  execFileSync(shellExecutable, ["-NoProfile", "-Command", command], {
    cwd: workspaceRoot,
    stdio: "inherit"
  });
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''");
}
