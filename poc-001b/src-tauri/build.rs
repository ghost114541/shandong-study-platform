fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=native/macos_print.m");
        cc::Build::new()
            .file("native/macos_print.m")
            .flag("-fobjc-arc")
            .compile("knowpaper_macos_print");
        for framework in ["AppKit", "WebKit", "PDFKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build();
}
