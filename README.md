# Debtbook Tauri App

This project wraps `Final.html` as a Tauri desktop application.

## Files

- `Final.html`: the original standalone website.
- `app/index.html`: the Tauri frontend copy with standard HTML metadata.
- `src-tauri/`: the Rust/Tauri desktop shell.

## Requirements

Install Rust before running or building the desktop app:

```powershell
winget install Rustlang.Rustup
```

After installing Rust, close and reopen PowerShell, then verify:

```powershell
rustc --version
cargo --version
```

## Run In Development

Use `npm.cmd` on this machine because PowerShell blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd run dev
```

## Build Windows App

```powershell
npm.cmd run build
```

The installer and executable will be generated under:

```text
src-tauri/target/release/bundle/
```

## Online Updates

The app checks this GitHub Releases endpoint on startup:

```text
https://github.com/ali208408/DebetManager/releases/latest/download/latest.json
```

To publish an update:

1. Increase `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Push the project to GitHub.
3. Run the `Release Desktop App` workflow, or let it run from a push to `main`.

GitHub Actions needs these repository secrets:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Use the private key from `.tauri/debtbook.key` as `TAURI_SIGNING_PRIVATE_KEY`.
