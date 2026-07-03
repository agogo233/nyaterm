import type { Terminal } from "@xterm/xterm";

const CTRL_L_INPUT = "\x0c";

export function sendTerminalClearInput(terminal: Terminal, options: { focus?: boolean } = {}) {
  terminal.clearSelection();
  terminal.input(CTRL_L_INPUT, false);
  if (options.focus) {
    terminal.focus();
  }
}
