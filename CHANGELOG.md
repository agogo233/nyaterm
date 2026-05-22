# Changelog

All notable changes to this project will be documented in this file.

This changelog is inferred from release bump commits in git history (for example `chore: bump version to vX.Y.Z`) and grouped by Conventional Commit type.

## [1.0.7] - 2026-05-21

### Changed

- **appearance:** Improve font selection UI and show a `Loading system fonts...` state while system fonts are being discovered.
- **otp:** Improve OTP input slot layout and OTP code panel responsiveness on narrower screens.
- **profiles:** Add multiple Cargo build profiles for debugging and release workflows.

### Fixed

- **csp:** Correct CSP asset protocol handling so local assets such as background images load reliably.

### Performance

- **appearance:** Load system fonts asynchronously to keep the Appearance tab responsive.

## [1.0.6] - 2026-05-21

### Added

- **appearance:** Add `Background Image` customization for the main window, including `Image Sizing`, `Image Opacity`, and `Background Content Opacity` controls.
- **sessions:** Add `Backspace Mode` selection for Telnet and Serial sessions with `Ctrl+H (BS)` and `DEL (0x7F)` options.

### Changed

- **resource-monitor:** Refresh the resource monitor with clearer cards and improved visual hierarchy.

### Fixed

- **shortcuts:** Prevent Shift-modified terminal input from being mistaken for application shortcuts, restoring uppercase input such as `Shift+C`, `Shift+V`, and `Shift+X`.

## [1.0.5] - 2026-05-19

### Added

- **ai:** Capture AI command execution events and render inline terminal output during agent-driven workflows.
- **ai:** Add the `Terminal Output Lines` setting to control how many inline output lines are shown for AI-executed commands.
- **terminal:** Add AI Execution Profile selection to terminal session forms.
- **window:** Improve main-window modal management so child windows keep the workspace in a clearer modal state.

## [1.0.4] - 2026-05-19

### Added

- **cloud_sync:** Implement cloud synchronization features with encryption and logging.
- **ai:** Introduce AgentApprovalManager and refactor AI command handling.
- **session-management:** Enhance session management by adding initialGroupId support.

### Changed

- **ai:** Remove risk assessment features and AiRiskLevel from AI components and configuration.
- **i18n:** Update localization files for agent command execution and approval messages.
- **window:** Improve always-on-top logic for modal windows.
- **file-explorer:** Optimize file drop handling.
- **sftp:** Consolidate SFTP handling by removing SSH namespace and introducing new backend structure.
- **ssh-form:** Update SshForm and NewSessionPage for improved password handling and connection management.
- **cleanup:** Remove unused components and functions from AiTab and XTerminal.

## [1.0.3] - 2026-05-18

### Added

- **terminal:** Implement tab movement and unsplit functionality in terminal management.
- **zmodem:** Implement Zmodem file transfer commands, detection, and event handling.
- **shortcuts:** Implement customizable keyboard shortcuts and settings management.
- **window:** Enhance modal child window handling.
- **ai:** Enhance AI Assistant Panel with improved empty state handling.

### Changed

- **appearance:** Refactor font management and update default font settings.
- **i18n:** Add Zmodem transfer messages, terminal font family settings, keybindings, and AI setup instructions to localization files.
- **accessibility:** Add DialogDescription component to various dialogs.
- **theme:** Update color values in githubDark theme for improved consistency.

## [1.0.2] - 2026-05-17

### Added

- **credentials:** Implement credential management features with dialog and terminal autofill support.
- **security:** Enhance Password Management with Secret Unlocking Functionality and password reveal functionality.
- **terminal:** Add keyword highlighting settings and functionality in TerminalTab component.
- **clipboard:** Add CopyButton component for clipboard functionality.
- **tabbar:** Enhance TabBar component with dynamic tab visibility management and overflow handling.
- **templates:** Add issue templates for bug reports and feature requests.

### Changed

- **theme:** Update theme colors and CSS variables for improved consistency.
- **i18n:** Add localization entries for password management, search functionality, and hidden sessions.
- **ui:** Add required field indicators and improve label styling in session forms.
- **terminal:** Enhance ActionLinksAddon and KeywordHighlighter with improved timer management and refresh logic.
- **docs:** Enhance AI Assistant and security features in documentation.

