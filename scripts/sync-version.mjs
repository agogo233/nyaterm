import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = pkg.version;

// Change the version in tauri.conf.json
const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
tauriConf.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// Change the version in Cargo.toml
let cargo = readFileSync('src-tauri/Cargo.toml', 'utf-8');
cargo = cargo.replace(
    /(\[package\]\s*\nname\s*=\s*"[^"]*"\s*\n)version\s*=\s*"[^"]*"/,
    `$1version = "${version}"`
);
writeFileSync('src-tauri/Cargo.toml', cargo);

// Change the version in Cargo.lock
function updateDragonflyVersion(version) {
  const filePath = 'src-tauri/Cargo.lock';
  const content = readFileSync(filePath, 'utf-8');

  const pattern =
    /(\[\[package\]\]\r?\nname = "dragonfly"\r?\nversion = ")([^"]*)(")/;

  if (!pattern.test(content)) {
    throw new Error(
      'Could not find the version field for [[package]] name = "dragonfly" in src-tauri/Cargo.lock'
    );
  }

  const updated = content.replace(pattern, `$1${version}$3`);

  writeFileSync(filePath, updated, 'utf-8');
}
updateDragonflyVersion(version);

console.log(`✅ Version synced to ${version}`);

// If the --commit parameter is passed, automatically commit the version change
if (process.argv.includes('--commit')) {
    const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
    execSync(`git add ${files.join(' ')}`, { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to v${version}"`, { stdio: 'inherit' });
    console.log(`✅ Committed: chore: bump version to v${version}`);
}
