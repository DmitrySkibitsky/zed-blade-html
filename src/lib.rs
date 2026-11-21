//! Zed extension: starts the `blade-html` language server for Blade files.
//!
//! The server (TypeScript, bundled into one `CommonJS` file by `server/build.mjs`) is attached to the
//! GitHub release of the same version as the extension (`v<version>`, see
//! `.github/workflows/release.yml`). It is downloaded into the extension's work directory on first
//! start and run with the Node.js that Zed manages; extension and server versions always match.
//!
//! `lsp.blade-html.binary` in Zed settings overrides the command: `path` (+ `arguments`) runs any
//! binary, `arguments` alone runs Zed's Node.js with them (e.g. a local
//! `server/dist/blade-html-server.cjs` while developing). `lsp.blade-html.settings` /
//! `initialization_options` are passed through to the server.

use std::fs;

use zed_extension_api::{
    self as zed, DownloadedFileType, GithubReleaseAsset, LanguageServerId,
    LanguageServerInstallationStatus, Result, serde_json,
    settings::{CommandSettings, LspSettings},
};

const REPOSITORY: &str = "DmitrySkibitsky/zed-blade-html";
const SERVER_ASSET: &str = "blade-html-server.cjs";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const SERVER_DIR_PREFIX: &str = "server-v";

struct BladeHtmlExtension {
    /// Absolute path of the downloaded server script.
    server_path: Option<String>,
}

impl BladeHtmlExtension {
    /// The server script of this extension version, downloaded on first use.
    fn server_script(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        if let Some(path) = &self.server_path
            && fs::metadata(path).is_ok_and(|m| m.is_file())
        {
            return Ok(path.clone());
        }

        let dir = server_dir();
        let path = format!("{dir}/{SERVER_ASSET}");
        if !fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            if let Err(error) = download_server(language_server_id, &dir, &path) {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &LanguageServerInstallationStatus::Failed(error.clone()),
                );
                return Err(error);
            }
            remove_stale_servers(&dir);
        }

        let path = std::env::current_dir()
            .map_err(|e| format!("failed to resolve the extension work directory: {e}"))?
            .join(&path)
            .to_string_lossy()
            .into_owned();
        self.server_path = Some(path.clone());
        Ok(path)
    }
}

fn download_server(language_server_id: &LanguageServerId, dir: &str, path: &str) -> Result<()> {
    zed::set_language_server_installation_status(
        language_server_id,
        &LanguageServerInstallationStatus::CheckingForUpdate,
    );
    let tag = release_tag();
    let release = zed::github_release_by_tag_name(REPOSITORY, &tag).map_err(|e| {
        format!(
            "blade-html: release {tag} of {REPOSITORY} not found ({e}). To run a local server \
             build, set lsp.blade-html.binary.arguments in Zed settings."
        )
    })?;
    let asset = find_server_asset(&release.assets)
        .ok_or_else(|| format!("blade-html: release {tag} has no {SERVER_ASSET} asset"))?;

    zed::set_language_server_installation_status(
        language_server_id,
        &LanguageServerInstallationStatus::Downloading,
    );
    fs::create_dir_all(dir).map_err(|e| format!("failed to create {dir}: {e}"))?;
    zed::download_file(&asset.download_url, path, DownloadedFileType::Uncompressed)
        .map_err(|e| format!("blade-html: failed to download {SERVER_ASSET}: {e}"))?;
    zed::set_language_server_installation_status(
        language_server_id,
        &LanguageServerInstallationStatus::None,
    );
    Ok(())
}

impl zed::Extension for BladeHtmlExtension {
    fn new() -> Self {
        Self { server_path: None }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        let env = binary
            .as_ref()
            .and_then(|b| b.env.clone())
            .map_or_else(Vec::new, |env| env.into_iter().collect());

        match binary {
            Some(CommandSettings {
                path: Some(path),
                arguments,
                ..
            }) => Ok(zed::Command {
                command: path,
                args: arguments.unwrap_or_else(|| vec!["--stdio".into()]),
                env,
            }),
            Some(CommandSettings {
                path: None,
                arguments: Some(arguments),
                ..
            }) => Ok(zed::Command {
                command: zed::node_binary_path()?,
                args: arguments,
                env,
            }),
            _ => Ok(zed::Command {
                command: zed::node_binary_path()?,
                args: vec![self.server_script(language_server_id)?, "--stdio".into()],
                env,
            }),
        }
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(
            LspSettings::for_worktree(language_server_id.as_ref(), worktree)
                .ok()
                .and_then(|settings| settings.initialization_options.or(settings.settings)),
        )
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(
            LspSettings::for_worktree(language_server_id.as_ref(), worktree)
                .ok()
                .and_then(|settings| settings.settings),
        )
    }
}

fn release_tag() -> String {
    format!("v{VERSION}")
}

/// Per-version directory, so an extension update never runs an older server.
fn server_dir() -> String {
    format!("{SERVER_DIR_PREFIX}{VERSION}")
}

fn find_server_asset(assets: &[GithubReleaseAsset]) -> Option<&GithubReleaseAsset> {
    assets.iter().find(|asset| asset.name == SERVER_ASSET)
}

/// Servers of other versions in the work directory, including the bundles that 0.x development
/// builds embedded (`blade-html-server-<hash>.cjs`).
fn is_stale_server(entry: &str, current_dir: &str) -> bool {
    (entry.starts_with(SERVER_DIR_PREFIX) && entry != current_dir)
        || entry.starts_with("blade-html-server-")
}

fn remove_stale_servers(current_dir: &str) {
    let Ok(entries) = fs::read_dir(".") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if is_stale_server(&name.to_string_lossy(), current_dir) {
            let path = entry.path();
            let _ = if path.is_dir() {
                fs::remove_dir_all(path)
            } else {
                fs::remove_file(path)
            };
        }
    }
}

zed::register_extension!(BladeHtmlExtension);

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> GithubReleaseAsset {
        GithubReleaseAsset {
            name: name.into(),
            download_url: format!("https://example.test/{name}"),
        }
    }

    #[test]
    fn release_tag_and_dir_follow_the_crate_version() {
        assert_eq!(release_tag(), format!("v{}", env!("CARGO_PKG_VERSION")));
        assert_eq!(
            server_dir(),
            format!("server-v{}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn finds_the_server_asset_by_exact_name() {
        let assets = [
            asset("blade-html-server.cjs.sha256"),
            asset("blade-html-server.cjs"),
            asset("source.tar.gz"),
        ];
        assert_eq!(
            find_server_asset(&assets).map(|a| a.download_url.as_str()),
            Some("https://example.test/blade-html-server.cjs")
        );
        assert!(find_server_asset(&[asset("other.js")]).is_none());
    }

    #[test]
    fn stale_servers_are_other_versions_and_embedded_bundles() {
        let current = "server-v0.2.0";
        assert!(!is_stale_server("server-v0.2.0", current));
        assert!(is_stale_server("server-v0.1.0", current));
        assert!(is_stale_server(
            "blade-html-server-0123456789abcdef.cjs",
            current
        ));
        assert!(!is_stale_server("node_modules", current));
        assert!(!is_stale_server("settings.json", current));
    }
}