## [1.0.1] - 2026-05-16

### Added

- **highlighting:** Add prompt highlighting support in keywordHighlightPresets.
- **app:** Integrate single instance support in Tauri application.
- **docs:** Add Umami analytics plugin to Docusaurus configuration.
- **ci:** Add GitHub Actions workflow for R2 asset publishing.

### Changed

- **file-explorer:** Clean up FileExplorer component by removing unused code and optimizing state management.
- **upload:** Simplify file upload handling in AutoUploadPage.
- **highlighting:** Update operator colors and regex pattern for keyword highlighting.
- **docs:** Update changelog with new releases and enhancements.
- **ci:** Update Docusaurus dependencies and remove optional Umami config.

## [1.0.0] - 2026-05-06

## [0.9.0] - 2026-04-30

## [0.8.5] - 2026-04-28

## [0.8.4] - 2026-04-27

## [0.8.3] - 2026-04-27

## [0.8.2] - 2026-04-23

### Added

- **tauri:** Add Windows configuration file and remove unused dragDropEnabled property.
- **file-transfer:** Enhance file transfer handling to support directories, including progress tracking and UI updates for directory transfers.
- **session-management:** Implement session-specific command history management, including fetching, listening, and clearing command history for improved user experience.

### Changed

- **i18n:** Add new file transfer messages for progress tracking and completion in English and Chinese locales.
- **header:** Update window control buttons with new icons and improved styling for better user experience.

### Fixed

- **saved-connections:** Implement drag-and-drop support for connection and group items, enhancing user interaction and organization.

### Performance

- **file-explorer:** Enhance FileExplorer component with memoization and scroll handling for improved performance and user experience.

### Documentation

- Update README and guides to include new features such as Windows drag-and-drop support, enhanced file transfer capabilities, and diagnostics settings for improved user experience.
- **file-transfer:** Refine drag-and-drop upload section for clarity and consistency across languages.

## [0.8.1] - 2026-04-23

### Added

- **interaction:** Add command suggestion min character limit settings and normalization logic for enhanced user control.
- **file-explorer:** Implement external file drop support on Windows using WebView2 for enhanced drag-and-drop functionality.

### Changed

- **i18n:** Add command suggestions min character limit settings to English and Chinese locales for enhanced user control.
- **file-transfer:** Optimize visibleTransfers calculation using useMemo for improved performance and sorting.
- **terminal:** Replace useApp with useTerminalAppSettings for improved settings management and consistency across terminal components.
- **sync-backup:** Update button size from icon-xs to icon-sm for improved UI consistency.
- **i18n:** Add external drop support messages for English and Chinese locales to improve user guidance during file uploads.

### Documentation

- Enhance documentation with new features including session import/export, diagnostics, and tray support for improved user experience and clarity.

## [0.8.0] - 2026-04-22

### Added

- **interaction:** Add command suggestion max character limit settings and normalization logic for improved user control over command suggestions.
- **quit_confirmation:** Implement QuitConfirmDialog for user confirmation before application exit, enhancing user experience and preventing accidental closures.
- **tray:** Implement tray functionality with window management and application quit command for enhanced user experience.

### Changed

- **i18n:** Add command suggestions max character limit settings to English and Chinese locales for improved user control.
- **syncbackup:** Enhance SyncBackupHistoryPanel with new UI components, improved history summary logic, and additional filtering options for better user experience.
- **i18n:** Add new history-related terms to English and Chinese locales for improved user experience and clarity.
- **scrollbar:** Add transparent background for scrollbar corner to improve UI consistency.
- **saved-connections:** Update layout and styling for improved responsiveness and visual consistency.
- **settings:** Remove emit calls for settings changes in ChildAppProvider and SettingsPage to streamline event handling.

## [0.7.9] - 2026-04-21

### Added

