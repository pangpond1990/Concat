// SPDX-License-Identifier: AGPL-3.0-or-later
fn main() {
    std::thread::Builder::new().stack_size(512 << 20).spawn(|| {
        let config = slint_build::CompilerConfiguration::new()
            .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles);
        slint_build::compile_with_config("../../src/crates/concat/ui/app.slint", config)
            .expect("compile the original Concat UI");
    }).unwrap().join().unwrap();
}
