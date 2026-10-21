// SPDX-License-Identifier: AGPL-3.0-or-later
//! Pure text insertion shared by the native and browser UI.
pub fn insert_tag(text: &str, tag: &str, at: usize) -> String {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    let (before, after) = text.split_at(at);
    let lead = if before.is_empty() || before.ends_with(char::is_whitespace) {
        ""
    } else {
        " "
    };
    let trail = if after.starts_with(char::is_whitespace) {
        ""
    } else {
        " "
    };
    format!("{before}{lead}{tag}{trail}{after}")
}
