# CanChat Local Archive

| Pipeline Status|
| --- |
|[![CI](https://github.com/KingBain/canchat-local-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/KingBain/canchat-local-archive/actions/workflows/ci.yml) [![Release Please](https://github.com/KingBain/canchat-local-archive/actions/workflows/release.yml/badge.svg)](https://github.com/KingBain/canchat-local-archive/actions/workflows/release.yml) [![Coveralls](https://github.com/KingBain/canchat-local-archive/actions/workflows/coveralls.yml/badge.svg)](https://github.com/KingBain/canchat-local-archive/actions/workflows/coveralls.yml)  [![Coverage Status](https://coveralls.io/repos/github/KingBain/canchat-local-archive/badge.svg?branch=codex/fix-coveralls-action-for-pull-requests)](https://coveralls.io/github/KingBain/canchat-local-archive?branch=codex/fix-coveralls-action-for-pull-requests)|


> **⚠️ DISCLAIMER: This is NOT an official Government of Canada project.** This is an independent, community-driven browser extension.
>
> _Note: The code for this project was heavily developed with the assistance of Large Language Models (LLMs)._

A Chrome/Edge browser extension that automatically archives, searches, and restores your conversations from **CANChat** and **Open WebUI** environments.

Because many enterprise and government AI chat instances have strict data retention policies or periodically delete old conversations, this extension acts as your personal, local safety net. It saves your chats directly to your browser's localStorage and allows you to restore them to the server at any time.

## 🌟 Features

- **🤖 Auto-Backups:** Automatically syncs your active conversations to your browser's local IndexedDB in the background. You never have to remember to hit "save". Backups are triggered seamlessly when you:
  - **Chat actively:** Auto-saves every 2 minutes while the CanChat tab is open.
  - **Change chats:** Captures data instantly when you click between different conversations.
  - **Switch tabs:** Saves your progress the moment you click away to another browser tab.
  - **Leave the site:** Ensures a final sync occurs if you close the window or navigate to another site.
- **🔍 Smart Full-Text Search:** A dedicated archive page to search through the actual plain-text history of all your past and deleted conversations.
- **🔁 One-Click Restore:** Accidentally deleted a chat? Retention policy wiped it? Click "Restore" to perfectly reconstruct the chat (with full history and branching) back onto the live server.
- **🗂️ Native Side Panel:** Quick access to your locally archived and deleted chats right from your browser's native right-hand side panel.
- **📄 Export Options:** Export your archived conversations as raw JSON or beautifully formatted Markdown files.
- **🔒 100% Local & Private:** Your data never leaves your machine. All backups are stored securely within your browser's profile data.

## 📥 Installation

Currently, this extension must be loaded as an "Unpacked Extension" in Developer Mode.

1. **Download the code:** Clone this repository or download it as a ZIP file and extract it.
2. **Open Extension Manager:**
   - **Chrome:** Navigate to `chrome://extensions/`
   - **Edge:** Navigate to `edge://extensions/`
3. **Enable Developer Mode:** Toggle the "Developer mode" switch in the top right corner (Chrome) or bottom left (Edge).
4. **Load the Extension:** Click the **"Load unpacked"** button and select the folder where you extracted this repository.
5. **Pin the Extension:** Click the puzzle piece icon in your browser toolbar and pin **CanChat Local Archive** for easy access.

## 🚀 How to Use

1. **Configure your URL:** Click the extension icon in your browser toolbar. Enter the base URL of your CANChat or Open WebUI instance (e.g., `https://chat.example.com`) and click **Save & Test**.
2. **Open the Side Panel:** Click the Side Panel icon in your browser toolbar (usually next to your profile picture) and select "CanChat Local Archive" from the dropdown to see your abbreviated archive list.
3. **Search & Manage:** From the extension popup, click **Open archive page** to view the full-screen dashboard where you can search through message histories, filter by status, and export to Markdown.

## 🛠️ Built For

This extension interacts with the APIs of the following open-source projects:

- **[Open WebUI](https://github.com/open-webui/open-webui)**: An extensible, feature-rich, and user-friendly self-hosted WebUI for LLMs.
- **CANChat**: A specialized fork/deployment of Open WebUI utilized in Canadian enterprise/government contexts.

## 🛡️ Privacy & Governance

- Data is stored locally in your browser (`IndexedDB`) and remains strictly under your device profile.
- This extension **does not** bypass official CANChat retention, deletion, or legal hold controls on the server.
- Restoring a chat creates a _new_ conversation record on the server based on your local data; it does not undelete the original database row on the backend.

## 🤝 Contributing

Feel free to submit issues or pull requests. Since this project was largely bootstrapped via LLMs, human refactoring, UI polish, and edge-case testing are highly welcomed!
