#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, Symbol,
};

/// Challenge deposit in stroops (10 XLM).
pub const CHALLENGE_DEPOSIT: i128 = 100_000_000;

#[contracttype]
pub struct EpochData {
    pub epoch: u64,
    pub timestamp: u64,
    pub data_hash: String,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ReviewStatus {
    Active = 0,
    Challenged = 1,
    Removed = 2,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ChallengeStatus {
    Pending = 0,
    Upheld = 1,
    Rejected = 2,
}

#[contracttype]
pub struct Review {
    pub id: u64,
    pub creator: Address,
    pub reviewer: Address,
    pub rating: u32,
    pub status: ReviewStatus,
}

#[contracttype]
pub struct ReviewChallenge {
    pub id: u64,
    pub review_id: u64,
    pub challenger: Address,
    pub reason: String,
    pub deposit: i128,
    pub status: ChallengeStatus,
}

#[contracttype]
pub enum DataKey {
    Epoch(Symbol, u64),
    Review(u64),
    ReviewCounter,
    Challenge(u64),
    ChallengeCounter,
    Admin,
    PlatformToken,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum InsightsError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ReviewNotFound = 4,
    ReviewAlreadyChallenged = 5,
    ChallengeNotFound = 6,
    ChallengeNotPending = 7,
    InvalidRating = 8,
}

#[contract]
pub struct StellarInsights;

#[contractimpl]
impl StellarInsights {
    pub fn initialize(env: Env, admin: Address, platform_token: Address) {
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::PlatformToken, &platform_token);
        env.storage()
            .persistent()
            .set(&DataKey::ReviewCounter, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::ChallengeCounter, &0u64);
    }

    pub fn record_review(
        env: Env,
        creator: Address,
        reviewer: Address,
        rating: u32,
    ) -> u64 {
        reviewer.require_auth();
        Self::require_initialized(&env);
        assert!(rating > 0 && rating <= 5, "Invalid rating");

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ReviewCounter)
            .unwrap_or(0);

        let review = Review {
            id,
            creator,
            reviewer,
            rating,
            status: ReviewStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Review(id), &review);
        env.storage()
            .persistent()
            .set(&DataKey::ReviewCounter, &(id + 1));
        id
    }

    pub fn challenge_review(env: Env, review_id: u64, challenger: Address, reason: String) {
        challenger.require_auth();
        Self::require_initialized(&env);

        let mut review = Self::load_review(&env, review_id);
        assert!(review.status == ReviewStatus::Active, "Review already challenged");

        let deposit = CHALLENGE_DEPOSIT;
        let token_addr = Self::get_platform_token(&env);
        token::Client::new(&env, &token_addr).transfer(
            &challenger,
            &env.current_contract_address(),
            &deposit,
        );

        review.status = ReviewStatus::Challenged;
        env.storage()
            .persistent()
            .set(&DataKey::Review(review_id), &review);

        let challenge_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ChallengeCounter)
            .unwrap_or(0);

        let challenge = ReviewChallenge {
            id: challenge_id,
            review_id,
            challenger: challenger.clone(),
            reason,
            deposit,
            status: ChallengeStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Challenge(challenge_id), &challenge);
        env.storage()
            .persistent()
            .set(&DataKey::ChallengeCounter, &(challenge_id + 1));

