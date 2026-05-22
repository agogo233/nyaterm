export type ChangelogSection = {
  title: string;
  items: string[];
};

export type ChangelogRelease = {
  version: string;
  sections: ChangelogSection[];
};

const changelogReleasesEn: ChangelogRelease[] = [
  {
    version: '[1.0.7] - 2026-05-21',
    sections: [
      {
        title: 'Changed',
        items: [
          '**appearance:** Improve font selection UI and show a `Loading system fonts...` state while system fonts are being discovered.',
          '**otp:** Improve OTP input slot layout and OTP code panel responsiveness on narrower screens.',
          '**profiles:** Add multiple Cargo build profiles for debugging and release workflows.',
        ],
      },
      {
        title: 'Fixed',
        items: ['**csp:** Correct CSP asset protocol handling so local assets such as background images load reliably.'],
      },
      {
        title: 'Performance',
        items: ['**appearance:** Load system fonts asynchronously to keep the Appearance tab responsive.'],
      },
    ],
  },
  {
    version: '[1.0.6] - 2026-05-21',
    sections: [
      {
        title: 'Added',
        items: [
          '**appearance:** Add `Background Image` customization for the main window, including `Image Sizing`, `Image Opacity`, and `Background Content Opacity` controls.',
          '**sessions:** Add `Backspace Mode` selection for Telnet and Serial sessions with `Ctrl+H (BS)` and `DEL (0x7F)` options.',
        ],
      },
      {
        title: 'Changed',
        items: ['**resource-monitor:** Refresh the resource monitor with clearer cards and improved visual hierarchy.'],
      },
      {
        title: 'Fixed',
        items: [
          '**shortcuts:** Prevent Shift-modified terminal input from being mistaken for application shortcuts, restoring uppercase input such as `Shift+C`, `Shift+V`, and `Shift+X`.',
        ],
      },
    ],
  },
  {
    version: '[1.0.5] - 2026-05-19',
    sections: [
      {
        title: 'Added',
        items: [
          '**ai:** Capture AI command execution events and render inline terminal output during agent-driven workflows.',
          '**ai:** Add the `Terminal Output Lines` setting to control how many inline output lines are shown for AI-executed commands.',
          '**terminal:** Add AI Execution Profile selection to terminal session forms.',
          '**window:** Improve main-window modal management so child windows keep the workspace in a clearer modal state.',
        ],
      },
    ],
  },
  {
    version: '[1.0.4] - 2026-05-19',
    sections: [
      {
        title: 'Added',
        items: [
          '**cloud_sync:** Implement cloud synchronization features with encryption and logging.',
          '**ai:** Introduce AgentApprovalManager and refactor AI command handling.',
          '**session-management:** Enhance session management by adding initialGroupId support.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**ai:** Remove risk assessment features and AiRiskLevel from AI components and configuration.',
          '**i18n:** Update localization files for agent command execution and approval messages.',
          '**window:** Improve always-on-top logic for modal windows.',
          '**file-explorer:** Optimize file drop handling.',
          '**sftp:** Consolidate SFTP handling by removing SSH namespace and introducing new backend structure.',
          '**ssh-form:** Update SshForm and NewSessionPage for improved password handling and connection management.',
          '**cleanup:** Remove unused components and functions from AiTab and XTerminal.',
        ],
      },
    ],
  },
  {
    version: '[1.0.3] - 2026-05-18',
    sections: [
      {
        title: 'Added',
        items: [
          '**terminal:** Implement tab movement and unsplit functionality in terminal management.',
          '**zmodem:** Implement Zmodem file transfer commands, detection, and event handling.',
          '**shortcuts:** Implement customizable keyboard shortcuts and settings management.',
          '**window:** Enhance modal child window handling.',
          '**ai:** Enhance AI Assistant Panel with improved empty state handling.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**appearance:** Refactor font management and update default font settings.',
          '**i18n:** Add Zmodem transfer messages, terminal font family settings, keybindings, and AI setup instructions to localization files.',
          '**accessibility:** Add DialogDescription component to various dialogs.',
          '**theme:** Update color values in githubDark theme for improved consistency.',
        ],
      },
    ],
  },
  {
    version: '[1.0.2] - 2026-05-17',
    sections: [
      {
        title: 'Added',
        items: [
          '**credentials:** Implement credential management features with dialog and terminal autofill support.',
          '**security:** Enhance Password Management with Secret Unlocking Functionality and password reveal functionality.',
          '**terminal:** Add keyword highlighting settings and functionality in TerminalTab component.',
          '**clipboard:** Add CopyButton component for clipboard functionality.',
          '**tabbar:** Enhance TabBar component with dynamic tab visibility management and overflow handling.',
          '**templates:** Add issue templates for bug reports and feature requests.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**theme:** Update theme colors and CSS variables for improved consistency.',
          '**i18n:** Add localization entries for password management, search functionality, and hidden sessions.',
          '**ui:** Add required field indicators and improve label styling in session forms.',
          '**terminal:** Enhance ActionLinksAddon and KeywordHighlighter with improved timer management and refresh logic.',
          '**docs:** Enhance AI Assistant and security features in documentation.',
        ],
      },
    ],
  },
  {
    version: '[1.0.1] - 2026-05-16',
    sections: [
      {
        title: 'Added',
        items: [
          '**highlighting:** Add prompt highlighting support in keywordHighlightPresets.',
          '**app:** Integrate single instance support in Tauri application.',
          '**docs:** Add Umami analytics plugin to Docusaurus configuration.',
          '**ci:** Add GitHub Actions workflow for R2 asset publishing.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**file-explorer:** Clean up FileExplorer component by removing unused code and optimizing state management.',
          '**upload:** Simplify file upload handling in AutoUploadPage.',
          '**highlighting:** Update operator colors and regex pattern for keyword highlighting.',
          '**docs:** Update changelog with new releases and enhancements.',
          '**ci:** Update Docusaurus dependencies and remove optional Umami config.',
        ],
      },
    ],
  },

  {
    version: '[1.0.0] - 2026-05-06',
    sections: [
      {
        title: 'Added',
        items: [
          '**terminal-ai:** Add AI output capture in XTerminal with marker-based command execution capture.',
          '**connections:** Enhance connection management with recent connection tracking and matching localization strings.',
          '**downloads:** Enhance download platform management with architecture support and dynamic release asset fetching.',
          '**release:** Add Cloudflare R2 publishing and GitHub Actions workflows for release asset publishing.',
          '**branding:** Update the NyaTerm logo SVG with a new gradient and eye cutout mask.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**shell:** Remove PowerShell support from ShellKind and related shell handling logic.',
          '**branding:** Replace Dragonfly references with NyaTerm across documentation and the codebase.',
          '**updater:** Update the Tauri updater endpoint for improved version fetching.',
          '**deps:** Add strip-ansi-escapes and vte dependencies for more reliable terminal output handling.',
          '**ci:** Clean up obsolete debug publishing workflows.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**workflow:** Download GitHub Release assets during the publishing workflow.',
          '**workflow:** Add the TAG environment variable to the build-release workflow.',
        ],
      },
      {
        title: 'Documentation',
        items: ['**homepage:** Update home page images for dark and light themes.'],
      },
    ],
  },
  {
    version: '[0.9.0] - 2026-04-30',
    sections: [
      {
        title: 'Added',
        items: [
          '**ai-assistant:** Integrate the AI Assistant into the application, including terminal and file explorer actions, session history search, grouped sessions, copy selection, and session deletion.',
          '**agent:** Add agent mode with command execution, max step and timeout settings, command risk assessment, critical chmod/chown patterns, and a syntax-highlighted step view.',
          '**ai-chat:** Enhance AI chat streaming with session handling, cleanup, reasoning content, markdown support, structured output parsing, and improved logging.',
          '**storage:** Implement redb-based user data storage with JSON document updates, legacy migration improvements, and remote file reading.',
          '**macos:** Add macOS configuration and platform-specific header, child window, and layout adjustments.',
          '**update-dialog:** Render release notes as Markdown in the update dialog.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**app-layout:** Restructure the App component, introduce layout components, and streamline AppPanelContent panel rendering.',
          '**ai-settings:** Expand AI model listing and settings, simplify file-size settings, sort grouped models, and add AI localization updates.',
          '**ssh-form:** Refactor SshForm into tabs for proxy, jump host, and two-factor authentication settings.',
          '**ui:** Improve AIAssistantPanel, ModelCombobox, QuickCommands, action tooltips, and thinking text styling.',
          '**deps:** Add react-markdown, remark-gfm, react-syntax-highlighter, browserslist, lightningcss, and related dependency updates.',
          '**codebase:** Clean up formatting, import ordering, and function signatures across multiple modules.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**dialogs:** Add cleanup handling for dialog and alert dialog overlays.',
          '**ai-assistant:** Improve truncate_preview string truncation and remove the toast notification for text selection.',
          '**macos:** Correct titleBarStyle casing in the macOS configuration file.',
          '**ssh-form:** Adjust SshForm formatting and dialog import ordering.',
        ],
      },
      {
        title: 'Documentation',
        items: [
          'Update configuration storage documentation for the redb-backed data model.',
          'Expand documentation to include AI Assistant features and updates.',
        ],
      },
    ],
  },
  {
    version: '[0.8.5] - 2026-04-28',
    sections: [
      {
        title: 'Added',
        items: [
          '**session-sync:** Implement session synchronization support.',
          '**quick-commands:** Add support for sending commands to all users from QuickCommands.',
          '**release:** Add workflows to repair latest.json and release updater assets.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**ci:** Update the build-release workflow, repair asset download scripts, and release asset publishing flow.',
          '**docs:** Update the homepage URL and add a documentation page link to the header menu.',
          '**i18n:** Add synchronization group features and menu option strings in English and Chinese.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**ci:** Enhance build-release workflow cache cleanup, add libudev-dev to build dependencies, and fix GITHUB_TOKEN indentation.',
          '**updater:** Add Tauri updater signing key preparation and improve updater manifest generation.',
        ],
      },
    ],
  },
  {
    version: '[0.8.4] - 2026-04-27',
    sections: [
      {
        title: 'Added',
        items: [
          '**ssh:** Implement HostKeyVerifyManager for host key verification and known_hosts management.',
          '**ssh:** Enhance host key verification logging and add a timeout for verification.',
        ],
      },
      {
        title: 'Changed',
        items: ['**i18n:** Add SSH host key verification messages in English and Chinese locales.'],
      },
      {
        title: 'Fixed',
        items: ['**host-key-verification:** Add HostKeyVerifyDialog and integrate host key verification handling in the app.'],
      },
      {
        title: 'Documentation',
        items: ['Update Docusaurus configuration to handle broken anchors.'],
      },
    ],
  },
  {
    version: '[0.8.3] - 2026-04-27',
    sections: [
      {
        title: 'Added',
        items: [
          '**terminal:** Implement command suggestion visibility based on shell integration state and terminal mode.',
          '**file-explorer:** Add a parent directory entry and update context menu behavior for smoother navigation.',
        ],
      },
      {
        title: 'Changed',
        items: ['**resource-monitor:** Enhance the resource monitor UI and improve performance metric formatting.'],
      },
      {
        title: 'Documentation',
        items: ['Add CHANGELOG.md to document notable changes for version 0.8.2.'],
      },
    ],
  },
  {
    version: '[0.8.2] - 2026-04-23',
    sections: [
      {
        title: 'Added',
        items: [
          '**tauri:** Add Windows configuration file and remove unused dragDropEnabled property.',
          '**file-transfer:** Enhance file transfer handling to support directories, including progress tracking and UI updates for directory transfers.',
          '**session-management:** Implement session-specific command history management, including fetching, listening, and clearing command history for improved user experience.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**i18n:** Add new file transfer messages for progress tracking and completion in English and Chinese locales.',
          '**header:** Update window control buttons with new icons and improved styling for better user experience.',
        ],
      },
      {
        title: 'Fixed',
        items: ['**saved-connections:** Implement drag-and-drop support for connection and group items, enhancing user interaction and organization.'],
      },
      {
        title: 'Performance',
        items: ['**file-explorer:** Enhance FileExplorer component with memoization and scroll handling for improved performance and user experience.'],
      },
      {
        title: 'Documentation',
        items: [
          'Update README and guides to include new features such as Windows drag-and-drop support, enhanced file transfer capabilities, and diagnostics settings for improved user experience.',
          '**file-transfer:** Refine drag-and-drop upload section for clarity and consistency across languages.',
        ],
      },
    ],
  },
  {
    version: '[0.8.1] - 2026-04-23',
    sections: [
      {
        title: 'Added',
        items: [
          '**interaction:** Add command suggestion min character limit settings and normalization logic for enhanced user control.',
          '**file-explorer:** Implement external file drop support on Windows using WebView2 for enhanced drag-and-drop functionality.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**i18n:** Add command suggestions min character limit settings to English and Chinese locales for enhanced user control.',
          '**file-transfer:** Optimize visibleTransfers calculation using useMemo for improved performance and sorting.',
          '**terminal:** Replace useApp with useTerminalAppSettings for improved settings management and consistency across terminal components.',
          '**sync-backup:** Update button size from icon-xs to icon-sm for improved UI consistency.',
          '**i18n:** Add external drop support messages for English and Chinese locales to improve user guidance during file uploads.',
        ],
      },
      {
        title: 'Documentation',
        items: ['Enhance documentation with new features including session import/export, diagnostics, and tray support for improved user experience and clarity.'],
      },
    ],
  },
  {
    version: '[0.8.0] - 2026-04-22',
    sections: [
      {
        title: 'Added',
        items: [
          '**interaction:** Add command suggestion max character limit settings and normalization logic for improved user control over command suggestions.',
          '**quit_confirmation:** Implement QuitConfirmDialog for user confirmation before application exit, enhancing user experience and preventing accidental closures.',
          '**tray:** Implement tray functionality with window management and application quit command for enhanced user experience.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**i18n:** Add command suggestions max character limit settings to English and Chinese locales for improved user control.',
          '**syncbackup:** Enhance SyncBackupHistoryPanel with new UI components, improved history summary logic, and additional filtering options for better user experience.',
          '**i18n:** Add new history-related terms to English and Chinese locales for improved user experience and clarity.',
          '**scrollbar:** Add transparent background for scrollbar corner to improve UI consistency.',
          '**saved-connections:** Update layout and styling for improved responsiveness and visual consistency.',
          '**settings:** Remove emit calls for settings changes in ChildAppProvider and SettingsPage to streamline event handling.',
        ],
      },
    ],
  },
  {
    version: '[0.7.9] - 2026-04-21',
    sections: [
      {
        title: 'Added',
        items: [
          '**terminal:** Enhance terminal input handling by synchronizing input state from rendered lines and improving command processing logic.',
          '**syncbackup:** Implement SyncBackup functionality with UI components for managing cloud sync settings and history, enhancing user experience for backup management.',
          '**security:** Add master password management with dynamic state handling and improve input components for better user experience.',
          '**syncbackup:** Add validation for S3 endpoint requirement and improve UI feedback for draft settings, enhancing user experience in cloud sync management.',
          '**otp:** Integrate input-otp component for enhanced OTP input handling in OtpDialog, improving user experience with dynamic code length management.',
          '**cloud_sync:** Enhance error handling for WebDAV authentication by adding specific messaging for 401 errors and improving storage error mapping.',
          '**syncbackup:** Enhance SyncBackupHistoryPanel with filtering capabilities, improved state management, and UI updates for better user experience.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**terminal:** Remove unused input synchronization logic and streamline command sanitization process.',
          '**terminal:** Rename command tracking function and enhance command registration logic for improved input handling.',
          '**i18n:** Update English and Chinese locale files with new strings for sync and backup features, enhancing user interface and experience.',
          '**settings:** Restructure settings page with categorized groups, improved scroll handling, and dynamic tab management for enhanced user experience.',
          '**i18n:** Update zh-CN locale with new sync and backup history terms, enhance filtering options, and improve user prompts.',
        ],
      },
      {
        title: 'Fixed',
        items: ['**file-explorer:** Implement session caching for file explorer to maintain state across unmounts, enhancing user experience during navigation.'],
      },
      {
        title: 'Documentation',
        items: ['Enhance documentation and UI for Sync & Backup features, including detailed guides, settings integration, and improved user experience for cross-device configuration and backup management.'],
      },
    ],
  },
  {
    version: '[0.7.8] - 2026-04-21',
    sections: [
      {
        title: 'Added',
        items: [
          '**shell:** Implement command sanitization for terminal input and add terminal command utility functions.',
          '**session:** Refactor session input handling by introducing sendSessionInput function for improved command submission and preview management across components.',
          '**logging:** Introduce console usage linting and enhance error logging structure across components for improved diagnostics.',
          '**keywordhighlight:** Expand error and control flow patterns in keyword highlighting for enhanced diagnostics.',
          '**quickcommands:** Implement QuickCommandsStore for managing quick commands with in-memory caching and persistence, enhancing command upsert and retrieval functionality.',
        ],
      },
      {
        title: 'Changed',
        items: ['**observability, watcher, auth:** Apply consistent formatting and indentation across multiple functions for improved code readability.'],
      },
      {
        title: 'Performance',
        items: ['Optimize context providers by utilizing useMemo for context values in AppContext, ChildAppProvider, and TransferProvider.'],
      },
    ],
  },
  {
    version: '[0.7.7] - 2026-04-15',
    sections: [
      {
        title: 'Added',
        items: [
          'Implement import/export configuration functionality with UI updates in ImportDialog and Header components.',
          '**backup:** Add import/export functionality for configuration with encryption and rotation.',
          '**connections:** Add OpenGroupConnectionsDialog component and enhance connection item interactions with selection and context menu options.',
          '**panel:** Enhance QuickCommands component with improved search and category filtering UI.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**i18n:** Update English and Chinese translations for configuration import/export features and add new UI strings.',
          '**panel:** Update ActiveSessions component with improved styling for search input and icon.',
          '**panel:** Adjust width of dropdown menu in SavedConnections component for better UI consistency.',
        ],
      },
    ],
  },
  {
    version: '[0.7.6] - 2026-04-15',
    sections: [
      {
        title: 'Added',
        items: [
          '**ssh:** Improve SSH authentication logging and add known host key verification.',
          '**ssh:** Enhance SSH I/O loop with detailed exit status and signal logging.',
        ],
      },
      {
        title: 'Changed',
        items: ["Add 'des' crate dependency to Cargo.toml and update Cargo.lock."],
      },
      {
        title: 'Fixed',
        items: ['Restore import of SessionOutputCoalescer in pty.rs for proper session output handling.'],
      },
      {
        title: 'Documentation',
        items: [
          'Update README with new features and enhancements including online search, translation, and improved SFTP file explorer.',
          'Enhance documentation with updates on terminal features, file transfer capabilities, and security enhancements including translation support and improved session management.',
        ],
      },
    ],
  },
  {
    version: '[0.7.5] - 2026-04-14',
    sections: [
      {
        title: 'Added',
        items: [
          '**connection:** Enhance session connection handling with improved error recovery and connection editing prompts.',
          '**ssh:** Enhance SSH form with password management and localization updates.',
        ],
      },
    ],
  },
  {
    version: '[0.7.4] - 2026-04-14',
    sections: [
      {
        title: 'Added',
        items: [
          '**updater:** Implement update dialog and background update check functionality.',
          '**header:** Enhance header component with update check functionality and new icons.',
          '**terminal:** Add suspended state handling to terminal components and output coalescing for improved performance under load.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Add @tauri-apps/plugin-process and @tauri-apps/plugin-updater dependencies to package.json and pnpm-lock.yaml.',
          'Clean up imports and improve formatting across multiple components for better readability.',
          '**i18n:** Add updater localization for English and Chinese, including update status messages.',
          '**i18n:** Add localization for large output protection messages in English and Chinese.',
        ],
      },
    ],
  },
  {
    version: '[0.7.3] - 2026-04-14',
    sections: [
      {
        title: 'Added',
        items: [
          '**keywordhighlightpresets:** Expand success patterns to include additional keywords for improved matching.',
          '**connection-management:** Implement error handling for connection failures, adding support for marking tabs and panes as failed while maintaining layout integrity.',
          '**file-explorer:** Implement directory history management and enhance selection handling.',
          '**file-transfer:** Add pause, resume, and cancel functionality for file transfers with updated context and UI components.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**i18n:** Add connection failure messages in English and Chinese localization.',
          '**file-explorer:** Update selection handling methods and improve context menu interactions.',
          '**i18n:** Update English and Chinese localization for file transfer actions including cancel, pause, resume, and delete.',
        ],
      },
    ],
  },
  {
    version: '[0.7.2] - 2026-04-14',
    sections: [
      {
        title: 'Added',
        items: [
          '**interaction-settings:** Add command suggestions toggle to InteractionTab and integrate with app settings.',
          '**logging:** Implement persistent logging for warn and error levels, add Tauri command to handle log writing.',
          '**file-explorer:** Enhance keyboard interaction by adding delete functionality and focus management for the file list.',
          '**sftp:** Enhance remote file operations with detailed logging and permission handling.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**file-explorer:** Replace invoke import with local library and add autoFocus to delete button for improved accessibility.',
          '**file-explorer:** Replace invoke import with local library across multiple dialog components for consistency.',
          '**i18n:** Add command suggestions localization in English and Chinese.',
        ],
      },
      {
        title: 'Fixed',
        items: ['**keywordhighlightpresets:** Update duration regex to include shorthand units for better matching.'],
      },
      {
        title: 'Documentation',
        items: ['Update CLAUDE.md and README.md to clarify commands for building and serving the docs site, including locale-specific hot reload options.'],
      },
    ],
  },
  {
    version: '[0.7.1] - 2026-04-13',
    sections: [
      {
        title: 'Added',
        items: [
          '**clipboard:** Implement readClipboardText function and update terminal components to use it for clipboard access.',
          '**demos:** Add various demo scripts for showcasing NyaTerm\'s terminal features, including action links, file watching, keyword highlighting, and structured output.',
          '**activesessions:** Enhance ActiveSessions component with search functionality, session reconnect/disconnect actions, and improved UI for session display.',
          '**file-explorer:** Refactor DeleteDialog to handle multiple file deletions and improve UI; update FileExplorer to support batch delete actions.',
          '**resource-monitor:** Implement refresh button and improve stats fetching with async/await; add loading state management.',
          '**modal-management:** Refactor modal child window handling to improve focus enforcement and state tracking; add reconnect and disconnect session functionality in ActiveSessions component.',
          '**activesessions:** Simplify PanelHeader actions by removing unnecessary wrapper div for session count display.',
          '**resource-monitor:** Enhance refresh button with tooltip and rename state variable for clarity.',
        ],
      },
      {
        title: 'Changed',
        items: ['**i18n:** Update zh-CN and en.json for activeSessions and file deletion messages.'],
      },
      {
        title: 'Documentation',
        items: [
          'Update README and user guides to enhance clarity on NyaTerm\'s features, session types, and terminal capabilities; add new sections for workspace layout, security, and network configurations.',
          '**sidebars:** Update guide sections to include new topics on session types, layout, and authentication while reorganizing existing items for better clarity.',
        ],
      },
    ],
  },
  {
    version: '[0.7.0] - 2026-04-12',
    sections: [
      {
        title: 'Added',
        items: [
          'Enhance terminal workspace with new tab management and pane functionality.',
          '**crypto:** Implement master password wrapping key cryptosystem.',
          '**app:** Restore cryptographic master password state on app startup.',
          '**config:** Introduce proxy_jump_id field and circular-dependency validation.',
          '**ssh:** Implement multi-hop proxy jump routing via direct-tcpip channel.',
          '**ui:** Integrate jump host configuration into SSH session dialog.',
          '**shell:** Upgrade serial sender into unified shell command broadcaster.',
          '**explorer:** Restrict file explorer to SSH sessions and show unsupported message.',
          '**tabbar:** Add unread indicator with breathing animation and extend TabBarProps.',
          '**unreadtracking:** Implement unread session output tracking and update TabWindowsWorkspace to display unread tab IDs.',
          '**terminal:** Add TerminalGutter component for displaying line numbers and timestamps; update settings to disable action links by default.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**window:** Enable transparent window background in tauri config.',
          '**ssh:** Reduce default keepalive interval from 60s to 3s.',
          '**config:** Format ui configuration tuple structures.',
          '**security:** Migrate lock_password to unified master_password definitions.',
          '**ssh:** Decouple single session handle into multi-tiered SshConnectionHandles.',
          '**panel:** Migrate QuickCommands and SerialSendPanel to panel module.',
          '**ui:** Remove legacy fullscreen shortcuts and redundant menu entries.',
          '**panel:** Adjust active sessions count indicator formatting.',
          'Commit remaining changes.',
          '**keywordhighlight:** Update token boundary handling to remove conflicts.',
          '**i18n:** Add line numbers and timestamps options to terminal settings.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**otp:** Properly decode multi-byte utf-8 characters in url encoding.',
          '**ssh:** Prevent prompt injection scripts from polluting shell history.',
          '**session:** Silently ignore not-found error during session close.',
          '**terminal:** Suppress errors when attaching to terminating sessions.',
          '**terminal:** Prevent dismissing suggestions when there are no active suggestions or selection.',
          '**settings:** Disable keyword highlights and action links by default in terminal settings.',
        ],
      },
      {
        title: 'Performance',
        items: [
          'Only remove workspace tabs from UI after successful close.',
          'Make split-window session placement explicit.',
          'Reduce unnecessary re-renders in terminal workspace.',
        ],
      },
      {
        title: 'Documentation',
        items: ['Add CLAUDE.md for development guidance and architecture overview.'],
      },
    ],
  },
  {
    version: '[0.6.1] - 2026-04-11',
    sections: [
      {
        title: 'Changed',
        items: ['Update version synchronization in sync-version script.', 'Update nyaterm dependency version to 0.6.0.'],
      },
    ],
  },
  {
    version: '[0.6.0] - 2026-04-11',
    sections: [
      {
        title: 'Added',
        items: [
          '**proxy:** Standalone proxy and tunnel management.',
          '**sftp:** Enhance file transfer with concurrency, retries, and timestamps.',
          '**ui:** Implement network panel and settings restructuring.',
          'Implement Tauri commands for secure app settings management and password verification.',
          '**network:** Enhance tunnel configuration UI.',
          'Add session recording and custom transfer preferences.',
          '**ui:** Add OtpDialog for two-factor authentication support.',
          '**core:** Implement OTP interaction with PendingAuthManager and commands.',
          '**ui:** Implement OSC7 CWD tracking support and UI disabled states.',
          '**ui:** Integrate OtpDialog into main app layout with i18n support.',
          '**transfer:** Open download path from transfer footer.',
          '**security:** Add tab count display and update Key/Password management tabs to report counts.',
          '**ssh-form:** Enhance SSH form with proxy and OTP configuration options.',
          '**otp:** Implement OTP management and integration with UI components.',
          '**prettier:** Add Prettier configuration for JSON sorting and update package scripts for i18n checks.',
          '**search:** Add show_in_menu property to SearchEngine and enhance SearchTab with collapsible UI for custom engines.',
          '**session:** Launch local, telnet, and serial connections by type.',
          '**serial:** Show detected serial ports in the session editor.',
          '**serial:** Add bottom serial send panel.',
        ],
      },
      {
        title: 'Changed',
        items: [
          '**ui:** Introduce shadcn UI components.',
          '**i18n:** Update translations for network and transfer features.',
          '**translate:** Minor module dependency updates for translate API.',
          'Format session proxy imports.',
          'Adjust panel header actions layout.',
          '**deps:** Bump russh to 0.60.',
          '**ui:** Rename saved-connections dialog directory to connections.',
          '**core:** Reorganize module structure for ssh, runtime, and import.',
          'Update internal imports and finalize ssh module extraction.',
          '**core:** Adopt new ssh and runtime module structures.',
          '**ui:** Update import path in Header for new connections directory.',
          'Restructure command modules and update import paths for improved organization.',
          '**config:** Rename storage modules and split settings config.',
          '**runtime:** Extract tauri bootstrap and command adapters.',
          '**core:** Extract history store and unify error imports.',
          '**session-dialog:** Make new session forms responsive.',
          '**dialog:** Improve quick command and auto upload layouts.',
          '**settings:** Introduce responsive settings shell.',
          '**settings-search:** Reflow custom search engine editor.',
          '**settings-terminal:** Reflow action link and highlight editors.',
          '**panel:** Polish mobile panels and auth tabs.',
          '**core:** Export watcher module.',
          '**rust:** Normalize backend formatting.',
          '**i18n:** Normalize english sort labels.',
          '**otp:** Vendor local hotp and totp crate.',
          '**format:** Remove trailing whitespace artifacts.',
          '**format:** Trim trailing blank line in translate core.',
          '**quick-commands:** Clean up formatting and improve tooltip component structure.',
          '**resource-monitor:** Improve code formatting and structure for better readability.',
          '**settings:** Restructure settings components to use SettingSection for better organization and readability.',
          'Reorganize file explorer, auth and save-connections components.',
          '**connection:** Normalize saved connection schema into typed config blocks.',
          '**saved-connections:** Extract tooltip-backed header action button.',
          '**file-explorer:** Reuse tooltip icon buttons in the toolbar.',
          '**i18n:** Remove deprecated default local shell labels.',
          '**frontend:** Normalize panel imports and minor cleanup.',
          '**rust:** Isolate import reordering and line-wrap churn.',
          '**file-explorer:** Wrap dialog import for consistency.',
          'Introduce FileUploadPage and update routing to replace AutoUploadPage.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**ssh:** Resolve concurrent SshHandler access using Mutex.',
          '**security:** Add app scope to temp dir capabilities.',
          '**ui:** Handle xterm buffer trimming in keyword highlighter cache.',
          '**i18n:** Correct Chinese translations for various UI strings.',
          '**explorer:** Normalize cwd paths before syncing directories.',
          '**panel:** Update default tab in SecurityAuthPanel from passwords to keys.',
          '**ssh:** Use character escapes for PowerShell OSC integration.',
          '**select:** Allow trigger content to shrink and truncate in narrow layouts.',
          '**session-ui:** Restrict SSH-only panels and clarify path-sync messaging.',
          '**session-editor:** Reset local terminal defaults when clearing the form.',
          '**i18n:** Update serial port messages and reintroduce serial send localization.',
        ],
      },
    ],
  },
  {
    version: '[0.5.0] - 2026-04-07',
    sections: [
      {
        title: 'Added',
        items: [
          '**window:** Implement child window modal management and overlay.',
          '**auth:** Add managed password store for SSH sessions.',
          '**stats:** Add remote resource monitor for SSH sessions.',
          '**sftp:** Add recursive directory transfer commands.',
        ],
      },
      {
        title: 'Changed',
        items: ['Update styling for tab borders and shadows.', '**ui:** Adopt activity bar layout and custom window chrome.'],
      },
      {
        title: 'Fixed',
        items: ['**i18n:** Refine experimental keyword highlighting description in Chinese locale.', '**terminal:** Reconnect SSH tabs after disconnect.'],
      },
    ],
  },
  {
    version: '[0.4.0] - 2026-04-03',
    sections: [
      {
        title: 'Added',
        items: [
          'Implement ChildWindowRouter and enhance window management with i18n support.',
          'Enhance keyword highlighting settings and functionality.',
          'Update word separators in interaction settings for improved parsing.',
          'Enhance file transfer functionality and loading state management.',
          'Add keyword highlight setting for wrapped lines in TerminalTab.',
          '**session:** Add multi-protocol tabs to new session form.',
          '**file-explorer:** Open auto-upload prompts in child windows.',
          '**appearance:** Support dedicated terminal themes and font scaling.',
          '**terminal:** Add actionable links and hover menus.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Update project URLs and enhance build script.',
          "**i18n:** Add 'Built-in' font label to English and Chinese translations.",
          '**ui:** Polish tab chrome and refresh connection icons.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**app:** Stabilize active tab state and terminal defaults.',
          '**keywordhighlight:** Improve built-in matching and cell mapping.',
          '**build:** Align Vite typing and path alias settings.',
        ],
      },
      {
        title: 'Documentation',
        items: ['Add Docusaurus documentation site with bilingual support.', 'Redesign homepage and fix i18n issues.'],
      },
    ],
  },
  {
    version: '[0.3.5] - 2026-03-09',
    sections: [
      {
        title: 'Fixed',
        items: ['**keywordhighlight:** Enhance datetime and number patterns for better matching accuracy.'],
      },
    ],
  },
  {
    version: '[0.3.4] - 2026-03-09',
    sections: [
      {
        title: 'Changed',
        items: ['**terminal:** Replace kbd elements with Kbd component for consistency in CommandSuggestions and ContextMenu.'],
      },
    ],
  },
  {
    version: '[0.3.3] - 2026-03-09',
    sections: [
      {
        title: 'Added',
        items: [
          '**terminal:** Add keyword highlighting feature.',
          '**connections:** Add edit option to connection item context menu.',
          '**settings:** Support navigating to specific settings tab and auto-refresh ssh keys on focus.',
          '**shortcuts:** Implement global keyboard shortcuts for terminal and UI actions.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Sync version in Cargo.lock and update commit files list.',
          '**terminal:** Improve TabBar close button UI and hover states.',
          '**terminal:** Use React.RefObject instead of MutableRefObject for terminal refs.',
          '**theme:** Update terminal cursor colors for githubLight and nordLight themes.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          '**terminal:** Re-initialize WebGL addon on hardware acceleration toggle.',
          '**ssh:** Prevent OSC 7 injection from polluting bash history.',
        ],
      },
    ],
  },
  {
    version: '[0.2.1] - 2026-03-06',
    sections: [
      {
        title: 'Added',
        items: [
          '**session-management:** Enhance session handling with auto-connect feature.',
          '**types:** Add comprehensive global types for session management and UI configuration.',
          '**file-explorer:** Add dialogs for creating new files, folders, and symlinks.',
          '**translate:** Implement dynamic TKK generation for Google Translate.',
          '**file-explorer:** Implement terminal path synchronization feature.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Relocate themes and types to lib directory.',
          'Update `.gitignore` to include additional file patterns.',
          'Update import paths and enhance translation settings.',
          'Update import paths to global types.',
          '**icons:** Consolidate file icon logic and enhance icon imports.',
        ],
      },
    ],
  },
  {
    version: '[0.1.5] - 2026-03-06',
    sections: [
      {
        title: 'Added',
        items: [
          '**ui:** Implement zoom level persistence and view settings.',
          '**ui:** Add clickable homepage and issues links to about dialog.',
          '**ui:** Enhance header menu with icons and new Help options for documentation and logs.',
          '**logging:** Enhance tracing initialization with rolling file appender and update log permissions.',
          '**window:** Show application window on startup and update tauri configuration to allow window visibility.',
          '**connections:** Add the SavedConnections panel for grouped SSH connection management.',
          '**watcher:** Add file watcher support and chunked file transfer progress tracking.',
          '**file-explorer:** Integrate custom dialogs and context menu support.',
          '**settings:** Implement global settings dialog and localization.',
          '**terminal:** Add terminal context menu utilities and search bar.',
          '**security:** Add lock screen and lock password encryption.',
          '**quick-commands:** Redesign quick commands UI with icons and variables support.',
          '**file-transfer:** Add file properties dialog and transfer progress bar.',
          '**settings:** Add translation settings and a tabbed settings/about experience.',
          '**translate:** Add TranslationTab and multi-provider translation service.',
          '**terminal:** Enhance XTerminal with URL opening and better command history handling.',
          '**app:** Introduce global application context and broader i18n support.',
          '**search:** Add search engine icons and improve search tab configuration UI.',
          '**import:** Add session import from Xshell, MobaXterm, and WindTerm.',
          '**ui:** Add command palette, popover, and draggable panel components.',
          '**icons:** Expand the icon system and update type definitions.',
          '**connections:** Enhance connection handling, feedback, sorting, and drag-and-drop.',
          '**config:** Add screen lock and connection sort mode settings.',
          '**security:** Implement screen lock toggle and idle detection.',
          '**suggestions:** Enhance command suggestions with multi-provider support.',
          '**event-listeners:** Replace polling with event listeners for session and command history updates.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Add MIT License file.',
          '**assets:** Update app icons, logo assets, and remove unused SVGs.',
          '**cleanup:** Update tauri config and remove unused assets.',
          '**i18n:** Integrate i18next across the application.',
          '**ui:** Update page title from `NyaTerm Terminal` to `NyaTerm`.',
          'Update scrollbar styling.',
          'Update global UI, layout visibility, and theme configuration.',
          'Adopt shadcn/ui components.',
          'Migrate toast notifications to sonner and use shadcn context menus.',
          'Update settings dialog to use switches and a tabbed interface.',
          '**i18n:** Update localizations for new components and features.',
          'Update typography, CSS variables, theme colors, and section headers.',
          'Update dependencies, shared utils, types, UI components, and panels.',
          '**backend:** Modularize config and commands into submodules.',
          '**theme:** Overhaul the theme system with CSS variables and preset themes.',
          '**dialog:** Reorganize dialogs into domain-specific subdirectories.',
          '**settings:** Update settings tabs for the new config structure.',
          '**app:** Refresh App, contexts, layout, and panel components.',
          '**i18n:** Add locale keys for newly introduced settings and UI flows.',
          '**window:** Migrate dialogs to independent child windows.',
          '**file-explorer:** Modularize the file tree and replace native dialogs.',
          '**terminal:** Clean up formatting and whitespace issues.',
          '**tracing:** Improve local time formatting and remove inline key migration.',
          '**dialogs:** Remove NewSessionDialog, SettingsDialog, and QuickCommandDialog.',
          '**components:** Extract settings components and standardize import paths.',
          'Delete generated build output from the repository.',
          'Bump version to `0.1.5` and add version synchronization script.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Resolve dialog accessibility warnings.',
          'Update translation key usage in SearchTab for clearer settings descriptions.',
          'Improve session handling and UI responsiveness.',
          '**settings:** Update default interaction settings for copy and paste.',
          '**translations:** Remove fallback values from translation keys in dialogs and components.',
        ],
      },
      {
        title: 'Performance',
        items: ['**sftp,ssh:** Optimize transfer speeds and add symlink support.'],
      },
      {
        title: 'Documentation',
        items: ['Update README with key features and usage instructions.', 'Remove the trailing period from the README tagline.'],
      },
    ],
  },
];

