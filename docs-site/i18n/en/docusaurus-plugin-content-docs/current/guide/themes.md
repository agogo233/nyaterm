---
sidebar_position: 5
---

# Themes & Appearance

NyaTerm lets you tune the workspace appearance in fairly fine detail, including UI theme, terminal theme, fonts, and cursor behavior.

## UI theme and terminal theme

In **Settings → Appearance**, you can configure these separately:

- **UI Theme** — controls the app-wide color scheme
- **Terminal Theme** — controls terminal colors, or can follow the UI theme

If you just want a quick theme switch, you can also use **View → Theme** from the top menu.

## Background image

In **Settings → Appearance**, the main window can now use a local wallpaper. The controls are easiest to follow by their exact UI names:

- `Background Image` — choose the local file rendered behind the main workspace
- `Image Sizing` — choose how the image is shown with `cover`, `contain`, `stretch`, or `tile`
- `Image Opacity` — control how strongly the wallpaper shows through the theme
- `Background Content Opacity` — control how translucent workspace panels and content surfaces become

This only affects the main window workspace. Settings and child windows stay solid so forms, dialogs, and secondary windows remain readable.

## Fonts and font size

In **Settings → Appearance**, you can adjust:

- **Font family** — primary font plus multi-level fallback fonts
- **Terminal font size**
- **UI font size**

NyaTerm includes these built-in fonts:

- `JetBrains Mono`
- `Noto Sans SC Variable`
- `Inter`

System-installed fonts are also listed so you can extend the fallback chain.

System font discovery now runs asynchronously, so you may briefly see `Loading system fonts...` when opening the font picker. That simply means the app is still collecting installed fonts in the background.

## Cursor and ligatures

Appearance settings also expose terminal details such as:

- **Cursor style** — Block / Underline / Bar
- **Cursor blink**
- **Font ligatures**

If you switch between dark and light themes often, it is worth checking the terminal theme together with keyword highlighting and action links so the overall result stays readable.

## Language switching

NyaTerm currently provides:

- Simplified Chinese
- English

You can switch language in either of these places:

- **Settings → General → Language**
- **View → Language** in the top menu

## Panels and workspace appearance

Besides colors and fonts, the workspace itself can be tuned to match your habits:

- Left and right panel widths are resizable
- Split ratios inside a tab are resizable
- Left and right activity bars can be shown or hidden quickly with shortcuts

These layout states are saved with app settings, which makes it practical to keep a preferred long-term workspace arrangement.

## Zoom and quick adjustments

NyaTerm provides these common shortcuts:

- **Zoom In** — `Ctrl / Cmd + =`
- **Zoom Out** — `Ctrl / Cmd + -`
- **Reset Zoom** — `Ctrl / Cmd + 0`

These are especially useful for demos, screen sharing, or high-DPI displays.
