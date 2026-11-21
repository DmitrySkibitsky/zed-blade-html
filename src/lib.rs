//! Zed extension: starts the `blade-html` language server for Blade files.
//!
//! The server (TypeScript, bundled by `server/build.mjs`) is embedded in the extension and written
//! to the extension's work directory on first start, then run with the Node.js that Zed manages:
//! no download, no npm install at runtime.
//!
//! `lsp.blade-html.binary` in Zed settings overrides the command (e.g. to run a development build
//! of the server); `lsp.blade-html.settings` / `initialization_options` are passed through.

use std::fs;

use zed_extension_api::{self as zed, LanguageServerId, Result, serde_json, settings::LspSettings};

/// The bundled language server (`server/dist/blade-html-server.cjs`, committed).
const SERVER_SOURCE: &str = include_str!("../server/dist/blade-html-server.cjs");
const SERVER_FILE_PREFIX: &str = "blade-html-server-";

struct BladeHtmlExtension {
    /// Absolute path of the server script written to the work directory.
    server_path: Option<String>,
}

impl BladeHtmlExtension {
    /// Writes the embedded server once per content version and returns its absolute path.
    fn server_script(&mut self) -> Result<String> {
        if let Some(path) = &self.server_path
            && fs::metadata(path).is_ok()
        {
            return Ok(path.clone());
        }

        let file_name = server_file_name(SERVER_SOURCE);
        let up_to_date =
            fs::metadata(&file_name).is_ok_and(|m| m.len() == SERVER_SOURCE.len() as u64);
        if !up_to_date {
            fs::write(&file_name, SERVER_SOURCE)
                .map_err(|e| format!("failed to write {file_name}: {e}"))?;
        }
        remove_stale_servers(&file_name);

        let path = std::env::current_dir()
            .map_err(|e| format!("failed to resolve the extension work directory: {e}"))?
            .join(&file_name)
            .to_string_lossy()
            .into_owned();
        self.server_path = Some(path.clone());
        Ok(path)
    }
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
        if let Some(binary) = binary
            && let Some(path) = binary.path
        {
            return Ok(zed::Command {
                command: path,
                args: binary.arguments.unwrap_or_else(|| vec!["--stdio".into()]),
                env: binary
                    .env
                    .map_or_else(Vec::new, |env| env.into_iter().collect()),
            });
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![self.server_script()?, "--stdio".into()],
            env: Vec::default(),
        })
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

/// `blade-html-server-<fnv1a64 of the content>.cjs`: a new bundle never reuses a stale file.
fn server_file_name(source: &str) -> String {
    format!(
        "{SERVER_FILE_PREFIX}{:016x}.cjs",
        fnv1a64(source.as_bytes())
    )
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Removes server bundles of previous extension versions from the work directory.
fn remove_stale_servers(current: &str) {
    let Ok(entries) = fs::read_dir(".") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(SERVER_FILE_PREFIX)
            && (name.ends_with(".js") || name.ends_with(".cjs"))
            && name != current
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

zed::register_extension!(BladeHtmlExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a64_matches_reference_vectors() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x8594_4171_f739_67e8);
    }

    #[test]
    fn server_file_name_depends_on_content() {
        let a = server_file_name("console.log(1)");
        let b = server_file_name("console.log(2)");
        assert!(a.starts_with(SERVER_FILE_PREFIX));
        assert_eq!(
            std::path::Path::new(&a).extension(),
            Some(std::ffi::OsStr::new("cjs"))
        );
        assert_ne!(a, b);
        assert_eq!(a, server_file_name("console.log(1)"));
    }

    #[test]
    fn embedded_server_is_the_bundle() {
        assert!(
            SERVER_SOURCE.len() > 10_000,
            "server/dist is empty — run `make server`"
        );
        assert!(SERVER_SOURCE.contains("blade-html"));
    }
}
