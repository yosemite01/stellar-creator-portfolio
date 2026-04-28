#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Env, String, Symbol};

#[contracttype]
pub struct AnalyticsEvent {
    pub event_id: u64,
    pub timestamp: u64,
    pub event_type: String,
}

#[contract]
pub struct AnalyticsContract;

#[contractimpl]
impl AnalyticsContract {
    pub fn record_event(env: Env, event_id: u64, event_type: String) -> bool {
        let key = (Symbol::new(&env, "event"), event_id);
        let event = AnalyticsEvent {
            event_id,
            timestamp: env.ledger().timestamp(),
            event_type,
        };

        env.storage().persistent().set(&key, &event);
        true
    }

    pub fn get_event(env: Env, event_id: u64) -> Option<AnalyticsEvent> {
        let key = (Symbol::new(&env, "event"), event_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), AnalyticsEvent>(&key)
    }
}
