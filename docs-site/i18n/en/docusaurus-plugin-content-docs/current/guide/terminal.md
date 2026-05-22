---
sidebar_position: 3
---

# Terminal Features

NyaTerm's terminal experience is designed around high-frequency local and remote work inside one workspace. It is built on xterm.js, but the practical experience goes beyond a terminal canvas: search, command history, suggestions, optional enhancements, recording, and SSH-aware helpers are all part of it.

## Core operations

### Search, copy, and the context menu

The terminal context menu exposes these frequent actions directly:

- Copy / Paste
- Paste selected text
- Find text
- Search selected text online
- Translate selected text with a provider
- Clear screen / Clear all
- Select all

In **Settings → Interaction**, you can also adjust:

- **Copy on select**
- **Right-click paste**
- Word separators
- Default character encoding

### Scrollback and fonts

- The default scrollback buffer keeps **10000 lines**
- You can customize font family, font size, ligatures, cursor style, and cursor blink
- **Hardware acceleration** is optional and is **not enabled by default**; you can toggle it manually in **Settings → Terminal** if you want to compare rendering behavior

## Command history and suggestions

NyaTerm provides two related helpers for session workflows.

### Command history

- Commands entered in the terminal are recorded automatically
- Fuzzy search is supported
- You can review history from the **Command History** panel on the right

### Input suggestions

While typing, NyaTerm can suggest commands based on history. This is useful for repeated operational commands, build commands, and troubleshooting scripts.

## AI Assistant from the terminal

NyaTerm can invoke AI workflows directly from terminal context instead of forcing you to copy text into a separate tool.

### Common entry points

- **Explain recent output** when you want the latest terminal activity summarized immediately
- **Explain selected text** for a highlighted log fragment or command result
- **Analyze error** when terminal output already contains a failure you want help with
- **Generate command** when you want AI to propose the next step from the current session context

### Inline terminal capture

During Agent execution, NyaTerm can capture AI command execution events and show a compact inline preview of command output close to the terminal workflow.

The amount of inline output is controlled by `Terminal Output Lines` in **Settings → AI → Agent Settings**:

- `Terminal Output Lines` sets how many output lines are shown after each AI-executed command
- Set it to `0` to disable inline terminal previews
- This setting changes the AI workflow feedback, not the underlying shell execution itself

## Optional terminal enhancements

These features are intentionally opt-in rather than enabled all at once.

### Line numbers and timestamp gutter

In **Settings → Terminal**, you can enable:

- **Show line numbers**
- **Show timestamps**

When enabled, a gutter appears on the left side of terminal output. It is especially useful for long logs, command output, and recorded sessions.

### Action links

Action links are off by default. When enabled, NyaTerm can detect and open patterns such as:

- IPv4 addresses like `192.168.1.10`
- `host:port` pairs like `db.internal:5432`
- Archive names like `backup.tar.gz`

Notes:

- First enable **Action Links** in **Settings → Terminal**
- Opening a link requires **Ctrl / Cmd + click** to avoid conflicts with normal text selection
- The three matcher groups can be enabled or disabled separately

### Keyword highlighting

Keyword highlighting is also off by default. After enabling it, NyaTerm applies built-in rules and then overlays your custom rules.

The built-in rules cover more than error keywords. They also include:

- Common state words such as error / warn / success / info / debug
- Dates and times
- Numbers, sizes, and durations
- Structured text such as addresses, URLs, UUIDs, and versions

You can define your own rules with:

- A custom rule name
- Separate colors for dark and light themes
- One matching pattern per line
- An option to continue matching across wrapped lines

### Large-output protection

When a session produces too much output too quickly, NyaTerm can enter a temporary protection mode so the terminal remains responsive.

During that period, the app temporarily suppresses some expensive decorations and reports how many queued characters were skipped. Once pressure drops, normal rendering resumes. This is mainly intended for log storms or constantly streaming output.

## SSH-specific helpers

### Keep-Alive

For SSH sessions, you can configure a Keep-Alive interval in **Settings → Terminal**:

- Default is **60 seconds**
- Set it to `0` to disable it
- Useful for reducing idle disconnects on long-lived sessions

### Remote resource monitoring

Remote resource monitoring is not shown globally by default. To use it, both of these must be true:

1. The current tab is an **SSH session**
2. **Show Remote Resource Stats** is enabled in **Settings → Terminal**

When enabled, the **Resource Monitor** panel polls the host on the configured interval. The default interval is **3 seconds**, and you can change it manually.

The panel displays:

- Hostname, OS, architecture, uptime
- Load average
- CPU usage
- Memory usage
- Network throughput

## Translation and online search

After selecting text in the terminal, you can use the context menu to:

- Send the selection to an online search engine
- Open a translation dialog with an enabled translation provider

Provider visibility depends on settings:

- **Google** and **Microsoft** work without extra credentials
- **DeepL / Baidu / Alibaba / Youdao** appear after you enter credentials in **Settings → Translation**

## Recording and workflow combinations

NyaTerm supports session recording, which is useful for:

- Preserving troubleshooting steps
- Sharing a reproducible path with teammates
- Capturing terminal examples with visible timing

If you are preparing screenshots or demos, a good combination is:

- Line numbers / timestamp gutter
- Keyword highlighting
- Action links
- Command history
- Resource monitor

That usually gives a more realistic screenshot than showing one toggle in isolation.

:::tip Screenshot suggestion
- Suggested image path: `/img/docs/terminal/gutter-line-numbers-timestamps.png`
- Enable line numbers and timestamps in **Settings → Terminal**, then run `scripts/demo-terminal-gutter.sh`
- Another good image path: `/img/docs/terminal/action-links-and-highlights.png`
- Enable action links and keyword highlighting, then run `scripts/demo-terminal-output.sh` and `scripts/demo-action-links.sh`
:::
