use anyhow::Context;
use serde::Deserialize;
use webrtc_peer::TurnConfig;

#[derive(Debug, Deserialize)]
struct TurnResponse {
    urls: Vec<String>,
    username: String,
    credential: String,
}

pub async fn fetch_turn_config(api_url: &str, agent_jwt: &str) -> anyhow::Result<Option<TurnConfig>> {
    let base = api_url.trim_end_matches('/');
    if base.is_empty() || base.contains("REPLACE") {
        return Ok(None);
    }

    let url = format!("{base}/turn-credentials");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .context("turn HTTP client")?;

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {agent_jwt}"))
        .send()
        .await
        .context("turn credentials request failed")?;

    if !response.status().is_success() {
        anyhow::bail!("turn credentials HTTP {}", response.status());
    }

    let body: TurnResponse = response.json().await.context("turn credentials parse failed")?;
    if body.urls.is_empty() {
        return Ok(None);
    }

    Ok(Some(TurnConfig {
        urls: body.urls,
        username: body.username,
        credential: body.credential,
    }))
}