- **terminal:** Enhance terminal input handling by synchronizing input state from rendered lines and improving command processing logic.
- **syncbackup:** Implement SyncBackup functionality with UI components for managing cloud sync settings and history, enhancing user experience for backup management.
- **security:** Add master password management with dynamic state handling and improve input components for better user experience.
- **syncbackup:** Add validation for S3 endpoint requirement and improve UI feedback for draft settings, enhancing user experience in cloud sync management.
- **otp:** Integrate input-otp component for enhanced OTP input handling in OtpDialog, improving user experience with dynamic code length management.
- **cloud_sync:** Enhance error handling for WebDAV authentication by adding specific messaging for 401 errors and improving storage error mapping.
- **syncbackup:** Enhance SyncBackupHistoryPanel with filtering capabilities, improved state management, and UI updates for better user experience.

### Changed

- **terminal:** Remove unused input synchronization logic and streamline command sanitization process.
- **terminal:** Rename command tracking function and enhance command registration logic for improved input handling.
- **i18n:** Update English and Chinese locale files with new strings for sync and backup features, enhancing user interface and experience.
- **settings:** Restructure settings page with categorized groups, improved scroll handling, and dynamic tab management for enhanced user experience.
- **i18n:** Update zh-CN locale with new sync and backup history terms, enhance filtering options, and improve user prompts.

### Fixed

- **file-explorer:** Implement session caching for file explorer to maintain state across unmounts, enhancing user experience during navigation.

### Documentation

- Enhance documentation and UI for Sync & Backup features, including detailed guides, settings integration, and improved user experience for cross-device configuration and backup management.

## [0.7.8] - 2026-04-21

### Added

- **shell:** Implement command sanitization for terminal input and add terminal command utility functions.
- **session:** Refactor session input handling by introducing sendSessionInput function for improved command submission and preview management across components.
- **logging:** Introduce console usage linting and enhance error logging structure across components for improved diagnostics.
- **keywordhighlight:** Expand error and control flow patterns in keyword highlighting for enhanced diagnostics.
- **quickcommands:** Implement QuickCommandsStore for managing quick commands with in-memory caching and persistence, enhancing command upsert and retrieval functionality.

### Changed

- **observability, watcher, auth:** Apply consistent formatting and indentation across multiple functions for improved code readability.

### Performance

- Optimize context providers by utilizing useMemo for context values in AppContext, ChildAppProvider, and TransferProvider.

## [0.7.7] - 2026-04-15

### Added

- Implement import/export configuration functionality with UI updates in ImportDialog and Header components.
- **backup:** Add import/export functionality for configuration with encryption and rotation.
- **connections:** Add OpenGroupConnectionsDialog component and enhance connection item interactions with selection and context menu options.
- **panel:** Enhance QuickCommands component with improved search and category filtering UI.

### Changed

- **i18n:** Update English and Chinese translations for configuration import/export features and add new UI strings.
- **panel:** Update ActiveSessions component with improved styling for search input and icon.
- **panel:** Adjust width of dropdown menu in SavedConnections component for better UI consistency.

## [0.7.6] - 2026-04-15

### Added

- **ssh:** Improve SSH authentication logging and add known host key verification.
- **ssh:** Enhance SSH I/O loop with detailed exit status and signal logging.

### Changed

- Add 'des' crate dependency to Cargo.toml and update Cargo.lock.

### Fixed

- Restore import of SessionOutputCoalescer in pty.rs for proper session output handling.

### Documentation

- Update README with new features and enhancements including online search, translation, and improved SFTP file explorer.
- Enhance documentation with updates on terminal features, file transfer capabilities, and security enhancements including translation support and improved session management.

## [0.7.5] - 2026-04-14

### Added

- **connection:** Enhance session connection handling with improved error recovery and connection editing prompts.
- **ssh:** Enhance SSH form with password management and localization updates.

## [0.7.4] - 2026-04-14

### Added

- **updater:** Implement update dialog and background update check functionality.
- **header:** Enhance header component with update check functionality and new icons.
- **terminal:** Add suspended state handling to terminal components and output coalescing for improved performance under load.

### Changed

- Add @tauri-apps/plugin-process and @tauri-apps/plugin-updater dependencies to package.json and pnpm-lock.yaml.
- Clean up imports and improve formatting across multiple components for better readability.
- **i18n:** Add updater localization for English and Chinese, including update status messages.
- **i18n:** Add localization for large output protection messages in English and Chinese.

