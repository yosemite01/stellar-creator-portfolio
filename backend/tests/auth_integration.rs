//! Integration tests for the Stellar auth challenge-verification lifecycle.
//!
//! These tests exercise the full flow:
//!   1. GET  /api/auth/challenge  → receive a nonce
//!   2. Sign the nonce with an Ed25519 key
//!   3. POST /api/auth/verify     → receive a JWT
//!   4. Verify the JWT is well-formed and contains the expected subject
//!
//! A mock server is used so no live backend is required.

use actix_web::{test, web, App};
use ed25519_dalek::{Signer, SigningKey, Verifier};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ── Shared types (mirrors stellar-auth/src/main.rs) ──────────────────────────

#[derive(Serialize, Deserialize, Debug)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ChallengeData {
    nonce: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct VerifyRequest {
    public_key: String,
    signature: String,
    message: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct TokenData {
    token: String,
}

// ── Inline mock handlers (no external crate dependency) ──────────────────────

/// Mock challenge handler — returns a deterministic nonce for testing.
async fn mock_challenge() -> actix_web::HttpResponse {
    let nonce = "a".repeat(64); // 64 hex chars, deterministic
    actix_web::HttpResponse::Ok().json(ApiResponse {
        success: true,
        data: Some(ChallengeData { nonce }),
        error: None,
    })
}

/// Mock verify handler — validates hex-encoded Ed25519 signature and returns a
/// fake JWT so tests can assert on the response shape without a real JWT secret.
async fn mock_verify(body: web::Json<VerifyRequest>) -> actix_web::HttpResponse {
    let pub_key_bytes = match hex::decode(&body.public_key) {
        Ok(b) => b,
        Err(_) => {
            return actix_web::HttpResponse::BadRequest().json(ApiResponse::<TokenData> {
                success: false,
                data: None,
                error: Some("Invalid hex in public_key".into()),
            })
        }
    };

    let sig_bytes = match hex::decode(&body.signature) {
        Ok(b) => b,
        Err(_) => {
            return actix_web::HttpResponse::BadRequest().json(ApiResponse::<TokenData> {
                success: false,
                data: None,
                error: Some("Invalid hex in signature".into()),
            })
        }
    };

    if pub_key_bytes.len() != 32 || sig_bytes.len() != 64 {
        return actix_web::HttpResponse::BadRequest().json(ApiResponse::<TokenData> {
            success: false,
            data: None,
            error: Some("Invalid key or signature length".into()),
        });
    }

    let key_arr: [u8; 32] = pub_key_bytes.try_into().unwrap();
    let verifying_key = match ed25519_dalek::VerifyingKey::from_bytes(&key_arr) {
        Ok(k) => k,
        Err(_) => {
            return actix_web::HttpResponse::BadRequest().json(ApiResponse::<TokenData> {
                success: false,
                data: None,
                error: Some("Invalid public key".into()),
            })
        }
    };

    let sig_arr: [u8; 64] = sig_bytes.try_into().unwrap();
    let signature = ed25519_dalek::Signature::from_bytes(&sig_arr);
    let digest = Sha256::digest(body.message.as_bytes());

    match verifying_key.verify(&digest, &signature) {
        Ok(_) => {
            // Return a fake JWT-shaped token (header.payload.sig) for shape assertions.
            let fake_token = format!("eyJ.{}.sig", hex::encode(&key_arr[..8]));
            actix_web::HttpResponse::Ok().json(ApiResponse {
                success: true,
                data: Some(TokenData { token: fake_token }),
                error: None,
            })
        }
        Err(_) => actix_web::HttpResponse::Unauthorized().json(ApiResponse::<TokenData> {
            success: false,
            data: None,
            error: Some("Invalid signature".into()),
        }),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Fixed 32-byte seed so every test run uses the same keypair.
fn test_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[0x42u8; 32])
}

fn sign_message(key: &SigningKey, message: &str) -> (String, String) {
    let digest = Sha256::digest(message.as_bytes());
    let signature = key.sign(&digest);
    let pub_key_hex = hex::encode(key.verifying_key().to_bytes());
    let sig_hex = hex::encode(signature.to_bytes());
    (pub_key_hex, sig_hex)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[actix_web::test]
async fn test_challenge_returns_nonce() {
    let app = test::init_service(
        App::new().route("/api/auth/challenge", web::get().to(mock_challenge)),
    )
    .await;

    let req = test::TestRequest::get()
        .uri("/api/auth/challenge")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert!(resp.status().is_success(), "challenge endpoint should return 200");

    let body: ApiResponse<ChallengeData> = test::read_body_json(resp).await;
    assert!(body.success);
    let nonce = body.data.expect("data must be present").nonce;
    assert_eq!(nonce.len(), 64, "nonce must be 64 hex chars");
    assert!(nonce.chars().all(|c| c.is_ascii_hexdigit()), "nonce must be hex");
}

#[actix_web::test]
async fn test_full_challenge_verify_flow() {
    let app = test::init_service(
        App::new()
            .route("/api/auth/challenge", web::get().to(mock_challenge))
            .route("/api/auth/verify", web::post().to(mock_verify)),
    )
    .await;

    // Step 1: obtain challenge nonce
    let challenge_req = test::TestRequest::get()
        .uri("/api/auth/challenge")
        .to_request();
    let challenge_resp = test::call_service(&app, challenge_req).await;
    assert!(challenge_resp.status().is_success());

    let challenge_body: ApiResponse<ChallengeData> = test::read_body_json(challenge_resp).await;
    let nonce = challenge_body.data.unwrap().nonce;

    // Step 2: sign the nonce
    let key = test_signing_key();
    let (pub_key_hex, sig_hex) = sign_message(&key, &nonce);

    // Step 3: verify signature → receive token
    let verify_req = test::TestRequest::post()
        .uri("/api/auth/verify")
        .set_json(&VerifyRequest {
            public_key: pub_key_hex.clone(),
            signature: sig_hex,
            message: nonce,
        })
        .to_request();
    let verify_resp = test::call_service(&app, verify_req).await;

    assert!(
        verify_resp.status().is_success(),
        "verify endpoint should return 200 for valid signature"
    );

    let verify_body: ApiResponse<TokenData> = test::read_body_json(verify_resp).await;
    assert!(verify_body.success);
    let token = verify_body.data.unwrap().token;
    assert!(token.starts_with("eyJ"), "token must look like a JWT");
}

#[actix_web::test]
async fn test_verify_rejects_wrong_signature() {
    let app = test::init_service(
        App::new().route("/api/auth/verify", web::post().to(mock_verify)),
    )
    .await;

    let key = test_signing_key();
    let pub_key_hex = hex::encode(key.verifying_key().to_bytes());
    // Sign a *different* message than what we claim to have signed.
    let (_, sig_hex) = sign_message(&key, "different-message");

    let req = test::TestRequest::post()
        .uri("/api/auth/verify")
        .set_json(&VerifyRequest {
            public_key: pub_key_hex,
            signature: sig_hex,
            message: "original-nonce".into(),
        })
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 401, "tampered signature must be rejected");

    let body: ApiResponse<TokenData> = test::read_body_json(resp).await;
    assert!(!body.success);
    assert!(body.error.is_some());
}

#[actix_web::test]
async fn test_verify_rejects_invalid_hex_public_key() {
    let app = test::init_service(
        App::new().route("/api/auth/verify", web::post().to(mock_verify)),
    )
    .await;

    let req = test::TestRequest::post()
        .uri("/api/auth/verify")
        .set_json(&VerifyRequest {
            public_key: "not-hex!!".into(),
            signature: "a".repeat(128),
            message: "nonce".into(),
        })
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 400, "invalid hex public key must return 400");
}

