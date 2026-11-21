fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=native/macos_print.m");
        let mut native = cc::Build::new();
        native.file("native/macos_print.m").flag("-fobjc-arc");
        if cfg!(feature = "dev012-test-hooks") {
            native.define("KNOWPAPER_PRINT_PROBE", None);
        }
        native.compile("knowpaper_macos_print");
        for framework in ["AppKit", "WebKit", "PDFKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build();
}