## [0.7.3] - 2026-04-14

### Added

- **keywordhighlightpresets:** Expand success patterns to include additional keywords for improved matching.
- **connection-management:** Implement error handling for connection failures, adding support for marking tabs and panes as failed while maintaining layout integrity.
- **file-explorer:** Implement directory history management and enhance selection handling.
- **file-transfer:** Add pause, resume, and cancel functionality for file transfers with updated context and UI components.

### Changed

- **i18n:** Add connection failure messages in English and Chinese localization.
- **file-explorer:** Update selection handling methods and improve context menu interactions.
- **i18n:** Update English and Chinese localization for file transfer actions including cancel, pause, resume, and delete.

## [0.7.2] - 2026-04-14

### Added

- **interaction-settings:** Add command suggestions toggle to InteractionTab and integrate with app settings.
- **logging:** Implement persistent logging for warn and error levels, add Tauri command to handle log writing.
- **file-explorer:** Enhance keyboard interaction by adding delete functionality and focus management for the file list.
- **sftp:** Enhance remote file operations with detailed logging and permission handling.

### Changed

- **file-explorer:** Replace invoke import with local library and add autoFocus to delete button for improved accessibility.
- **file-explorer:** Replace invoke import with local library across multiple dialog components for consistency.
- **i18n:** Add command suggestions localization in English and Chinese.

### Fixed

- **keywordhighlightpresets:** Update duration regex to include shorthand units for better matching.

### Documentation

- Update CLAUDE.md and README.md to clarify commands for building and serving the docs site, including locale-specific hot reload options.

## [0.7.1] - 2026-04-13

### Added

- **clipboard:** Implement readClipboardText function and update terminal components to use it for clipboard access.
- **demos:** Add various demo scripts for showcasing NyaTerm's terminal features, including action links, file watching, keyword highlighting, and structured output.
- **activesessions:** Enhance ActiveSessions component with search functionality, session reconnect/disconnect actions, and improved UI for session display.
- **file-explorer:** Refactor DeleteDialog to handle multiple file deletions and improve UI; update FileExplorer to support batch delete actions.
- **resource-monitor:** Implement refresh button and improve stats fetching with async/await; add loading state management.
- **modal-management:** Refactor modal child window handling to improve focus enforcement and state tracking; add reconnect and disconnect session functionality in ActiveSessions component.
- **activesessions:** Simplify PanelHeader actions by removing unnecessary wrapper div for session count display.
- **resource-monitor:** Enhance refresh button with tooltip and rename state variable for clarity.

### Changed

- **i18n:** Update zh-CN and en.json for activeSessions and file deletion messages.

### Documentation

- Update README and user guides to enhance clarity on NyaTerm's features, session types, and terminal capabilities; add new sections for workspace layout, security, and network configurations.
- **sidebars:** Update guide sections to include new topics on session types, layout, and authentication while reorganizing existing items for better clarity.

## [0.7.0] - 2026-04-12

### Added

- Enhance terminal workspace with new tab management and pane functionality.
- **crypto:** Implement master password wrapping key cryptosystem.
- **app:** Restore cryptographic master password state on app startup.
- **config:** Introduce proxy_jump_id field and circular-dependency validation.
- **ssh:** Implement multi-hop proxy jump routing via direct-tcpip channel.
- **ui:** Integrate jump host configuration into SSH session dialog.
- **shell:** Upgrade serial sender into unified shell command broadcaster.
- **explorer:** Restrict file explorer to SSH sessions and show unsupported message.
- **tabbar:** Add unread indicator with breathing animation and extend TabBarProps.
- **unreadtracking:** Implement unread session output tracking and update TabWindowsWorkspace to display unread tab IDs.
- **terminal:** Add TerminalGutter component for displaying line numbers and timestamps; update settings to disable action links by default.

### Changed

