use crate::{SourceDescriptor, SourceKind};

pub fn enumerate_sources() -> anyhow::Result<Vec<SourceDescriptor>> {
    Ok(vec![SourceDescriptor {
        id: "display-0".into(),
        name: "Primary Display".into(),
        kind: SourceKind::Display,
        width: 1920,
        height: 1080,
    }])
}

pub fn capture_thumbnail(_source_id: &str) -> anyhow::Result<Vec<u8>> {
    Ok(crate::placeholder_thumbnail())
}
