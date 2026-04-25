#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Env, String, Symbol};

/// Epoch validation contract for tracking historical data
#[contracttype]
pub struct EpochData {
    pub epoch: u64,
    pub timestamp: u64,
    pub data_hash: String,
}

#[contract]
pub struct StellarInsights;

#[contractimpl]
impl StellarInsights {
    /// Validate and store epoch data
    pub fn validate_epoch(env: Env, epoch: u64, data_hash: String) -> bool {
        // Validate epoch is within acceptable range
        let current_timestamp = env.ledger().timestamp();
        
        // Simplified validation: epoch must be positive and not too far in future
        match validate_epoch_range(epoch, current_timestamp) {
            EpochValidation::Valid => {
                let epoch_key = (Symbol::new(&env, "epoch"), epoch);
                let epoch_data = EpochData {
                    epoch,
                    timestamp: current_timestamp,
                    data_hash,
                };
                env.storage().persistent().set(&epoch_key, &epoch_data);
                true
            }
            EpochValidation::Invalid => false,
        }
    }

    pub fn get_epoch_data(env: Env, epoch: u64) -> Option<EpochData> {
        let epoch_key = (Symbol::new(&env, "epoch"), epoch);
        env.storage()
            .persistent()
            .get::< (Symbol, u64), EpochData>(&epoch_key)
    }
}

/// Epoch validation result
#[derive(Clone, Copy, Debug)]
enum EpochValidation {
    Valid,
    Invalid,
}

/// Validate epoch is within acceptable range
fn validate_epoch_range(epoch: u64, current_timestamp: u64) -> EpochValidation {
    // Epoch must be positive
    if epoch == 0 {
        return EpochValidation::Invalid;
    }

    // Epoch timestamp cannot be more than 1 year in the future
    let max_future_seconds = 365 * 24 * 3600;
    if epoch > current_timestamp + max_future_seconds {
        return EpochValidation::Invalid;
    }

    EpochValidation::Valid
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_epoch_validation_valid() {
        let current_time = 1000000u64;
        let valid_epoch = 999999u64;
        
        match validate_epoch_range(valid_epoch, current_time) {
            EpochValidation::Valid => (),
            EpochValidation::Invalid => panic!("Expected valid epoch"),
        }
    }

    #[test]
    fn test_epoch_validation_zero() {
        let current_time = 1000000u64;
        
        match validate_epoch_range(0, current_time) {
            EpochValidation::Invalid => (),
            EpochValidation::Valid => panic!("Expected invalid epoch"),
        }
    }

    #[test]
    fn test_epoch_validation_too_far_future() {
        let current_time = 1000000u64;
        let far_future = current_time + (366 * 24 * 3600);
        
        match validate_epoch_range(far_future, current_time) {
            EpochValidation::Invalid => (),
            EpochValidation::Valid => panic!("Expected invalid epoch"),
        }
    }
}