- **window:** Enable transparent window background in tauri config.
- **ssh:** Reduce default keepalive interval from 60s to 3s.
- **config:** Format ui configuration tuple structures.
- **security:** Migrate lock_password to unified master_password definitions.
- **ssh:** Decouple single session handle into multi-tiered SshConnectionHandles.
- **panel:** Migrate QuickCommands and SerialSendPanel to panel module.
- **ui:** Remove legacy fullscreen shortcuts and redundant menu entries.
- **panel:** Adjust active sessions count indicator formatting.
- Commit remaining changes.
- **keywordhighlight:** Update token boundary handling to remove conflicts.
- **i18n:** Add line numbers and timestamps options to terminal settings.

### Fixed

- **otp:** Properly decode multi-byte utf-8 characters in url encoding.
- **ssh:** Prevent prompt injection scripts from polluting shell history.
- **session:** Silently ignore not-found error during session close.
- **terminal:** Suppress errors when attaching to terminating sessions.
- **terminal:** Prevent dismissing suggestions when there are no active suggestions or selection.
- **settings:** Disable keyword highlights and action links by default in terminal settings.

### Performance

- Only remove workspace tabs from UI after successful close.
- Make split-window session placement explicit.
- Reduce unnecessary re-renders in terminal workspace.

### Documentation

- Add CLAUDE.md for development guidance and architecture overview.

## [0.6.1] - 2026-04-11

### Changed

- Update version synchronization in sync-version script.
- Update nyaterm dependency version to 0.6.0.

## [0.6.0] - 2026-04-11

### Added

- **proxy:** Standalone proxy and tunnel management.
- **sftp:** Enhance file transfer with concurrency, retries, and timestamps.
- **ui:** Implement network panel and settings restructuring.
- Implement Tauri commands for secure app settings management and password verification.
- **network:** Enhance tunnel configuration UI.
- Add session recording and custom transfer preferences.
- **ui:** Add OtpDialog for two-factor authentication support.
- **core:** Implement OTP interaction with PendingAuthManager and commands.
- **ui:** Implement OSC7 CWD tracking support and UI disabled states.
- **ui:** Integrate OtpDialog into main app layout with i18n support.
- **transfer:** Open download path from transfer footer.
- **security:** Add tab count display and update Key/Password management tabs to report counts.
- **ssh-form:** Enhance SSH form with proxy and OTP configuration options.
- **otp:** Implement OTP management and integration with UI components.
- **prettier:** Add Prettier configuration for JSON sorting and update package scripts for i18n checks.
- **search:** Add show_in_menu property to SearchEngine and enhance SearchTab with collapsible UI for custom engines.
- **session:** Launch local, telnet, and serial connections by type.
- **serial:** Show detected serial ports in the session editor.
- **serial:** Add bottom serial send panel.

### Changed

- **ui:** Introduce shadcn UI components.
- **i18n:** Update translations for network and transfer features.
- **translate:** Minor module dependency updates for translate API.
- Format session proxy imports.
- Adjust panel header actions layout.
- **deps:** Bump russh to 0.60.
- **ui:** Rename saved-connections dialog directory to connections.
- **core:** Reorganize module structure for ssh, runtime, and import.
- Update internal imports and finalize ssh module extraction.
- **core:** Adopt new ssh and runtime module structures.
- **ui:** Update import path in Header for new connections directory.
- Restructure command modules and update import paths for improved organization.
- **config:** Rename storage modules and split settings config.
- **runtime:** Extract tauri bootstrap and command adapters.
- **core:** Extract history store and unify error imports.
- **session-dialog:** Make new session forms responsive.
- **dialog:** Improve quick command and auto upload layouts.
- **settings:** Introduce responsive settings shell.
- **settings-search:** Reflow custom search engine editor.
- **settings-terminal:** Reflow action link and highlight editors.
- **panel:** Polish mobile panels and auth tabs.
- **core:** Export watcher module.
- **rust:** Normalize backend formatting.
- **i18n:** Normalize english sort labels.
- **otp:** Vendor local hotp and totp crate.
- **format:** Remove trailing whitespace artifacts.
- **format:** Trim trailing blank line in translate core.
- **quick-commands:** Clean up formatting and improve tooltip component structure.
- **resource-monitor:** Improve code formatting and structure for better readability.
- **settings:** Restructure settings components to use SettingSection for better organization and readability.
- Reorganize file explorer, auth and save-connections components.
- **connection:** Normalize saved connection schema into typed config blocks.
- **saved-connections:** Extract tooltip-backed header action button.
- **file-explorer:** Reuse tooltip icon buttons in the toolbar.
- **i18n:** Remove deprecated default local shell labels.
- **frontend:** Normalize panel imports and minor cleanup.
- **rust:** Isolate import reordering and line-wrap churn.
- **file-explorer:** Wrap dialog import for consistency.
- Introduce FileUploadPage and update routing to replace AutoUploadPage.

