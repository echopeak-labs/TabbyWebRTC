use crate::synthetic::SyntheticCapturable;
use crate::{SourceDescriptor, SourceKind};

#[cfg(feature = "x11-capture")]
use crate::x11_source::{self, is_x11_session};

#[cfg(all(feature = "scap-capture", not(feature = "x11-capture")))]
use crate::scap_source::{scap_targets, ScapCapturable, target_dimensions, target_from_id};

pub fn enumerate_sources() -> anyhow::Result<Vec<SourceDescriptor>> {
    #[cfg(feature = "x11-capture")]
    {
        if is_x11_session() {
            match x11_source::enumerate_displays() {
                Ok(mut sources) if !sources.is_empty() => {
                    match x11_source::enumerate_windows() {
                        Ok(windows) if !windows.is_empty() => sources.extend(windows),
                        Ok(_) => {
                            tracing::info!("no x11 client windows; using process heuristics");
                            sources.extend(x11_source::enumerate_common_gui_processes());
                        }
                        Err(err) => {
                            tracing::warn!(%err, "x11 window enumeration failed");
                            sources.extend(x11_source::enumerate_common_gui_processes());
                        }
                    }
                    return Ok(sources);
                }
                Ok(_) => tracing::warn!("x11 display enumeration returned no monitors"),
                Err(err) => tracing::warn!(%err, "x11 display enumeration failed"),
            }
        } else {
            tracing::error!(
                "Wayland is not supported for display capture; log into an X11 session"
            );
        }
    }

    #[cfg(all(feature = "scap-capture", not(feature = "x11-capture")))]
    {
        if scap::is_supported() {
            let mut sources = Vec::new();
            for target in scap_targets() {
                match target {
                    scap::targets::Target::Display(display) => {
                        let (width, height) =
                            target_dimensions(&scap::targets::Target::Display(display.clone()));
                        sources.push(SourceDescriptor {
                            id: format!("display-{}", display.id),
                            name: display.title,
                            kind: SourceKind::Display,
                            width,
                            height,
                        });
                    }
                    scap::targets::Target::Window(window) => {
                        let (width, height) =
                            target_dimensions(&scap::targets::Target::Window(window.clone()));
                        sources.push(SourceDescriptor {
                            id: format!("app-{}", window.id),
                            name: window.title,
                            kind: SourceKind::App,
                            width,
                            height,
                        });
                    }
                }
            }
            if !sources.is_empty() {
                return Ok(sources);
            }
        }
    }
    Ok(fallback_sources())
}

pub fn capture_thumbnail(source_id: &str) -> anyhow::Result<Vec<u8>> {
    let mut source = create_capturable(source_id, &crate::CaptureConfig::default())?;
    source.capture_thumbnail()
}

pub fn create_capturable(
    source_id: &str,
    config: &crate::CaptureConfig,
) -> anyhow::Result<Box<dyn crate::Capturable>> {
    #[cfg(feature = "x11-capture")]
    if is_x11_session() {
        return x11_source::create_from_id(source_id, config);
    }
    #[cfg(feature = "x11-capture")]
    if !is_x11_session() {
        anyhow::bail!("Wayland is not supported for display capture; log into an X11 session");
    }

    #[cfg(all(feature = "scap-capture", not(feature = "x11-capture")))]
    {
        if let Ok(Some(target)) = target_from_id(source_id) {
            let (name, _) = match &target {
                scap::targets::Target::Display(d) => (d.title.clone(), SourceKind::Display),
                scap::targets::Target::Window(w) => (w.title.clone(), SourceKind::App),
            };
            let (width, height) = target_dimensions(&target);
            return Ok(Box::new(ScapCapturable::from_target(
                source_id.to_string(),
                name,
                Some(target),
                width,
                height,
                config.hide_cursor,
                config.max_fps,
            )));
        }
        if scap::is_supported() && source_id == "display-0" {
            return Ok(Box::new(ScapCapturable::from_target(
                source_id.to_string(),
                "Primary Display".into(),
                None,
                1920,
                1080,
                config.hide_cursor,
                config.max_fps,
            )));
        }
    }

    let (name, width, height) = match source_id {
        "display-0" => ("Primary Display", 1920, 1080),
        other if other.starts_with("app-") => ("Application Window", 1280, 720),
        _ => anyhow::bail!("unknown source id {source_id}"),
    };
    let _ = config;
    tracing::warn!(
        source_id,
        "using synthetic capture; rebuild with --features x11-capture for real display frames"
    );
    Ok(Box::new(SyntheticCapturable::display(
        source_id,
        name,
        width,
        height,
    )))
}

fn fallback_sources() -> Vec<SourceDescriptor> {
    vec![SourceDescriptor {
        id: "display-0".into(),
        name: "Primary Display".into(),
        kind: SourceKind::Display,
        width: 1920,
        height: 1080,
    }]
}