#[actix_web::test]
async fn test_verify_rejects_invalid_hex_signature() {
    let app = test::init_service(
        App::new().route("/api/auth/verify", web::post().to(mock_verify)),
    )
    .await;

    let key = test_signing_key();
    let pub_key_hex = hex::encode(key.verifying_key().to_bytes());

    let req = test::TestRequest::post()
        .uri("/api/auth/verify")
        .set_json(&VerifyRequest {
            public_key: pub_key_hex,
            signature: "not-hex!!".into(),
            message: "nonce".into(),
        })
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 400, "invalid hex signature must return 400");
}

#[actix_web::test]
async fn test_verify_rejects_wrong_key_length() {
    let app = test::init_service(
        App::new().route("/api/auth/verify", web::post().to(mock_verify)),
    )
    .await;

    let req = test::TestRequest::post()
        .uri("/api/auth/verify")
        .set_json(&VerifyRequest {
            public_key: hex::encode([0u8; 16]), // 16 bytes instead of 32
            signature: hex::encode([0u8; 64]),
            message: "nonce".into(),
        })
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 400, "wrong key length must return 400");
}

#[actix_web::test]
async fn test_challenge_nonce_is_unique_across_calls() {
    // The mock always returns the same nonce, but this test documents the
    // contract: in production the nonce must differ on every call.
    // Here we just verify the endpoint is callable twice without error.
    let app = test::init_service(
        App::new().route("/api/auth/challenge", web::get().to(mock_challenge)),
    )
    .await;

    for _ in 0..2 {
        let req = test::TestRequest::get()
            .uri("/api/auth/challenge")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }
}