### Fixed

- **ssh:** Resolve concurrent SshHandler access using Mutex.
- **security:** Add app scope to temp dir capabilities.
- **ui:** Handle xterm buffer trimming in keyword highlighter cache.
- **i18n:** Correct Chinese translations for various UI strings.
- **explorer:** Normalize cwd paths before syncing directories.
- **panel:** Update default tab in SecurityAuthPanel from passwords to keys.
- **ssh:** Use character escapes for PowerShell OSC integration.
- **select:** Allow trigger content to shrink and truncate in narrow layouts.
- **session-ui:** Restrict SSH-only panels and clarify path-sync messaging.
- **session-editor:** Reset local terminal defaults when clearing the form.
- **i18n:** Update serial port messages and reintroduce serial send localization.

## [0.5.0] - 2026-04-07

### Added

- **window:** Implement child window modal management and overlay.
- **auth:** Add managed password store for SSH sessions.
- **stats:** Add remote resource monitor for SSH sessions.
- **sftp:** Add recursive directory transfer commands.

### Changed

- Update styling for tab borders and shadows.
- **ui:** Adopt activity bar layout and custom window chrome.

### Fixed

- **i18n:** Refine experimental keyword highlighting description in Chinese locale.
- **terminal:** Reconnect SSH tabs after disconnect.

## [0.4.0] - 2026-04-03

### Added

- Implement ChildWindowRouter and enhance window management with i18n support.
- Enhance keyword highlighting settings and functionality.
- Update word separators in interaction settings for improved parsing.
- Enhance file transfer functionality and loading state management.
- Add keyword highlight setting for wrapped lines in TerminalTab.
- **session:** Add multi-protocol tabs to new session form.
- **file-explorer:** Open auto-upload prompts in child windows.
- **appearance:** Support dedicated terminal themes and font scaling.
- **terminal:** Add actionable links and hover menus.

### Changed

- Update project URLs and enhance build script.
- **i18n:** Add 'Built-in' font label to English and Chinese translations.
- **ui:** Polish tab chrome and refresh connection icons.

### Fixed

- **app:** Stabilize active tab state and terminal defaults.
- **keywordhighlight:** Improve built-in matching and cell mapping.
- **build:** Align Vite typing and path alias settings.

### Documentation

- Add Docusaurus documentation site with bilingual support.
- Redesign homepage and fix i18n issues.

## [0.3.5] - 2026-03-09

### Fixed

- **keywordhighlight:** Enhance datetime and number patterns for better matching accuracy.

## [0.3.4] - 2026-03-09

### Changed

- **terminal:** Replace kbd elements with Kbd component for consistency in CommandSuggestions and ContextMenu.

## [0.3.3] - 2026-03-09

### Added

- **terminal:** Add keyword highlighting feature.
- **connections:** Add edit option to connection item context menu.
- **settings:** Support navigating to specific settings tab and auto-refresh ssh keys on focus.
- **shortcuts:** Implement global keyboard shortcuts for terminal and UI actions.

### Changed

- Sync version in Cargo.lock and update commit files list.
- **terminal:** Improve TabBar close button UI and hover states.
- **terminal:** Use React.RefObject instead of MutableRefObject for terminal refs.
- **theme:** Update terminal cursor colors for githubLight and nordLight themes.

### Fixed

- **terminal:** Re-initialize WebGL addon on hardware acceleration toggle.
- **ssh:** Prevent OSC 7 injection from polluting bash history.

## [0.2.1] - 2026-03-06

### Added

- **session-management:** Enhance session handling with auto-connect feature.
- **types:** Add comprehensive global types for session management and UI configuration.
- **file-explorer:** Add dialogs for creating new files, folders, and symlinks.
- **translate:** Implement dynamic TKK generation for Google Translate.
- **file-explorer:** Implement terminal path synchronization feature.

