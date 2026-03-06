import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = pkg.version;

// 同步到 tauri.conf.json
const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
tauriConf.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// 同步到 Cargo.toml（仅替换 [package] 下的 version，不影响依赖项的 version）
let cargo = readFileSync('src-tauri/Cargo.toml', 'utf-8');
cargo = cargo.replace(
    /(\[package\]\s*\nname\s*=\s*"[^"]*"\s*\n)version\s*=\s*"[^"]*"/,
    `$1version = "${version}"`
);
writeFileSync('src-tauri/Cargo.toml', cargo);

console.log(`✅ Version synced to ${version}`);

// 如果传入 --commit 参数，自动提交版本变更
if (process.argv.includes('--commit')) {
    const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'];
    execSync(`git add ${files.join(' ')}`, { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to v${version}"`, { stdio: 'inherit' });
    console.log(`✅ Committed: chore: bump version to v${version}`);
}
