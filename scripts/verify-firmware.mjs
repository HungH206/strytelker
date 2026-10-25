import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "toyo-firmware-"));
try {
  const executable = join(directory, "firmware-check");
  const compiler = spawnSync(
    "c++",
    ["-std=c++17", "tests/firmware.cpp", "-o", executable],
    { stdio: "inherit" },
  );
  if (compiler.error) throw compiler.error;
  if (compiler.status !== 0) process.exitCode = compiler.status || 1;
  else {
    const result = spawnSync(executable, [], { stdio: "inherit" });
    process.exitCode = result.status || (result.error ? 1 : 0);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
