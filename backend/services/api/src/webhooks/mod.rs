/// Webhook handling — consolidated from the former webhook.rs and webhooks.rs.
///
/// - `stripe`  — HMAC-verified payment event handler (Stripe / Coinbase Commerce)
/// - `soroban` — Soroban event webhook registry and fire-and-forget delivery
pub mod stripe;
pub mod soroban;

pub use stripe::payment_webhook;
