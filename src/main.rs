use axum::{
    extract::State,
    http::{HeaderMap, Method, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Router,
};
use bytes::Bytes;
use tower_http::services::ServeDir;

const BASE: &str = "https://kundoluk.edu.gov.kg";

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = AppState {
        client: reqwest::Client::builder()
            .user_agent("Dart/3.5 (dart:io)")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("http client"),
    };

    if let Ok(base) = std::env::var("RENDER_EXTERNAL_URL") {
        let client = state.client.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(40)).await;
                let url = format!("{}/health", base.trim_end_matches('/'));
                match client.get(&url).send().await {
                    Ok(r) => tracing::info!("keep-alive ping {} -> {}", url, r.status()),
                    Err(e) => tracing::warn!("keep-alive ping failed: {}", e),
                }
            }
        });
    }

    let proxy_router = Router::new()
        .fallback(proxy)
        .with_state(state.clone());

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/health", get(health))
        .route("/api/test-upstream", get(test_upstream))
        .route("/api/login/parent", post(login_parent))
        .route("/api/login/student", post(login_student))
        .nest("/api/p", proxy_router)
        .nest_service("/static", ServeDir::new("static"))
        .layer(tower_http::compression::CompressionLayer::new())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("kundoluk-web listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn serve_index() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

async fn health() -> &'static str {
    "ok"
}

async fn test_upstream(State(state): State<AppState>) -> Response {
    let url = "https://kundoluk.edu.gov.kg";
    match state.client.get(url).timeout(std::time::Duration::from_secs(8)).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            (StatusCode::OK, format!("kundoluk.edu.gov.kg -> {} body={}", status, &body[..body.len().min(200)])).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("kundoluk.edu.gov.kg -> ERR {:?}", e)).into_response(),
    }
}

async fn login_parent(State(state): State<AppState>, body: Bytes) -> Response {
    forward(&state, "POST", "/api/parentauth/AuthenticateMobileParent", body).await
}

async fn login_student(State(state): State<AppState>, body: Bytes) -> Response {
    forward(&state, "POST", "/api/auth/loginStudent", body).await
}

async fn forward(state: &AppState, method: &str, path: &str, body: Bytes) -> Response {
    let url = format!("{}{}", BASE, path);
    let mut req = match method {
        "POST" => state.client.post(&url),
        "GET" => state.client.get(&url),
        _ => state.client.post(&url),
    };
    req = req
        .header("Accept", "application/json")
        .header("Content-Type", "application/json");
    if !body.is_empty() {
        req = req.body(body);
    }
    match req.send().await {
        Ok(resp) => build_response(resp).await,
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn proxy(
    State(state): State<AppState>,
    method: Method,
    uri: axum::http::Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let raw_path = uri.path();
    let rest = raw_path
        .strip_prefix("/api/p/")
        .or_else(|| raw_path.strip_prefix("/"))
        .unwrap_or(raw_path)
        .trim_start_matches('/')
        .to_string();
    if rest.is_empty() {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    if !(rest.starts_with("parent/") || rest.starts_with("student/") || rest.starts_with("notification/")) {
        return (StatusCode::FORBIDDEN, "forbidden path").into_response();
    }
    let mut url = format!("{}/api/{}", BASE, rest);
    if let Some(q) = uri.query() {
        url.push('?');
        url.push_str(q);
    }
    let mut req = state.client.request(method, &url);
    req = req.header("Accept", "application/json");
    if let Some(auth) = headers.get("authorization") {
        if let Ok(v) = auth.to_str() {
            req = req.header("Authorization", v);
        }
    }
    if !body.is_empty() {
        req = req.body(body);
        if let Some(ct) = headers.get("content-type") {
            if let Ok(v) = ct.to_str() {
                req = req.header("Content-Type", v);
            }
        } else {
            req = req.header("Content-Type", "application/json");
        }
    }
    match req.send().await {
        Ok(resp) => build_response(resp).await,
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn build_response(resp: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.unwrap_or_default();
    let mut builder = Response::builder().status(status);
    if let Some(ct) = ct {
        builder = builder.header("content-type", ct);
    }
    builder.body(bytes.into()).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

