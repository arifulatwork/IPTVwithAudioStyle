# 📺 Nazat Stream

> **Live. Global. Yours** — A React Native live TV & streaming app built with Expo.

---

## ✨ Features

- 🔴 **Live HLS Streams** — Watch m3u8 channels with native controls
- 📺 **YouTube Playback** — Inline YouTube player with fallback to app
- ⭐ **Favorites** — Star your channels, persisted across sessions
- 🔍 **Search** — Filter channels instantly by name or type
- 🔒 **Background Audio** — Audio keeps playing when screen locks
- 📱 **Picture-in-Picture** — Press Home while watching for PiP
- 🌐 **Dynamic Channel List** — Loaded from a remote JSON (GitHub Gist)
- 🌙 **Dark Theme** — Cinematic deep-navy UI

---

## 📱 Screenshots

> Add screenshots here after building the app.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Expo Go](https://expo.dev/client) app on your phone (for development)

### Install

```bash
git clone https://github.com/your-username/nazat-stream.git
cd nazat-stream
npm install
```

### Run (Development)

```bash
npx expo start
```

Scan the QR code with **Expo Go** on Android, or the **Camera app** on iOS.

---

## 📦 Build APK (Android)

### Option A — Cloud Build (Recommended, no Android Studio needed)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo account (create free at expo.dev)
eas login

# Configure EAS
eas build:configure

# Build APK
eas build --platform android --profile preview
```

Wait 5–15 minutes. Download link will appear in terminal and at [expo.dev](https://expo.dev).

### Option B — Local Build

```bash
# Requires Android Studio installed
npx expo run:android
```

---

## 🏗️ Project Structure

```
nazat-stream/
├── App.tsx              # Main app — all components and logic
├── app.json             # Expo config (name, icons, permissions)
├── assets/
│   ├── logo.png         # App icon
│   ├── adaptive-icon.png
│   └── favicon.png
├── package.json
└── README.md
```

---

## ⚙️ Configuration

### Channel List

Channels are loaded from a remote JSON file. Edit the `GIST_URL` constant in `App.tsx`:

```ts
const GIST_URL = "https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/tv.json";
```

### JSON Format

Your Gist should return a JSON object where each key is a category name:

```json
{
  "Sports": [
    {
      "text": "ESPN",
      "image": "https://example.com/espn-logo.png",
      "videoUrl": "https://example.com/stream.m3u8",
      "type": "m3u8"
    },
    {
      "text": "ESPN YouTube",
      "image": "https://example.com/espn-logo.png",
      "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
      "type": "youtube"
    }
  ],
  "News": [
    ...
  ]
}
```

| Field      | Type                  | Description                        |
|------------|-----------------------|------------------------------------|
| `text`     | `string`              | Channel name                       |
| `image`    | `string` (URL)        | Channel logo image                 |
| `videoUrl` | `string` (URL)        | HLS stream URL or YouTube URL      |
| `type`     | `"m3u8"` \| `"youtube"` | Stream type                     |

---

## 📋 Tech Stack

| Package | Purpose |
|---|---|
| `expo` | App framework |
| `expo-av` | HLS video & background audio |
| `expo-linear-gradient` | UI gradients |
| `expo-screen-orientation` | Landscape lock in player |
| `expo-keep-awake` | Screen stays on while watching |
| `react-native-youtube-iframe` | YouTube inline player |
| `@react-native-async-storage/async-storage` | Favorites persistence |
| `react-native-safe-area-context` | Safe area insets |

---

## 🔒 Background Playback

### Android
Audio continues automatically when the screen locks. No extra steps needed.

### iOS
Audio continues when screen locks thanks to `UIBackgroundModes: audio` in `app.json`.

> **Note:** Full PiP (video on lock screen) requires a native development build via EAS. Expo Go only supports background audio.

---

## 🛠️ Development Notes

- **Expo Go** — Works for development. Background audio works. PiP does **not** work in Expo Go.
- **Development Build / EAS** — Required for full PiP support (`expo-video` with `allowsPictureInPicture`).
- **expo-av** is deprecated as of SDK 54 — future versions should migrate to `expo-audio` + `expo-video`.

---

## 📄 License

MIT © Nazat Stream

---

## 🙏 Credits

Built with [Expo](https://expo.dev) · Streams powered by community HLS sources