### Changed

- Relocate themes and types to lib directory.
- Update `.gitignore` to include additional file patterns.
- Update import paths and enhance translation settings.
- Update import paths to global types.
- **icons:** Consolidate file icon logic and enhance icon imports.

## [0.1.5] - 2026-03-06

### Added

- **ui:** Implement zoom level persistence and view settings.
- **ui:** Add clickable homepage and issues links to about dialog.
- **ui:** Enhance header menu with icons and new Help options for documentation and logs.
- **logging:** Enhance tracing initialization with rolling file appender and update log permissions.
- **window:** Show application window on startup and update tauri configuration to allow window visibility.
- **connections:** Add the SavedConnections panel for grouped SSH connection management.
- **watcher:** Add file watcher support and chunked file transfer progress tracking.
- **file-explorer:** Integrate custom dialogs and context menu support.
- **settings:** Implement global settings dialog and localization.
- **terminal:** Add terminal context menu utilities and search bar.
- **security:** Add lock screen and lock password encryption.
- **quick-commands:** Redesign quick commands UI with icons and variables support.
- **file-transfer:** Add file properties dialog and transfer progress bar.
- **settings:** Add translation settings and a tabbed settings/about experience.
- **translate:** Add TranslationTab and multi-provider translation service.
- **terminal:** Enhance XTerminal with URL opening and better command history handling.
- **app:** Introduce global application context and broader i18n support.
- **search:** Add search engine icons and improve search tab configuration UI.
- **import:** Add session import from Xshell, MobaXterm, and WindTerm.
- **ui:** Add command palette, popover, and draggable panel components.
- **icons:** Expand the icon system and update type definitions.
- **connections:** Enhance connection handling, feedback, sorting, and drag-and-drop.
- **config:** Add screen lock and connection sort mode settings.
- **security:** Implement screen lock toggle and idle detection.
- **suggestions:** Enhance command suggestions with multi-provider support.
- **event-listeners:** Replace polling with event listeners for session and command history updates.

### Changed

- Add MIT License file.
- **assets:** Update app icons, logo assets, and remove unused SVGs.
- **cleanup:** Update tauri config and remove unused assets.
- **i18n:** Integrate i18next across the application.
- **ui:** Update page title from `NyaTerm Terminal` to `NyaTerm`.
- Update scrollbar styling.
- Update global UI, layout visibility, and theme configuration.
- Adopt shadcn/ui components.
- Migrate toast notifications to sonner and use shadcn context menus.
- Update settings dialog to use switches and a tabbed interface.
- **i18n:** Update localizations for new components and features.
- Update typography, CSS variables, theme colors, and section headers.
- Update dependencies, shared utils, types, UI components, and panels.
- **backend:** Modularize config and commands into submodules.
- **theme:** Overhaul the theme system with CSS variables and preset themes.
- **dialog:** Reorganize dialogs into domain-specific subdirectories.
- **settings:** Update settings tabs for the new config structure.
- **app:** Refresh App, contexts, layout, and panel components.
- **i18n:** Add locale keys for newly introduced settings and UI flows.
- **window:** Migrate dialogs to independent child windows.
- **file-explorer:** Modularize the file tree and replace native dialogs.
- **terminal:** Clean up formatting and whitespace issues.
- **tracing:** Improve local time formatting and remove inline key migration.
- **dialogs:** Remove NewSessionDialog, SettingsDialog, and QuickCommandDialog.
- **components:** Extract settings components and standardize import paths.
- Delete generated build output from the repository.
- Bump version to `0.1.5` and add version synchronization script.

### Fixed

- Resolve dialog accessibility warnings.
- Update translation key usage in SearchTab for clearer settings descriptions.
- Improve session handling and UI responsiveness.
- **settings:** Update default interaction settings for copy and paste.
- **translations:** Remove fallback values from translation keys in dialogs and components.

### Performance

- **sftp,ssh:** Optimize transfer speeds and add symlink support.

### Documentation

- Update README with key features and usage instructions.
- Remove the trailing period from the README tagline.
