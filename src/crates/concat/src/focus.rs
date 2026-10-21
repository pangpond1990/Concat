// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared native/browser click-away hit test.
pub fn press_misses_focused_input(window: &slint::Window, x: f32, y: f32) -> bool {
    use slint::private_unstable_api::re_exports::{LogicalPoint, TextInput, WindowInner};

    let focused = WindowInner::from_pub(window).focus_item.borrow().upgrade();
    let Some(item) = focused else {
        return false;
    };
    if item.downcast::<TextInput>().is_none() {
        return false;
    }
    const SLACK: f32 = 8.0;
    let origin = item.map_to_window(LogicalPoint::default());
    let size = item.geometry().size;
    let inside = x >= origin.x - SLACK
        && x <= origin.x + size.width + SLACK
        && y >= origin.y - SLACK
        && y <= origin.y + size.height + SLACK;
    !inside
}
