use crate::synthetic::SyntheticCapturable;
use crate::{SourceDescriptor, SourceKind};

#[cfg(feature = "scap-capture")]
use crate::scap_source::{scap_targets, ScapCapturable, target_dimensions, target_from_id};

pub fn enumerate_sources() -> anyhow::Result<Vec<SourceDescriptor>> {
    #[cfg(feature = "scap-capture")]
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
    #[cfg(feature = "scap-capture")]
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
        "using synthetic capture; rebuild with --features scap-capture for real display frames"
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
