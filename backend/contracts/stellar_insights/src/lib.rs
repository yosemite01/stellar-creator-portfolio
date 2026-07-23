#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, Symbol,
};

/// Challenge deposit in stroops (10 XLM).
pub const CHALLENGE_DEPOSIT: i128 = 100_000_000;

const SECONDS_PER_MONTH: u64 = 30 * 86400;
const GRACE_PERIOD_MONTHS: u64 = 3;
const DECAY_SCALE: i64 = 10_000;
const DEFAULT_DECAY_RATE: i64 = 500; // 5% per month

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
#[derive(Clone, Debug)]
pub struct CreatorReputation {
    pub creator: Address,
    pub score: i64,
    pub last_activity: u64,
    pub bounties_completed: u64,
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
    Reputation(Address),
    DecayRate,
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

    // ── Reputation decay (#765) ──────────────────────────────────────────────

    fn exp_decay(decay_rate: i64, months: u64) -> i64 {
        let x = decay_rate * (months as i64);
        let t1 = DECAY_SCALE * DECAY_SCALE;
        let t2 = x * DECAY_SCALE;
        let t3 = (x * x) / 2;
        let t4 = (x * x * x) / (6 * DECAY_SCALE);
        let t5 = (x * x * x * x) / (24 * DECAY_SCALE * DECAY_SCALE);
        let result = (t1 - t2 + t3 - t4 + t5) / DECAY_SCALE;
        if result < 0 { 0 } else { result }
    }

    pub fn set_reputation(env: Env, admin: Address, creator: Address, score: i64) -> bool {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        assert!(score >= 0, "Score must be non-negative");

        let rep = CreatorReputation {
            creator: creator.clone(),
            score,
            last_activity: env.ledger().timestamp(),
            bounties_completed: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(creator.clone()), &rep);

        env.events().publish(
            (symbol_short!("rep_set"), creator),
            score,
        );
        true
    }

    pub fn record_bounty_completion(env: Env, creator: Address, bonus: i64) -> bool {
        creator.require_auth();
        assert!(bonus >= 0, "Bonus must be non-negative");

        let mut rep: CreatorReputation = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(creator.clone()))
            .expect("Creator reputation not found");

        rep.score += bonus;
        rep.last_activity = env.ledger().timestamp();
        rep.bounties_completed += 1;

        env.storage()
            .persistent()
            .set(&DataKey::Reputation(creator.clone()), &rep);

        env.events().publish(
            (symbol_short!("bty_done"), creator),
            (rep.score, rep.bounties_completed),
        );
        true
    }

    pub fn get_effective_reputation(env: Env, creator: Address) -> i64 {
        let rep: CreatorReputation = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(creator))
            .expect("Creator reputation not found");

        let now = env.ledger().timestamp();
        if now <= rep.last_activity {
            return rep.score;
        }

        let months_inactive = (now - rep.last_activity) / SECONDS_PER_MONTH;
        if months_inactive <= GRACE_PERIOD_MONTHS {
            return rep.score;
        }

        let decay_months = months_inactive - GRACE_PERIOD_MONTHS;
        let decay_rate: i64 = env
            .storage()
            .persistent()
            .get(&DataKey::DecayRate)
            .unwrap_or(DEFAULT_DECAY_RATE);

        let factor = Self::exp_decay(decay_rate, decay_months);
        (rep.score * factor) / DECAY_SCALE
    }

    pub fn is_decaying(env: Env, creator: Address) -> bool {
        let rep: Option<CreatorReputation> = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(creator));

        match rep {
            None => false,
            Some(r) => {
                let now = env.ledger().timestamp();
                if now <= r.last_activity {
                    return false;
                }
                (now - r.last_activity) / SECONDS_PER_MONTH > GRACE_PERIOD_MONTHS
            }
        }
    }

    pub fn set_decay_rate(env: Env, admin: Address, new_rate: i64) -> bool {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        assert!(new_rate > 0 && new_rate <= DECAY_SCALE, "Rate must be between 1 and 10000");

        env.storage()
            .persistent()
            .set(&DataKey::DecayRate, &new_rate);
        true
    }

    pub fn get_decay_rate(env: Env) -> i64 {
        env.storage()
            .persistent()
            .get(&DataKey::DecayRate)
            .unwrap_or(DEFAULT_DECAY_RATE)
    }

    pub fn get_reputation(env: Env, creator: Address) -> CreatorReputation {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(creator))
            .expect("Creator reputation not found")
    }

    // ── Issue #732: Contract upgrade mechanism ────────────────────────────────

    /// Upgrade the contract WASM. Only the governance multisig (admin) may call this.
    /// Emits an `upgraded` event with the new wasm hash.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("contract"), symbol_short!("upgraded")),
            new_wasm_hash,
        );
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

    // ── Reputation decay tests (#765) ────────────────────────────────────────

    #[test]
    fn test_no_decay_within_grace_period() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, _, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let creator = Address::generate(&env);
        contract.set_reputation(&admin, &creator, &1000);

        env.ledger().set_timestamp(2 * SECONDS_PER_MONTH);
        assert_eq!(contract.get_effective_reputation(&creator), 1000);
        assert!(!contract.is_decaying(&creator));
    }

    #[test]
    fn test_decay_after_grace_period() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, _, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let creator = Address::generate(&env);
        contract.set_reputation(&admin, &creator, &10000);

        env.ledger().set_timestamp(6 * SECONDS_PER_MONTH);
        let effective = contract.get_effective_reputation(&creator);
        assert!(effective < 10000);
        assert!(effective > 8000);
        assert!(contract.is_decaying(&creator));
    }

    #[test]
    fn test_bounty_completion_refreshes_activity() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, _, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        let creator = Address::generate(&env);
        contract.set_reputation(&admin, &creator, &1000);

        env.ledger().set_timestamp(6 * SECONDS_PER_MONTH);
        assert!(contract.is_decaying(&creator));

        contract.record_bounty_completion(&creator, &100);
        assert!(!contract.is_decaying(&creator));
        assert_eq!(contract.get_effective_reputation(&creator), 1100);
    }

    #[test]
    fn test_governance_adjusts_decay_rate() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, token, _, _) = setup(&env);
        let contract_id = env.register_contract(None, StellarInsights);
        let contract = StellarInsightsClient::new(&env, &contract_id);

        contract.initialize(&admin, &token);
        assert_eq!(contract.get_decay_rate(), DEFAULT_DECAY_RATE);

        contract.set_decay_rate(&admin, &1000);
        assert_eq!(contract.get_decay_rate(), 1000);
    }
}