const changelogReleasesZhCN: ChangelogRelease[] = [
  {
    version: '[1.0.7] - 2026-05-21',
    sections: [
      {
        title: '变更',
        items: [
          '**appearance:** 改进字体选择界面，并在系统字体发现过程中显示 `Loading system fonts...` 加载状态。',
          '**otp:** 优化 OTP 输入槽位布局和 OTP 代码面板在窄屏下的响应式表现。',
          '**profiles:** 为调试和发布流程新增多个 Cargo 构建 profile。',
        ],
      },
      {
        title: '修复',
        items: ['**csp:** 修正 CSP 中的资源协议处理，确保背景图等本地资源可以稳定加载。'],
      },
      {
        title: '性能',
        items: ['**appearance:** 改为异步加载系统字体，保持外观设置页的响应速度。'],
      },
    ],
  },
  {
    version: '[1.0.6] - 2026-05-21',
    sections: [
      {
        title: '新增',
        items: [
          '**appearance:** 为主窗口新增 `Background Image` 自定义能力，支持 `Image Sizing`、`Image Opacity` 和 `Background Content Opacity` 控制。',
          '**sessions:** 为 Telnet 和串口会话新增 `Backspace Mode` 选项，可在 `Ctrl+H (BS)` 与 `DEL (0x7F)` 之间切换。',
        ],
      },
      {
        title: '变更',
        items: ['**resource-monitor:** 刷新资源监控面板的卡片样式和视觉层级。'],
      },
      {
        title: '修复',
        items: [
          '**shortcuts:** 修复 Shift 修饰键输入被误判为应用快捷键的问题，恢复 `Shift+C`、`Shift+V`、`Shift+X` 等大写输入。',
        ],
      },
    ],
  },
  {
    version: '[1.0.5] - 2026-05-19',
    sections: [
      {
        title: '新增',
        items: [
          '**ai:** 捕获 AI 命令执行事件，并在 Agent 工作流中渲染终端内联输出。',
          '**ai:** 新增 `Terminal Output Lines` 设置，用于控制 AI 执行命令时显示的内联输出行数。',
          '**terminal:** 为终端会话表单新增 AI Execution Profile 选择。',
          '**window:** 改进主窗口模态管理，让子窗口触发时工作区的模态状态更清晰。',
        ],
      },
    ],
  },
  {
    version: '[1.0.4] - 2026-05-19',
    sections: [
      {
        title: '新增',
        items: [
          '**cloud_sync:** 实现云同步功能，加入加密支持与日志记录。',
          '**ai:** 引入 AgentApprovalManager 并重构 AI 命令处理逻辑。',
          '**session-management:** 增强会话管理，新增 initialGroupId 支持。',
        ],
      },
      {
        title: '变更',
        items: [
          '**ai:** 移除 AI 组件及配置中的风险评估功能和 AiRiskLevel。',
          '**i18n:** 更新本地化文件，补充 agent 命令执行与审批提示。',
          '**window:** 改进模态窗口的置顶逻辑。',
          '**file-explorer:** 优化文件拖放处理逻辑。',
          '**sftp:** 移除 SSH 命名空间并引入新的后端结构以整合 SFTP 处理。',
          '**ssh-form:** 更新 SshForm 和 NewSessionPage，改进密码处理与连接管理。',
          '**cleanup:** 移除 AiTab 和 XTerminal 中未使用的组件和函数。',
        ],
      },
    ],
  },
  {
    version: '[1.0.3] - 2026-05-18',
    sections: [
      {
        title: '新增',
        items: [
          '**terminal:** 在终端管理中实现标签页移动和解除分屏功能。',
          '**zmodem:** 实现 Zmodem 文件传输命令、检测和事件处理。',
          '**shortcuts:** 实现自定义键盘快捷键及设置管理。',
          '**window:** 增强模态子窗口处理。',
          '**ai:** 增强 AI Assistant 面板，改进空状态显示。',
        ],
      },
      {
        title: '变更',
        items: [
          '**appearance:** 重构字体管理并更新默认字体设置。',
          '**i18n:** 在本地化文件中新增 Zmodem 传输信息、终端字体设置、快捷键及 AI 设置指南。',
          '**accessibility:** 为多个对话框新增 DialogDescription 组件以提升无障碍体验。',
          '**theme:** 更新 githubDark 主题中的颜色值以提升一致性。',
        ],
      },
    ],
  },
  {
    version: '[1.0.2] - 2026-05-17',
    sections: [
      {
        title: '新增',
        items: [
          '**credentials:** 实现凭据管理功能，支持对话框及终端自动填充。',
          '**security:** 增强密码管理，支持密钥解锁和密码显示功能。',
          '**terminal:** 在 TerminalTab 组件中新增关键词高亮设置及功能。',
          '**clipboard:** 新增 CopyButton 组件用于剪贴板操作。',
          '**tabbar:** 增强 TabBar 组件，支持动态标签页可见性管理和溢出处理。',
          '**templates:** 新增缺陷报告和功能请求的 Issue 模板。',
        ],
      },
      {
        title: '变更',
        items: [
          '**theme:** 更新主题颜色及 CSS 变量以提升一致性。',
          '**i18n:** 新增密码管理、搜索功能及隐藏会话的本地化条目。',
          '**ui:** 在会话表单中新增必填项指示，改进标签样式。',
          '**terminal:** 增强 ActionLinksAddon 和 KeywordHighlighter，改进计时器管理与刷新逻辑。',
          '**docs:** 在文档中补充 AI 助手和安全功能相关内容。',
        ],
      },
    ],
  },
  {
    version: '[1.0.1] - 2026-05-16',
    sections: [
      {
        title: '新增',
        items: [
          '**highlighting:** 在 keywordHighlightPresets 中新增命令行提示符高亮支持。',
          '**app:** 在 Tauri 应用中集成单例运行支持。',
          '**docs:** 在 Docusaurus 配置中新增 Umami 分析插件。',
          '**ci:** 新增用于 R2 资产发布的 GitHub Actions 工作流。',
        ],
      },
      {
        title: '变更',
        items: [
          '**file-explorer:** 清理 FileExplorer 组件，移除未使用代码并优化状态管理。',
          '**upload:** 简化 AutoUploadPage 中的文件上传处理逻辑。',
          '**highlighting:** 更新深色和浅色规则板中的操作符颜色，以及操作符的正则匹配模式。',
          '**docs:** 更新更新日志，补充新版本与增强内容。',
          '**ci:** 更新 Docusaurus 依赖，移除可选的 Umami 配置。',
        ],
      },
    ],
  },

  {
    version: '[1.0.0] - 2026-05-06',
    sections: [
      {
        title: '新增',
        items: [
          '**terminal-ai:** 在 XTerminal 中新增 AI 输出捕获，并支持基于标记的命令执行输出捕获。',
          '**connections:** 增强连接管理，加入最近连接跟踪，并补充对应本地化文案。',
          '**downloads:** 增强下载平台管理，支持架构识别和动态获取发布资产。',
          '**release:** 新增 Cloudflare R2 发布流程和用于发布资产上传的 GitHub Actions 工作流。',
          '**branding:** 更新 NyaTerm logo SVG，使用新的渐变和眼部镂空遮罩。',
        ],
      },
      {
        title: '变更',
        items: [
          '**shell:** 移除 ShellKind 及相关逻辑中的 PowerShell 支持。',
          '**branding:** 将文档和代码库中的 Dragonfly 引用替换为 NyaTerm。',
          '**updater:** 更新 Tauri updater endpoint，以改进版本获取流程。',
          '**deps:** 新增 strip-ansi-escapes 和 vte 依赖，以提升终端输出处理的可靠性。',
          '**ci:** 清理过期的调试发布工作流。',
        ],
      },
      {
        title: '修复',
        items: [
          '**workflow:** 在发布工作流中下载 GitHub Release 资产。',
          '**workflow:** 为 build-release 工作流新增 TAG 环境变量。',
        ],
      },
      {
        title: '文档',
        items: ['**homepage:** 更新首页在深色和浅色主题下的图片。'],
      },
    ],
  },
  {
    version: '[0.9.0] - 2026-04-30',
    sections: [
      {
        title: '新增',
        items: [
          '**ai-assistant:** 将 AI Assistant 集成到应用中，支持终端和文件浏览器动作、会话历史搜索、会话分组、复制选择内容以及删除会话。',
          '**agent:** 新增 agent 模式，支持命令执行、最大步骤和超时设置、命令风险评估、chmod/chown 高风险模式以及带语法高亮的步骤视图。',
          '**ai-chat:** 增强 AI 聊天流处理，加入会话管理、清理、推理内容、Markdown 支持、结构化输出解析和更完善的日志。',
          '**storage:** 实现基于 redb 的用户数据存储，并支持 JSON 文档更新、旧数据迁移改进和远程文件读取。',
          '**macos:** 新增 macOS 配置，并加入平台相关的 Header、子窗口和布局调整。',
          '**update-dialog:** 在更新对话框中支持以 Markdown 渲染发布说明。',
        ],
      },
      {
        title: '变更',
        items: [
          '**app-layout:** 重构 App 组件，引入新的布局组件，并简化 AppPanelContent 的面板渲染逻辑。',
          '**ai-settings:** 扩展 AI 模型列表和设置，简化文件大小设置，支持分组模型排序，并补充 AI 本地化内容。',
          '**ssh-form:** 将 SshForm 重构为用于代理、跳板机和双因素认证设置的标签页结构。',
          '**ui:** 改进 AIAssistantPanel、ModelCombobox、QuickCommands、操作按钮 tooltip 和思考文本样式。',
          '**deps:** 新增 react-markdown、remark-gfm、react-syntax-highlighter、browserslist、lightningcss，并更新相关依赖。',
          '**codebase:** 清理多个模块中的格式、导入顺序和函数签名。',
        ],
      },
      {
        title: '修复',
        items: [
          '**dialogs:** 为 dialog 和 alert dialog 遮罩层增加清理处理。',
          '**ai-assistant:** 改进 truncate_preview 字符串截断逻辑，并移除文本选择时的 toast 提示。',
          '**macos:** 修正 macOS 配置文件中的 titleBarStyle 大小写。',
          '**ssh-form:** 调整 SshForm 格式并整理对话框导入顺序。',
        ],
      },
      {
        title: '文档',
        items: ['更新配置存储文档，以说明基于 redb 的数据模型。', '扩展文档，补充 AI Assistant 功能和相关更新。'],
      },
    ],
  },
  {
    version: '[0.8.5] - 2026-04-28',
    sections: [
      {
        title: '新增',
        items: [
          '**session-sync:** 实现会话同步支持。',
          '**quick-commands:** 支持在 QuickCommands 中向所有用户发送命令。',
          '**release:** 新增用于修复 latest.json 和发布 updater 资产的工作流。',
        ],
      },
      {
        title: '变更',
        items: [
          '**ci:** 更新 build-release 工作流、资产修复下载脚本和发布资产上传流程。',
          '**docs:** 更新首页 URL，并在头部菜单中新增文档页面链接。',
          '**i18n:** 为英文和中文新增同步分组功能和菜单选项文案。',
        ],
      },
      {
        title: '修复',
        items: [
          '**ci:** 增强 build-release 工作流的缓存清理，新增 libudev-dev 构建依赖，并修复 GITHUB_TOKEN 缩进。',
          '**updater:** 新增 Tauri updater 签名密钥准备步骤，并改进 updater manifest 生成流程。',
        ],
      },
    ],
  },
  {
    version: '[0.8.4] - 2026-04-27',
    sections: [
      {
        title: '新增',
        items: [
          '**ssh:** 实现 HostKeyVerifyManager，用于主机密钥验证和 known_hosts 管理。',
          '**ssh:** 增强主机密钥验证日志，并加入验证超时机制。',
        ],
      },
      {
        title: '变更',
        items: ['**i18n:** 为英文和中文语言环境新增 SSH 主机密钥验证提示文案。'],
      },
      {
        title: '修复',
        items: ['**host-key-verification:** 新增 HostKeyVerifyDialog，并将主机密钥验证处理集成到应用中。'],
      },
      {
        title: '文档',
        items: ['更新 Docusaurus 配置以处理 broken anchors。'],
      },
    ],
  },
  {
    version: '[0.8.3] - 2026-04-27',
    sections: [
      {
        title: '新增',
        items: [
          '**terminal:** 基于 shell integration 状态和终端模式实现命令建议可见性逻辑。',
          '**file-explorer:** 新增返回上级目录入口，并更新上下文菜单行为以改善导航体验。',
        ],
      },
      {
        title: '变更',
        items: ['**resource-monitor:** 增强资源监视器界面，并改进性能指标格式化展示。'],
      },
      {
        title: '文档',
        items: ['新增 CHANGELOG.md，用于记录 0.8.2 版本的重要变更。'],
      },
    ],
  },
  {
    version: '[0.8.2] - 2026-04-23',
    sections: [
      {
        title: '新增',
        items: [
          '**tauri:** 添加 Windows 配置文件，并移除未使用的 dragDropEnabled 属性。',
          '**file-transfer:** 增强文件传输处理以支持目录，包括目录传输的进度跟踪与界面更新。',
          '**session-management:** 实现按会话维度管理命令历史，包括获取、监听和清理命令历史，以提升使用体验。',
        ],
      },
      {
        title: '变更',
        items: [
          '**i18n:** 为英文和中文语言环境新增文件传输进度跟踪与完成提示文案。',
          '**header:** 更新窗口控制按钮，采用新图标并改进样式，以提升使用体验。',
        ],
      },
      {
        title: '修复',
        items: ['**saved-connections:** 为连接和分组项实现拖放支持，提升交互体验和组织能力。'],
      },
      {
        title: '性能',
        items: ['**file-explorer:** 通过记忆化和滚动处理增强 FileExplorer 组件，提升性能与使用体验。'],
      },
      {
        title: '文档',
        items: [
          '更新 README 和指南，补充 Windows 拖放支持、增强后的文件传输能力以及诊断设置等新特性说明，以提升使用体验。',
          '**file-transfer:** 优化拖放上传章节，使其在不同语言间更清晰且表述一致。',
        ],
      },
    ],
  },
  {
    version: '[0.8.1] - 2026-04-23',
    sections: [
      {
        title: '新增',
        items: [
          '**interaction:** 新增命令建议最小字符数限制设置及归一化逻辑，增强用户控制能力。',
          '**file-explorer:** 在 Windows 上使用 WebView2 实现外部文件拖放支持，增强拖拽交互能力。',
        ],
      },
      {
        title: '变更',
        items: [
          '**i18n:** 为英文和中文语言环境新增命令建议最小字符数限制相关文案，增强用户控制能力。',
          '**file-transfer:** 使用 useMemo 优化 visibleTransfers 的计算，以提升性能与排序表现。',
          '**terminal:** 用 useTerminalAppSettings 替换 useApp，以改进设置管理并保持终端组件间的一致性。',
          '**sync-backup:** 将按钮尺寸从 icon-xs 调整为 icon-sm，以提升界面一致性。',
          '**i18n:** 为英文和中文语言环境新增外部拖放支持提示文案，提升文件上传时的引导体验。',
        ],
      },
      {
        title: '文档',
        items: ['增强文档，补充会话导入导出、诊断和托盘支持等新特性说明，以提升清晰度和使用体验。'],
      },
    ],
  },
  {
    version: '[0.8.0] - 2026-04-22',
    sections: [
      {
        title: '新增',
        items: [
          '**interaction:** 新增命令建议最大字符数限制设置及归一化逻辑，提升对命令建议的控制能力。',
          '**quit_confirmation:** 实现 QuitConfirmDialog，在退出应用前请求用户确认，避免误关闭并提升使用体验。',
          '**tray:** 实现托盘功能，包括窗口管理和应用退出命令，提升使用体验。',
        ],
      },
      {
        title: '变更',
        items: [
          '**i18n:** 为英文和中文语言环境新增命令建议最大字符数限制相关文案，提升用户控制能力。',
          '**syncbackup:** 增强 SyncBackupHistoryPanel，加入新的 UI 组件、改进历史摘要逻辑，并增加额外筛选选项，以提升使用体验。',
          '**i18n:** 为英文和中文语言环境新增历史记录相关术语，提升清晰度与使用体验。',
          '**scrollbar:** 为滚动条角落添加透明背景，以提升 UI 一致性。',
          '**saved-connections:** 更新布局和样式，以提升响应式表现和视觉一致性。',
          '**settings:** 移除 ChildAppProvider 与 SettingsPage 中的 emit 调用，以简化事件处理。',
        ],
      },
    ],
  },
  {
    version: '[0.7.9] - 2026-04-21',
    sections: [
      {
        title: '新增',
        items: [
          '**terminal:** 通过同步已渲染行中的输入状态并改进命令处理逻辑，增强终端输入处理能力。',
          '**syncbackup:** 实现 SyncBackup 功能及其管理云同步设置和历史记录的 UI 组件，提升备份管理体验。',
          '**security:** 新增主密码管理，并改进输入组件的动态状态处理，提升使用体验。',
          '**syncbackup:** 增加对 S3 endpoint 必填项的校验，并改进草稿设置的界面反馈，提升云同步管理体验。',
          '**otp:** 在 OtpDialog 中集成 input-otp 组件，改进 OTP 输入处理，并支持动态验证码长度。',
          '**cloud_sync:** 通过为 401 错误添加专门提示并改进存储错误映射，增强 WebDAV 认证的错误处理。',
          '**syncbackup:** 增强 SyncBackupHistoryPanel，加入筛选能力、改进状态管理并更新界面，以提升使用体验。',
        ],
      },
      {
        title: '变更',
        items: [
          '**terminal:** 移除未使用的输入同步逻辑，并简化命令清洗流程。',
          '**terminal:** 重命名命令跟踪函数，并增强命令注册逻辑以改进输入处理。',
          '**i18n:** 更新英文和中文语言文件，为同步与备份功能补充新文案并提升界面体验。',
          '**settings:** 重构设置页面，采用分类分组、改进滚动处理和动态标签管理，以提升使用体验。',
          '**i18n:** 更新 zh-CN 语言文件，新增同步与备份历史相关术语，增强筛选选项并优化提示文案。',
        ],
      },
      {
        title: '修复',
        items: ['**file-explorer:** 为文件浏览器实现会话缓存，在组件卸载后仍可保持状态，提升导航体验。'],
      },
      {
        title: '文档',
        items: ['增强同步与备份功能的文档和界面说明，包括详细指南、设置集成，以及跨设备配置与备份管理体验的改进。'],
      },
    ],
  },
  {
    version: '[0.7.8] - 2026-04-21',
    sections: [
      {
        title: '新增',
        items: [
          '**shell:** 实现终端输入的命令清洗，并新增终端命令工具函数。',
          '**session:** 通过引入 sendSessionInput 函数重构会话输入处理，改进跨组件的命令提交和预览管理。',
          '**logging:** 引入 console 使用 lint 规则，并增强多个组件中的错误日志结构，以提升诊断能力。',
          '**keywordhighlight:** 扩展关键词高亮中的错误和控制流模式，提升诊断能力。',
          '**quickcommands:** 实现 QuickCommandsStore，用于管理快捷命令的内存缓存与持久化，增强命令的写入与获取能力。',
        ],
      },
      {
        title: '变更',
        items: ['**observability, watcher, auth:** 对多个函数应用一致的格式和缩进，以提升代码可读性。'],
      },
      {
        title: '性能',
        items: ['通过为 AppContext、ChildAppProvider 和 TransferProvider 的上下文值使用 useMemo 来优化上下文提供者。'],
      },
    ],
  },
  {
    version: '[0.7.7] - 2026-04-15',
    sections: [
      {
        title: '新增',
        items: [
          '实现配置导入导出功能，并更新 ImportDialog 和 Header 组件的界面。',
          '**backup:** 新增带加密和轮换能力的配置导入导出功能。',
          '**connections:** 新增 OpenGroupConnectionsDialog 组件，并增强连接项交互，支持选择和上下文菜单操作。',
          '**panel:** 增强 QuickCommands 组件，改进搜索和分类筛选界面。',
        ],
      },
      {
        title: '变更',
        items: [
          '**i18n:** 更新英文和中文翻译，补充配置导入导出功能相关文案。',
          '**panel:** 更新 ActiveSessions 组件，改进搜索输入框和图标样式。',
          '**panel:** 调整 SavedConnections 组件中下拉菜单的宽度，以提升界面一致性。',
        ],
      },
    ],
  },
  {
    version: '[0.7.6] - 2026-04-15',
    sections: [
      {
        title: '新增',
        items: [
          '**ssh:** 改进 SSH 认证日志，并新增 known host 密钥校验。',
          '**ssh:** 增强 SSH I/O 循环，加入详细的退出状态和信号日志。',
        ],
      },
      {
        title: '变更',
        items: ["向 Cargo.toml 新增 'des' crate 依赖，并更新 Cargo.lock。"],
      },
      {
        title: '修复',
        items: ['恢复在 pty.rs 中对 SessionOutputCoalescer 的导入，以确保会话输出处理正常。'],
      },
      {
        title: '文档',
        items: [
          '更新 README，补充在线搜索、翻译和改进后的 SFTP 文件浏览器等新特性说明。',
          '增强文档，补充终端特性、文件传输能力和安全增强项（包括翻译支持与改进后的会话管理）的说明。',
        ],
      },
    ],
  },
  {
    version: '[0.7.5] - 2026-04-14',
    sections: [
      {
        title: '新增',
        items: [
          '**connection:** 增强会话连接处理，改进错误恢复和连接编辑提示。',
          '**ssh:** 增强 SSH 表单，加入密码管理和本地化更新。',
        ],
      },
    ],
  },
  {
    version: '[0.7.4] - 2026-04-14',
    sections: [
      {
        title: '新增',
        items: [
          '**updater:** 实现更新对话框和后台更新检查功能。',
          '**header:** 增强头部组件，加入更新检查功能和新图标。',
          '**terminal:** 为终端组件新增挂起状态处理和输出合并，在高负载下提升性能表现。',
        ],
      },
      {
        title: '变更',
        items: [
          '向 package.json 和 pnpm-lock.yaml 新增 @tauri-apps/plugin-process 与 @tauri-apps/plugin-updater 依赖。',
          '清理导入并改进多个组件的格式，以提升可读性。',
          '**i18n:** 为英文和中文语言环境新增更新器本地化文案，包括更新状态消息。',
          '**i18n:** 为英文和中文语言环境新增大输出保护相关文案。',
        ],
      },
    ],
  },
  {
    version: '[0.7.3] - 2026-04-14',
    sections: [
      {
        title: '新增',
        items: [
          '**keywordhighlightpresets:** 扩展成功匹配模式，加入更多关键词以提升匹配效果。',
          '**connection-management:** 实现连接失败时的错误处理，支持将标签页和窗格标记为失败，同时保持布局完整。',
          '**file-explorer:** 实现目录历史管理并增强选择处理。',
          '**file-transfer:** 新增文件传输的暂停、继续和取消功能，并更新相关上下文与界面组件。',
        ],
      },
      {
        title: '变更',
        items: [
          '**i18n:** 为英文和中文语言环境新增连接失败提示文案。',
          '**file-explorer:** 更新选择处理方法并改进上下文菜单交互。',
          '**i18n:** 更新英文和中文语言环境中的文件传输操作文案，包括取消、暂停、继续和删除。',
        ],
      },
    ],
  },
  {
    version: '[0.7.2] - 2026-04-14',
    sections: [
      {
        title: '新增',
        items: [
          '**interaction-settings:** 在 InteractionTab 中新增命令建议开关，并接入应用设置。',
          '**logging:** 实现 warn 和 error 级别的持久化日志，并新增对应的 Tauri 命令来处理日志写入。',
          '**file-explorer:** 增强键盘交互，加入删除功能和文件列表焦点管理。',
          '**sftp:** 增强远程文件操作，加入更详细的日志和权限处理。',
        ],
      },
      {
        title: '变更',
        items: [
          '**file-explorer:** 用本地库替换 invoke 导入，并为删除按钮新增 autoFocus，以提升可访问性。',
          '**file-explorer:** 在多个对话框组件中统一将 invoke 导入替换为本地库，以保持一致性。',
          '**i18n:** 为英文和中文语言环境新增命令建议相关文案。',
        ],
      },
      {
        title: '修复',
        items: ['**keywordhighlightpresets:** 更新 duration 正则表达式，使其支持简写单位，提升匹配效果。'],
      },
      {
        title: '文档',
        items: ['更新 CLAUDE.md 和 README.md，澄清文档站点的构建与服务命令，包括按语言环境热更新的选项。'],
      },
    ],
  },
  {
    version: '[0.7.1] - 2026-04-13',
    sections: [
      {
        title: '新增',
        items: [
          '**clipboard:** 实现 readClipboardText 函数，并更新终端组件以使用它访问剪贴板。',
          '**demos:** 新增多种演示脚本，用于展示 NyaTerm 的终端特性，包括动作链接、文件监听、关键词高亮和结构化输出。',
          '**activesessions:** 增强 ActiveSessions 组件，加入搜索功能、会话重连/断开操作，并改进会话展示界面。',
          '**file-explorer:** 重构 DeleteDialog 以处理多文件删除，并改进界面；同时更新 FileExplorer 以支持批量删除操作。',
          '**resource-monitor:** 实现刷新按钮，并使用 async/await 改进统计信息获取流程；同时增加加载状态管理。',
          '**modal-management:** 重构模态子窗口处理逻辑，改进焦点强制和状态跟踪；并在 ActiveSessions 组件中加入会话重连和断开功能。',
          '**activesessions:** 简化 PanelHeader 操作区，移除用于会话数量展示的多余包裹 div。',
          '**resource-monitor:** 为刷新按钮增加 tooltip，并重命名状态变量以提升可读性。',
        ],
      },
      {
        title: '变更',
        items: ['**i18n:** 更新 zh-CN 和 en.json，补充活动会话和文件删除提示文案。'],
      },
      {
        title: '文档',
        items: [
          '更新 README 和用户指南，增强对 NyaTerm 功能、会话类型和终端能力的说明，并新增工作区布局、安全和网络配置等章节。',
          '**sidebars:** 更新指南章节，加入会话类型、布局和认证等主题，并重新组织现有条目以提升清晰度。',
        ],
      },
    ],
  },
  {
    version: '[0.7.0] - 2026-04-12',
    sections: [
      {
        title: '新增',
        items: [
          '增强终端工作区，加入新的标签页管理和窗格功能。',
          '**crypto:** 实现主密码包裹密钥加密体系。',
          '**app:** 在应用启动时恢复主密码的加密状态。',
          '**config:** 引入 proxy_jump_id 字段和循环依赖校验。',
          '**ssh:** 通过 direct-tcpip channel 实现多跳 proxy jump 路由。',
          '**ui:** 在 SSH 会话对话框中集成跳板机配置。',
          '**shell:** 将串口发送器升级为统一的 shell 命令广播器。',
          '**explorer:** 将文件浏览器限制为仅在 SSH 会话中使用，并显示不支持提示。',
          '**tabbar:** 新增带呼吸动画的未读指示器，并扩展 TabBarProps。',
          '**unreadtracking:** 实现会话未读输出跟踪，并更新 TabWindowsWorkspace 以显示未读标签页 ID。',
          '**terminal:** 新增 TerminalGutter 组件用于显示行号和时间戳，并将设置中的动作链接默认关闭。',
        ],
      },
      {
        title: '变更',
        items: [
          '**window:** 在 tauri 配置中启用透明窗口背景。',
          '**ssh:** 将默认 keepalive 间隔从 60 秒降低到 3 秒。',
          '**config:** 格式化 ui 配置中的元组结构。',
          '**security:** 将 lock_password 迁移到统一的 master_password 定义。',
          '**ssh:** 将单一 session handle 解耦为多层 SshConnectionHandles。',
          '**panel:** 将 QuickCommands 和 SerialSendPanel 迁移到 panel 模块。',
          '**ui:** 移除旧的全屏快捷键和冗余菜单项。',
          '**panel:** 调整活动会话数量指示器的格式。',
          '提交剩余更改。',
          '**keywordhighlight:** 更新 token 边界处理，消除冲突。',
          '**i18n:** 为终端设置新增行号和时间戳选项。',
        ],
      },
      {
        title: '修复',
        items: [
          '**otp:** 正确解码 URL 编码中的多字节 UTF-8 字符。',
          '**ssh:** 防止提示注入脚本污染 shell 历史记录。',
          '**session:** 在关闭会话期间静默忽略 not-found 错误。',
          '**terminal:** 在附加到即将终止的会话时抑制错误。',
          '**terminal:** 当没有活动建议或选择项时，避免错误地关闭建议列表。',
          '**settings:** 默认禁用终端设置中的关键词高亮和动作链接。',
        ],
      },
      {
        title: '性能',
        items: ['仅在成功关闭后再从 UI 中移除工作区标签页。', '使分屏窗口中的会话放置逻辑更加明确。', '减少终端工作区中的不必要重渲染。'],
      },
      {
        title: '文档',
        items: ['新增 CLAUDE.md，提供开发指南和架构概览。'],
      },
    ],
  },
  {
    version: '[0.6.1] - 2026-04-11',
    sections: [
      {
        title: '变更',
        items: ['更新 sync-version 脚本中的版本同步逻辑。', '将 nyaterm 依赖版本更新为 0.6.0。'],
      },
    ],
  },
  {
    version: '[0.6.0] - 2026-04-11',
    sections: [
      {
        title: '新增',
        items: [
          '**proxy:** 新增独立的代理与隧道管理。',
          '**sftp:** 增强文件传输，支持并发、重试和时间戳。',
          '**ui:** 实现网络面板和设置重构。',
          '实现用于安全管理应用设置和验证密码的 Tauri 命令。',
          '**network:** 增强隧道配置界面。',
          '新增会话录制和自定义传输偏好设置。',
          '**ui:** 新增 OtpDialog 以支持双因素认证。',
          '**core:** 实现与 PendingAuthManager 和命令的 OTP 交互。',
          '**ui:** 实现 OSC7 CWD 跟踪支持和相关 UI 禁用状态。',
          '**ui:** 将 OtpDialog 集成到主应用布局中，并支持 i18n。',
          '**transfer:** 支持从传输底栏打开下载路径。',
          '**security:** 新增标签页数量显示，并更新 Key/Password 管理页签以显示数量。',
          '**ssh-form:** 增强 SSH 表单，加入代理和 OTP 配置选项。',
          '**otp:** 实现 OTP 管理及其与 UI 组件的集成。',
          '**prettier:** 新增用于 JSON 排序的 Prettier 配置，并更新 i18n 检查脚本。',
          '**search:** 为 SearchEngine 新增 show_in_menu 属性，并增强 SearchTab，加入可折叠的自定义引擎界面。',
          '**session:** 按类型启动本地、Telnet 和串口连接。',
          '**serial:** 在会话编辑器中显示检测到的串口。',
          '**serial:** 新增底部串口发送面板。',
        ],
      },
      {
        title: '变更',
        items: [
          '**ui:** 引入 shadcn UI 组件。',
          '**i18n:** 更新网络和传输功能的翻译。',
          '**translate:** 对 translate API 的模块依赖进行小幅更新。',
          '格式化会话代理相关导入。',
          '调整面板头部操作区布局。',
          '**deps:** 将 russh 升级到 0.60。',
          '**ui:** 将 saved-connections 对话框目录重命名为 connections。',
          '**core:** 重组 ssh、runtime 和 import 的模块结构。',
          '更新内部导入并完成 ssh 模块提取。',
          '**core:** 采用新的 ssh 和 runtime 模块结构。',
          '**ui:** 更新 Header 中针对新 connections 目录的导入路径。',
          '重构命令模块并更新导入路径，以提升组织性。',
          '**config:** 重命名存储模块并拆分 settings 配置。',
          '**runtime:** 提取 tauri 启动流程和命令适配器。',
          '**core:** 提取 history store 并统一 error 导入。',
          '**session-dialog:** 使新建会话表单具备更好的响应式布局。',
          '**dialog:** 改进快捷命令和自动上传布局。',
          '**settings:** 引入响应式设置外壳。',
          '**settings-search:** 重新布局自定义搜索引擎编辑器。',
          '**settings-terminal:** 重新布局动作链接和高亮编辑器。',
          '**panel:** 优化移动端面板和认证页签。',
          '**core:** 导出 watcher 模块。',
          '**rust:** 统一后端格式。',
          '**i18n:** 规范英文排序标签。',
          '**otp:** 内置本地 hotp 和 totp crate。',
          '**format:** 移除尾随空白。',
          '**format:** 去除 translate core 中末尾多余空行。',
          '**quick-commands:** 清理格式并改进 tooltip 组件结构。',
          '**resource-monitor:** 改进代码格式和结构，以提升可读性。',
          '**settings:** 重构设置组件，使用 SettingSection 来提升组织性和可读性。',
          '重组文件浏览器、认证和 save-connections 组件。',
          '**connection:** 将已保存连接 schema 规范化为类型化配置块。',
          '**saved-connections:** 提取带 tooltip 的头部操作按钮。',
          '**file-explorer:** 在工具栏中复用带 tooltip 的图标按钮。',
          '**i18n:** 移除已弃用的默认本地 shell 标签。',
          '**frontend:** 规范面板导入并进行小幅清理。',
          '**rust:** 隔离导入重排和换行调整。',
          '**file-explorer:** 为对话框导入增加包裹层以保持一致性。',
          '引入 FileUploadPage，并更新路由以替换 AutoUploadPage。',
        ],
      },
      {
        title: '修复',
        items: [
          '**ssh:** 使用 Mutex 解决并发访问 SshHandler 的问题。',
          '**security:** 为临时目录能力增加 app 作用域。',
          '**ui:** 处理关键词高亮缓存中的 xterm 缓冲区裁剪问题。',
          '**i18n:** 修正多个 UI 文案的中文翻译。',
          '**explorer:** 在同步目录之前规范化 cwd 路径。',
          '**panel:** 将 SecurityAuthPanel 的默认标签从 passwords 调整为 keys。',
          '**ssh:** 为 PowerShell 的 OSC 集成使用字符转义。',
          '**select:** 允许触发器内容在窄布局中收缩并截断。',
          '**session-ui:** 限制仅 SSH 会话显示相关面板，并明确路径同步提示。',
          '**session-editor:** 在清空表单时重置本地终端默认值。',
          '**i18n:** 更新串口相关文案，并恢复 serial send 的本地化支持。',
        ],
      },
    ],
  },
  {
    version: '[0.5.0] - 2026-04-07',
    sections: [
      {
        title: '新增',
        items: [
          '**window:** 实现子窗口模态管理和遮罩层。',
          '**auth:** 为 SSH 会话新增托管密码存储。',
          '**stats:** 为 SSH 会话新增远程资源监视器。',
          '**sftp:** 新增递归目录传输命令。',
        ],
      },
      {
        title: '变更',
        items: ['更新标签页边框和阴影样式。', '**ui:** 采用活动栏布局和自定义窗口 chrome。'],
      },
      {
        title: '修复',
        items: ['**i18n:** 优化中文语言环境中实验性关键词高亮描述。', '**terminal:** 在断开后重新连接 SSH 标签页。'],
      },
    ],
  },
  {
    version: '[0.4.0] - 2026-04-03',
    sections: [
      {
        title: '新增',
        items: [
          '实现 ChildWindowRouter，并在支持 i18n 的基础上增强窗口管理。',
          '增强关键词高亮设置及功能。',
          '更新交互设置中的分词分隔符，以提升解析效果。',
          '增强文件传输功能和加载状态管理。',
          '为 TerminalTab 新增折行关键词高亮设置。',
          '**session:** 在新建会话表单中新增多协议标签页。',
          '**file-explorer:** 在子窗口中打开自动上传提示。',
          '**appearance:** 支持独立终端主题和字体缩放。',
          '**terminal:** 新增可操作链接和悬浮菜单。',
        ],
      },
      {
        title: '变更',
        items: [
          '更新项目 URL 并增强构建脚本。',
          "**i18n:** 为英文和中文翻译新增 'Built-in' 字体标签。",
          '**ui:** 优化标签页外观并刷新连接图标。',
        ],
      },
      {
        title: '修复',
        items: ['**app:** 稳定活动标签页状态和终端默认值。', '**keywordhighlight:** 改进内置匹配和单元格映射。', '**build:** 对齐 Vite 类型和路径别名设置。'],
      },
      {
        title: '文档',
        items: ['新增支持双语的 Docusaurus 文档站点。', '重新设计首页并修复 i18n 问题。'],
      },
    ],
  },
  {
    version: '[0.3.5] - 2026-03-09',
    sections: [
      {
        title: '修复',
        items: ['**keywordhighlight:** 增强日期时间和数字模式，以提升匹配精度。'],
      },
    ],
  },
  {
    version: '[0.3.4] - 2026-03-09',
    sections: [
      {
        title: '变更',
        items: ['**terminal:** 将 kbd 元素替换为 Kbd 组件，以在 CommandSuggestions 和 ContextMenu 中保持一致性。'],
      },
    ],
  },
  {
    version: '[0.3.3] - 2026-03-09',
    sections: [
      {
        title: '新增',
        items: [
          '**terminal:** 新增关键词高亮功能。',
          '**connections:** 为连接项上下文菜单新增编辑选项。',
          '**settings:** 支持跳转到特定设置标签，并在获得焦点时自动刷新 SSH 密钥。',
          '**shortcuts:** 为终端和 UI 操作实现全局键盘快捷键。',
        ],
      },
      {
        title: '变更',
        items: [
          '同步 Cargo.lock 中的版本，并更新提交文件列表。',
          '**terminal:** 改进 TabBar 关闭按钮的界面和悬停状态。',
          '**terminal:** 终端 ref 改用 React.RefObject，替代 MutableRefObject。',
          '**theme:** 更新 githubLight 和 nordLight 主题下的终端光标颜色。',
        ],
      },
      {
        title: '修复',
        items: ['**terminal:** 在硬件加速切换时重新初始化 WebGL addon。', '**ssh:** 防止 OSC 7 注入污染 bash 历史记录。'],
      },
    ],
  },
  {
    version: '[0.2.1] - 2026-03-06',
    sections: [
      {
        title: '新增',
        items: [
          '**session-management:** 增强会话处理，加入自动连接功能。',
          '**types:** 为会话管理和 UI 配置新增完整的全局类型。',
          '**file-explorer:** 新增用于创建文件、文件夹和符号链接的对话框。',
          '**translate:** 实现 Google Translate 的动态 TKK 生成。',
          '**file-explorer:** 实现终端路径同步功能。',
        ],
      },
      {
        title: '变更',
        items: [
          '将 themes 和 types 迁移到 lib 目录。',
          '更新 `.gitignore`，加入更多文件模式。',
          '更新导入路径并增强翻译设置。',
          '更新到全局类型的导入路径。',
          '**icons:** 统一文件图标逻辑并增强图标导入。',
        ],
      },
    ],
  },
  {
    version: '[0.1.5] - 2026-03-06',
    sections: [
      {
        title: '新增',
        items: [
          '**ui:** 实现缩放级别持久化和视图设置。',
          '**ui:** 在关于对话框中加入可点击的首页和问题反馈链接。',
          '**ui:** 增强头部菜单，加入图标以及新的文档和日志帮助选项。',
          '**logging:** 增强 tracing 初始化，加入滚动文件 appender，并更新日志权限。',
          '**window:** 在启动时显示应用窗口，并更新 tauri 配置以允许窗口可见。',
          '**connections:** 新增用于分组管理 SSH 连接的 SavedConnections 面板。',
          '**watcher:** 新增文件监听支持和分块文件传输进度跟踪。',
          '**file-explorer:** 集成自定义对话框和上下文菜单支持。',
          '**settings:** 实现全局设置对话框和本地化。',
          '**terminal:** 新增终端上下文菜单工具和搜索栏。',
          '**security:** 新增锁屏和锁屏密码加密。',
          '**quick-commands:** 重新设计快捷命令界面，支持图标和变量。',
          '**file-transfer:** 新增文件属性对话框和传输进度条。',
          '**settings:** 新增翻译设置以及标签页式的设置/关于体验。',
          '**translate:** 新增 TranslationTab 和多提供商翻译服务。',
          '**terminal:** 增强 XTerminal，支持打开 URL 并改进命令历史处理。',
          '**app:** 引入全局应用上下文，并扩大 i18n 覆盖范围。',
          '**search:** 新增搜索引擎图标，并改进 SearchTab 的配置界面。',
          '**import:** 新增从 Xshell、MobaXterm 和 WindTerm 导入会话的功能。',
          '**ui:** 新增命令面板、popover 和可拖拽面板组件。',
          '**icons:** 扩展图标系统并更新类型定义。',
          '**connections:** 增强连接处理、反馈、排序和拖拽能力。',
          '**config:** 新增锁屏和连接排序模式设置。',
          '**security:** 实现锁屏开关和空闲检测。',
          '**suggestions:** 增强命令建议功能，支持多提供商。',
          '**event-listeners:** 使用事件监听替代轮询，以获取会话和命令历史更新。',
        ],
      },
      {
        title: '变更',
        items: [
          '新增 MIT License 文件。',
          '**assets:** 更新应用图标和 logo 资源，并移除未使用的 SVG。',
          '**cleanup:** 更新 tauri 配置并移除未使用资源。',
          '**i18n:** 在整个应用中集成 i18next。',
          '**ui:** 将页面标题从 `NyaTerm Terminal` 更新为 `NyaTerm`。',
          '更新滚动条样式。',
          '更新全局 UI、布局可见性和主题配置。',
          '采用 shadcn/ui 组件。',
          '将 toast 通知迁移到 sonner，并使用 shadcn 上下文菜单。',
          '将设置对话框更新为使用开关和标签页界面。',
          '**i18n:** 更新新组件和功能的本地化文案。',
          '更新排版、CSS 变量、主题颜色和章节标题。',
          '更新依赖、共享工具、类型、UI 组件和面板。',
          '**backend:** 将配置和命令模块拆分为子模块。',
          '**theme:** 使用 CSS 变量和预设主题重构主题系统。',
          '**dialog:** 将对话框重组到按领域划分的子目录中。',
          '**settings:** 为新的配置结构更新设置页签。',
          '**app:** 刷新 App、contexts、布局和面板组件。',
          '**i18n:** 为新增的设置和 UI 流程补充语言键。',
          '**window:** 将对话框迁移为独立子窗口。',
          '**file-explorer:** 模块化文件树并替换原生对话框。',
          '**terminal:** 清理格式和多余空白。',
          '**tracing:** 改进本地时间格式，并移除内联密钥迁移逻辑。',
          '**dialogs:** 移除 NewSessionDialog、SettingsDialog 和 QuickCommandDialog。',
          '**components:** 提取设置组件并统一导入路径。',
          '从仓库中删除生成的构建产物。',
          '将版本提升到 `0.1.5`，并新增版本同步脚本。',
        ],
      },
      {
        title: '修复',
        items: [
          '修复对话框可访问性警告。',
          '更新 SearchTab 中翻译键的用法，使设置说明更清晰。',
          '改进会话处理和界面响应性。',
          '**settings:** 更新复制和粘贴的默认交互设置。',
          '**translations:** 移除对话框和组件中翻译键的 fallback 值。',
        ],
      },
      {
        title: '性能',
        items: ['**sftp,ssh:** 优化传输速度并新增符号链接支持。'],
      },
      {
        title: '文档',
        items: ['更新 README，补充关键特性和使用说明。', '移除 README 标语末尾的句号。'],
      },
    ],
  },
];

const changelogReleasesByLocale: Record<string, ChangelogRelease[]> = {
  en: changelogReleasesEn,
  'zh-CN': changelogReleasesZhCN,
};

export function getChangelogReleases(locale: string): ChangelogRelease[] {
  return changelogReleasesByLocale[locale] ?? changelogReleasesByLocale['zh-CN'];
}
