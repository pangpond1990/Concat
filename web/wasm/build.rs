// SPDX-License-Identifier: AGPL-3.0-or-later
fn main() {
    // Reuse the actual upstream font inventory without linking native text I/O.
    let text_source = std::fs::read_to_string("../../src/crates/concat-text/src/lib.rs").unwrap();
    let font_dir = std::fs::canonicalize("../../src/crates/concat-text/fonts").unwrap();
    let mut fonts = String::new();
    for name in ["BASE_FONTS", "NOTO_SANS_CJK_SC", "NOTO_SANS_ARABIC_UI", "NOTO_SANS_HEBREW", "NOTO_SANS_DEVANAGARI", "NOTO_SANS_BENGALI", "NOTO_SANS_THAI"] {
        let start = text_source.find(&format!("pub const {name}:")).unwrap();
        let equals = start + text_source[start..].find(" = ").unwrap();
        let end = equals + text_source[equals..].find(';').unwrap() + 1;
        fonts.push_str(&text_source[start..end].replace("../fonts/", &format!("{}/", font_dir.display())));
        fonts.push('\n');
    }
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("font_data.rs"), fonts).unwrap();
    println!("cargo:rerun-if-changed=../../src/crates/concat-text/src/lib.rs");
    std::thread::Builder::new().stack_size(512 << 20).spawn(|| {
        let config = slint_build::CompilerConfiguration::new()
            .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles);
        slint_build::compile_with_config("../../src/crates/concat/ui/app.slint", config)
            .expect("compile the original Concat UI");
    }).unwrap().join().unwrap();
}
