# KayKay's Milk Staff App

A cross-platform staff management app built with **React + Vite + Tauri v2**, targeting **Android**, **Windows**, and **Linux**.

---

## 🖥️ Desktop Builds (Windows `.exe` & Linux `.AppImage`/`.deb`)

Desktop installers are built automatically via **GitHub Actions** — both Windows and Linux run **in parallel** on every push to `main` or when you create a release tag.

### Artifacts produced

| Platform | Format | Description |
|---|---|---|
| Windows | `.exe` | NSIS setup wizard installer |
| Windows | `.msi` | Windows Installer package |
| Linux | `.AppImage` | Portable, runs on any distro (no install needed) |
| Linux | `.deb` | Debian/Ubuntu package installer |

---

### How to Download

#### Option A — From a GitHub Actions run (any push to `main`)
1. Go to your GitHub repo → **Actions** tab
2. Click the latest **"Build Desktop Installers"** run
3. Scroll to **Artifacts** at the bottom and download the one you need:
   - `KayKay-Windows-NSIS-Installer` → `.exe`
   - `KayKay-Linux-AppImage` → `.AppImage`
   - `KayKay-Linux-deb-Package` → `.deb`

#### Option B — From a GitHub Release (tagged version)
```bash
git tag v1.0.0 && git push origin v1.0.0
```
GitHub Actions builds all installers and attaches them to the Release automatically. Go to **Releases** on your repo page to download.

---

## 🔑 Required GitHub Secrets

Add these in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `VITE_AI_NAME` | Custom AI assistant name (e.g. `Kim`) |
| `VITE_UNSPLASH_ACCESS_KEY` | Unsplash API key (if used) |
| `GEMINI_API_KEY` | Google Gemini API key |

---

## 🤖 Local Desktop Development (Tauri)

```bash
# Install dependencies
npm install

# Start desktop dev mode (opens native window)
npm run tauri:dev

# Build native installer for your current OS
npm run tauri:build
```

> **Tip:** Running `npm run tauri:build` on Linux produces `.AppImage` + `.deb`. On Windows it produces `.exe` + `.msi`.

---

## 📱 Android Build

```bash
npm run android
```

Produces `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 🌐 Web Dev Server

```bash
npm run dev     # Start Vite dev server at http://localhost:3001
npm run build   # Build for web/Tauri production
```