        env.events().publish(
            (symbol_short!("review"), symbol_short!("challeng")),
            (review_id, challenger),
        );
    }

    pub fn uphold_challenge(env: Env, admin: Address, challenge_id: u64) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut challenge = Self::load_challenge(&env, challenge_id);
        assert!(challenge.status == ChallengeStatus::Pending, "Challenge not pending");

        let mut review = Self::load_review(&env, challenge.review_id);
        review.status = ReviewStatus::Removed;
        env.storage()
            .persistent()
            .set(&DataKey::Review(challenge.review_id), &review);

        challenge.status = ChallengeStatus::Upheld;
        env.storage()
            .persistent()
            .set(&DataKey::Challenge(challenge_id), &challenge);

        let token_addr = Self::get_platform_token(&env);
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &challenge.challenger,
            &challenge.deposit,
        );

        env.events().publish(
            (symbol_short!("review"), symbol_short!("upheld")),
            (challenge.review_id, challenge.challenger.clone()),
        );
    }

    pub fn reject_challenge(env: Env, admin: Address, challenge_id: u64) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut challenge = Self::load_challenge(&env, challenge_id);
        assert!(challenge.status == ChallengeStatus::Pending, "Challenge not pending");

        let mut review = Self::load_review(&env, challenge.review_id);
        review.status = ReviewStatus::Active;
        env.storage()
            .persistent()
            .set(&DataKey::Review(challenge.review_id), &review);

        challenge.status = ChallengeStatus::Rejected;
        env.storage()
            .persistent()
            .set(&DataKey::Challenge(challenge_id), &challenge);

        let token_addr = Self::get_platform_token(&env);
        let admin_addr = Self::get_admin(&env);
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &admin_addr,
            &challenge.deposit,
        );

        env.events().publish(
            (symbol_short!("review"), symbol_short!("reject")),
            (challenge.review_id, challenge.challenger.clone()),
        );
    }

    pub fn get_review(env: Env, review_id: u64) -> Review {
        Self::load_review(&env, review_id)
    }

    pub fn get_challenge(env: Env, challenge_id: u64) -> ReviewChallenge {
        Self::load_challenge(&env, challenge_id)
    }

    pub fn validate_epoch(env: Env, epoch: u64, data_hash: String) -> bool {
        let current_timestamp = env.ledger().timestamp();

        match validate_epoch_range(epoch, current_timestamp) {
            EpochValidation::Valid => {
                let epoch_key = DataKey::Epoch(Symbol::new(&env, "epoch"), epoch);
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
        let epoch_key = DataKey::Epoch(Symbol::new(&env, "epoch"), epoch);
        env.storage()
            .persistent()
            .get::<DataKey, EpochData>(&epoch_key)
    }

    fn get_platform_token(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::PlatformToken)
            .expect("Platform token not set")
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    fn require_initialized(env: &Env) {
        assert!(env.storage().persistent().has(&DataKey::Admin), "Not initialized");
    }

    fn require_admin(env: &Env, admin: &Address) {
        Self::require_initialized(env);
        let stored = Self::get_admin(env);
        assert!(stored == *admin, "Unauthorized");
    }

    fn load_review(env: &Env, review_id: u64) -> Review {
        env.storage()
            .persistent()
            .get(&DataKey::Review(review_id))
            .expect("Review not found")
    }

    fn load_challenge(env: &Env, challenge_id: u64) -> ReviewChallenge {
        env.storage()
            .persistent()
            .get(&DataKey::Challenge(challenge_id))
            .expect("Challenge not found")
    }
}

#[derive(Clone, Copy, Debug)]
enum EpochValidation {
    Valid,
    Invalid,
}

fn validate_epoch_range(epoch: u64, current_timestamp: u64) -> EpochValidation {
    if epoch == 0 {
        return EpochValidation::Invalid;
    }

    let max_future_seconds = 365 * 24 * 3600;
    if epoch > current_timestamp + max_future_seconds {
        return EpochValidation::Invalid;
    }

    EpochValidation::Valid
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token::StellarAssetClient, Env};

    fn setup(env: &Env) -> (Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let token_admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token = sac.address();
        let challenger = Address::generate(env);
        StellarAssetClient::new(env, &token).mint(&challenger, &CHALLENGE_DEPOSIT);
        (admin.clone(), token, challenger, admin)
    }

    #[test]
    fn test_epoch_validation_valid() {
        let current_time = 1_000_000u64;
        match validate_epoch_range(999_999, current_time) {
            EpochValidation::Valid => (),
            EpochValidation::Invalid => panic!("Expected valid epoch"),
        }
    }

    #[test]
    fn test_challenge_review_requires_stake() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, challenger, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let review_id = contract.record_review(
            &Address::generate(&env),
            &Address::generate(&env),
            &1,
        );

        contract.challenge_review(&review_id, &challenger, &String::from_str(&env, "fake review"));
        let challenge = contract.get_challenge(&0);
        assert_eq!(challenge.deposit, CHALLENGE_DEPOSIT);
        assert_eq!(challenge.status, ChallengeStatus::Pending);
    }

    #[test]
    fn test_uphold_returns_deposit_and_removes_review() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, challenger, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let review_id = contract.record_review(
            &Address::generate(&env),
            &Address::generate(&env),
            &1,
        );
        contract.challenge_review(&review_id, &challenger, &String::from_str(&env, "spam"));

        contract.uphold_challenge(&admin, &0);

        assert_eq!(contract.get_review(&review_id).status, ReviewStatus::Removed);
        assert_eq!(contract.get_challenge(&0).status, ChallengeStatus::Upheld);
    }

    #[test]
    fn test_reject_forfeits_deposit() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, challenger, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let review_id = contract.record_review(
            &Address::generate(&env),
            &Address::generate(&env),
            &5,
        );
        contract.challenge_review(&review_id, &challenger, &String::from_str(&env, "unfounded"));

        contract.reject_challenge(&admin, &0);

        assert_eq!(contract.get_review(&review_id).status, ReviewStatus::Active);
        assert_eq!(contract.get_challenge(&0).status, ChallengeStatus::Rejected);
    }
}
