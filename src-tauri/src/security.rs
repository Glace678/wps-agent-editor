use url::Url;

/// Keep the document webview on application-owned origins. External links are
/// opened by an explicit opener command and must never replace the renderer.
pub fn navigation_allowed(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" => matches!(url.host_str(), None | Some("localhost")),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "about" => url.as_str() == "about:blank",
        "http" if cfg!(debug_assertions) => {
            matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
                && url.port_or_known_default() == Some(1420)
        }
        _ => false,
    }
}

pub fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_, url| navigation_allowed(url))
        .build()
}

#[cfg(test)]
mod tests {
    use super::navigation_allowed;
    use url::Url;

    #[test]
    fn permits_only_application_origins() {
        assert!(navigation_allowed(
            &Url::parse("tauri://localhost/").unwrap()
        ));
        assert!(navigation_allowed(
            &Url::parse("http://tauri.localhost/index.html").unwrap()
        ));
        assert!(navigation_allowed(&Url::parse("about:blank").unwrap()));
        assert!(!navigation_allowed(
            &Url::parse("https://example.com/phishing").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("data:text/html,<script>alert(1)</script>").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("file:///etc/passwd").unwrap()
        ));
    }

    #[test]
    fn development_server_is_exactly_scoped() {
        let local = Url::parse("http://127.0.0.1:1420/").unwrap();
        assert_eq!(navigation_allowed(&local), cfg!(debug_assertions));
        assert!(!navigation_allowed(
            &Url::parse("http://127.0.0.1:9999/").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("http://localhost.example:1420/").unwrap()
        ));
    }
}
