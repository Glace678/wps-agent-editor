use tauri::Manager;
use url::Url;

/// Keep the document webview on application-owned origins. External links are
/// opened by an explicit opener command and must never replace the renderer.
pub fn navigation_allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" | "asset" => matches!(url.host_str(), None | Some("localhost")),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "about" => url.as_str() == "about:blank",
        "http" if cfg!(debug_assertions) => {
            matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
                && dev_url.is_some_and(|configured| {
                    configured.scheme() == "http"
                        && matches!(configured.host_str(), Some("127.0.0.1") | Some("localhost"))
                        && url.port_or_known_default() == configured.port_or_known_default()
                })
        }
        _ => false,
    }
}

pub fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            navigation_allowed(url, webview.app_handle().config().build.dev_url.as_ref())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::navigation_allowed;
    use url::Url;

    #[test]
    fn permits_only_application_origins() {
        assert!(navigation_allowed(
            &Url::parse("tauri://localhost/").unwrap(),
            None,
        ));
        assert!(navigation_allowed(
            &Url::parse("http://tauri.localhost/index.html").unwrap(),
            None,
        ));
        assert!(navigation_allowed(
            &Url::parse("about:blank").unwrap(),
            None
        ));
        assert!(!navigation_allowed(
            &Url::parse("https://example.com/phishing").unwrap(),
            None,
        ));
        assert!(!navigation_allowed(
            &Url::parse("data:text/html,<script>alert(1)</script>").unwrap(),
            None,
        ));
        assert!(!navigation_allowed(
            &Url::parse("file:///etc/passwd").unwrap(),
            None,
        ));
    }

    #[test]
    fn development_server_is_exactly_scoped() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let local = Url::parse(config["build"]["devUrl"].as_str().unwrap()).unwrap();
        assert_eq!(
            navigation_allowed(&local, Some(&local)),
            cfg!(debug_assertions)
        );
        assert!(!navigation_allowed(&local, None));
        assert!(!navigation_allowed(
            &Url::parse("http://127.0.0.1:9999/").unwrap(),
            Some(&local),
        ));
        let mut impostor = local.clone();
        impostor.set_host(Some("localhost.example")).unwrap();
        assert!(!navigation_allowed(&impostor, Some(&local)));
        assert!(!navigation_allowed(&impostor, Some(&impostor)));
    }

    #[test]
    fn development_server_follows_the_configured_port() {
        let configured = Url::parse("http://127.0.0.1:54321/").unwrap();
        let alias = Url::parse("http://localhost:54321/index.html").unwrap();
        assert_eq!(
            navigation_allowed(&alias, Some(&configured)),
            cfg!(debug_assertions)
        );
        assert!(!navigation_allowed(
            &Url::parse("http://127.0.0.1:1420/").unwrap(),
            Some(&configured),
        ));
    }
}
