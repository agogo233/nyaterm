use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionSettings {
    #[serde(default = "default_true")]
    pub copy_on_select: bool,
    #[serde(default = "default_true")]
    pub right_click_paste: bool,
    #[serde(default = "default_true")]
    pub command_suggestions_enabled: bool,
    #[serde(default = "default_command_suggestion_min_chars")]
    pub command_suggestion_min_chars: usize,
    #[serde(default = "default_command_suggestion_max_chars")]
    pub command_suggestion_max_chars: usize,
    #[serde(default = "default_duplicate_session_command_delay_ms")]
    pub duplicate_session_command_delay_ms: u64,
    #[serde(default = "default_word_separators")]
    pub word_separators: String,
    #[serde(default)]
    pub alt_as_meta: bool,
    #[serde(default)]
    pub mac_ime_compatibility: bool,
    #[serde(default = "default_encoding")]
    pub default_encoding: String,
    #[serde(default = "default_tab_double_click_action")]
    pub tab_double_click_action: String,
    #[serde(default = "default_tab_middle_click_action")]
    pub tab_middle_click_action: String,
    #[serde(default = "default_tab_right_click_action")]
    pub tab_right_click_action: String,
}

fn default_command_suggestion_min_chars() -> usize {
    2
}

fn default_command_suggestion_max_chars() -> usize {
    64
}

fn default_duplicate_session_command_delay_ms() -> u64 {
    1000
}

fn default_word_separators() -> String {
    " ()[]{}\"':=,;|&<>".to_string()
}
fn default_encoding() -> String {
    "UTF-8".to_string()
}

fn default_tab_double_click_action() -> String {
    "disconnect_session".to_string()
}

fn default_tab_middle_click_action() -> String {
    "rename_tab".to_string()
}

fn default_tab_right_click_action() -> String {
    "none".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for InteractionSettings {
    fn default() -> Self {
        Self {
            copy_on_select: false,
            right_click_paste: false,
            command_suggestions_enabled: true,
            command_suggestion_min_chars: default_command_suggestion_min_chars(),
            command_suggestion_max_chars: default_command_suggestion_max_chars(),
            duplicate_session_command_delay_ms: default_duplicate_session_command_delay_ms(),
            word_separators: default_word_separators(),
            alt_as_meta: false,
            mac_ime_compatibility: false,
            default_encoding: default_encoding(),
            tab_double_click_action: default_tab_double_click_action(),
            tab_middle_click_action: default_tab_middle_click_action(),
            tab_right_click_action: default_tab_right_click_action(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interaction_defaults_include_tab_mouse_actions() {
        let settings = InteractionSettings::default();

        assert_eq!(settings.tab_double_click_action, "disconnect_session");
        assert_eq!(settings.tab_middle_click_action, "rename_tab");
        assert_eq!(settings.tab_right_click_action, "none");
        assert!(!settings.alt_as_meta);
        assert!(!settings.mac_ime_compatibility);
    }

    #[test]
    fn legacy_interaction_settings_deserialize_with_tab_mouse_defaults() {
        let settings: InteractionSettings = serde_json::from_value(serde_json::json!({
            "copy_on_select": false,
            "right_click_paste": false,
            "command_suggestions_enabled": true,
            "command_suggestion_min_chars": 2,
            "command_suggestion_max_chars": 64,
            "word_separators": " ()[]{}\"':=,;|&<>",
            "default_encoding": "UTF-8"
        }))
        .unwrap();

        assert_eq!(settings.tab_double_click_action, "disconnect_session");
        assert_eq!(settings.tab_middle_click_action, "rename_tab");
        assert_eq!(settings.tab_right_click_action, "none");
        assert_eq!(settings.duplicate_session_command_delay_ms, 1000);
        assert!(!settings.alt_as_meta);
        assert!(!settings.mac_ime_compatibility);
    }
}
