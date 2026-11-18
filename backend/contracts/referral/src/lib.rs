#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address, Env, IntoVal,
};

/// The slice of the bounty contract the referral contract reads (#1716).
#[contractclient(name = "BountyActivityClient")]
pub trait BountyActivity {
    fn is_qualifying_bounty(env: Env, bounty_id: u64, account: Address) -> bool;
}

/// Errors raised by `register_referral` (Issue #1566). Surface on-chain as
/// `Error(Contract, #n)`.
#[contracttype]
#[derive(Clone)]
pub struct Referral {
    pub referrer: Address,
    pub referred: Address,
    pub registered_at: u64,
}

#[contracttype]
pub enum DataKey {
    Referral(Address), // referred -> Referral
    UnclaimedRewards(Address), // referrer -> i128
    ReferralCount(Address, u64), // referrer, month -> u32
    HasReferred(Address), // referrer -> bool, set on first referral (Issue #1566)
    Admin,
    RewardToken,
    /// Bounty contract consulted for qualifying activity (#1716).
    BountyContract,
    /// Off-chain risk service whose auth attests a referral is not a
    /// self-referral / same-funding-source cluster (#1716).
    RiskAttestor,
    /// Unreserved, funded reward tokens held by the contract (#1716).
    PoolAvailable,
    /// Sum of all unclaimed (reserved) rewards (#1716).
    TotalReserved,
    /// Max reward a referrer may earn per 30-day period (#1716).
    RewardCap,
    /// Rewards earned by a referrer in a period: (referrer, month) -> i128.
    RewardEarned(Address, u64),
    /// Bounty id already used to pay a referral reward.
    RewardedBounty(u64),
}

/// Typed errors returned by referral entrypoints (#1562).
///
/// Codes are part of the contract's public interface: never renumber an
/// existing variant, only append. See docs/contracts.md for the full table.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReferralError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ReferralAlreadyRegistered = 3,
    MonthlyLimitReached = 4,
    ReferralNotFound = 5,
    NoUnclaimedRewards = 6,
    /// `referrer == referred` (#1566).
    SelfReferral = 7,
    /// `referrer` was itself referred by `referred` (A→B then B→A) (#1566).
    ReferralLoop = 8,
    /// `referred` has already referred someone else, so is an existing
    /// participant rather than a new user. Closes loops of any length (#1566).
    RefereeIsReferrer = 9,
    /// A risk attestor is configured but no attestation was supplied (#1716).
    RiskAttestationRequired = 10,
    /// The supplied risk attestation has expired.
    RiskAttestationExpired = 11,
    /// `award_referral_reward` before `set_bounty_contract`.
    BountyContractNotSet = 12,
    /// The referred account has not completed that funded bounty.
    NotQualifyingActivity = 13,
    /// That bounty already paid a referral reward.
    BountyAlreadyRewarded = 14,
    /// Referrer already earned the per-period reward cap.
    RewardCapReached = 15,
    /// The funded reward pool cannot cover the reward / claim.
    PoolEmpty = 16,
    /// Amount or cap must be > 0.
    InvalidAmount = 17,
    /// Caller is not the admin.
    Unauthorized = 18,
}

#[contract]
pub struct ReferralContract;

const ONE_MONTH_SECS: u64 = 30 * 24 * 60 * 60;
const MAX_REFERRALS_PER_MONTH: u32 = 50;
const REWARD_PERCENTAGE: u64 = 5; // 5% of platform fee
/// Default per-referrer, per-period reward cap (token base units) until the
/// admin sets one with `set_reward_cap`.
pub const DEFAULT_REWARD_CAP: i128 = 1_000_0000000;

fn require_admin(env: &Env, admin: &Address) -> Result<(), ReferralError> {
    admin.require_auth();
    let stored: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Admin)
        .ok_or(ReferralError::NotInitialized)?;
    if *admin != stored {
        return Err(ReferralError::Unauthorized);
    }
    Ok(())
}

fn get_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().persistent().get(key).unwrap_or(0)
}

#[contractimpl]
impl ReferralContract {
    pub fn initialize(env: Env, admin: Address, reward_token: Address) -> Result<(), ReferralError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(ReferralError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::RewardToken, &reward_token);
        Ok(())
    }

    /// Register `referred` as referred by `referrer`. Signed by `referred`.
    ///
    /// When a risk attestor is configured (#1716), the attestor must also
    /// authorize `(referrer, referred, attestation_expires_at)`: that is the
    /// off-chain risk service's signed statement that the pair is not a
    /// self-referral or a same-funding-source cluster.
    pub fn register_referral(
        env: Env,
        referrer: Address,
        referred: Address,
        attestation_expires_at: Option<u64>,
    ) -> Result<(), ReferralError> {
        // #1566: only the referee can attach themselves to a referrer, so
        // nobody can register referrals on another account's behalf.
        referred.require_auth();

        if let Some(attestor) = env.storage().persistent().get::<DataKey, Address>(&DataKey::RiskAttestor) {
            let expires_at = attestation_expires_at.ok_or(ReferralError::RiskAttestationRequired)?;
            if env.ledger().timestamp() > expires_at {
                return Err(ReferralError::RiskAttestationExpired);
            }
            attestor.require_auth_for_args(
                (referrer.clone(), referred.clone(), expires_at).into_val(&env),
            );
        }

        if referrer == referred {
            return Err(ReferralError::SelfReferral);
        }

        let key = DataKey::Referral(referred.clone());
        if env.storage().persistent().has(&key) {
            return Err(ReferralError::ReferralAlreadyRegistered);
        }

        // A→B then B→A. Also covers referrers registered before HasReferred
        // existed.
        if let Some(upstream) = env
            .storage()
            .persistent()
            .get::<DataKey, Referral>(&DataKey::Referral(referrer.clone()))
        {
            if upstream.referrer == referred {
                return Err(ReferralError::ReferralLoop);
            }
        }

        // Every referee must be a new participant; this blocks cycles of any
        // length with a single read.
        if env.storage().persistent().has(&DataKey::HasReferred(referred.clone())) {
            return Err(ReferralError::RefereeIsReferrer);
        }

        let month = env.ledger().timestamp() / ONE_MONTH_SECS;
        let count_key = DataKey::ReferralCount(referrer.clone(), month);
        let mut count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        if count >= MAX_REFERRALS_PER_MONTH {
            return Err(ReferralError::MonthlyLimitReached);
        }

        env.storage().persistent().set(
            &key,
            &Referral {
                referrer: referrer.clone(),
                referred: referred.clone(),
                registered_at: env.ledger().timestamp(),
            },
        );

        count += 1;
        env.storage().persistent().set(&count_key, &count);

        let has_referred_key = DataKey::HasReferred(referrer.clone());
        env.storage().persistent().set(&has_referred_key, &true);

        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&key, 4096, ledger_ttl);
        env.storage().persistent().extend_ttl(&count_key, 4096, ledger_ttl);
        env.storage().persistent().extend_ttl(&has_referred_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("referral"), symbol_short!("reg")),
            (referrer, referred),
        );
        Ok(())
    }

    // ── Issue #1716: funded pool, qualifying activity, caps ─────────────

    /// Admin: set the bounty contract read by `award_referral_reward`.
    pub fn set_bounty_contract(env: Env, admin: Address, bounty: Address) -> Result<(), ReferralError> {
        require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::BountyContract, &bounty);
        env.events().publish((symbol_short!("referral"), symbol_short!("bounty")), bounty);
        Ok(())
    }

    /// Admin: set (or with `None`, clear) the risk attestor.
    pub fn set_risk_attestor(env: Env, admin: Address, attestor: Option<Address>) -> Result<(), ReferralError> {
        require_admin(&env, &admin)?;
        match &attestor {
            Some(a) => env.storage().persistent().set(&DataKey::RiskAttestor, a),
            None => env.storage().persistent().remove(&DataKey::RiskAttestor),
        }
        env.events().publish((symbol_short!("referral"), symbol_short!("attestor")), attestor);
        Ok(())
    }

    /// Admin: set the per-referrer, per-period reward cap.
    pub fn set_reward_cap(env: Env, admin: Address, cap: i128) -> Result<(), ReferralError> {
        require_admin(&env, &admin)?;
        if cap <= 0 {
            return Err(ReferralError::InvalidAmount);
        }
        env.storage().persistent().set(&DataKey::RewardCap, &cap);
        env.events().publish((symbol_short!("referral"), symbol_short!("cap")), cap);
        Ok(())
    }

    /// Move `amount` reward tokens from `funder` into the pool. Anyone may
    /// fund. Emits `(referral, funded)` -> `(funder, amount, pool_available)`.
    pub fn fund_pool(env: Env, funder: Address, amount: i128) -> Result<i128, ReferralError> {
        funder.require_auth();
        if amount <= 0 {
            return Err(ReferralError::InvalidAmount);
        }
        let token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RewardToken)
            .ok_or(ReferralError::NotInitialized)?;
        soroban_sdk::token::Client::new(&env, &token).transfer(&funder, &env.current_contract_address(), &amount);
        let available = get_i128(&env, &DataKey::PoolAvailable) + amount;
        env.storage().persistent().set(&DataKey::PoolAvailable, &available);
        env.events().publish((symbol_short!("referral"), symbol_short!("funded")), (funder, amount, available));
        Ok(available)
    }

    /// Award the referrer of `referred` for completing funded bounty
    /// `bounty_id`. Admin-only. The reward (5% of `platform_fee`) is only
    /// paid when the bounty contract confirms the referred account completed
    /// that funded bounty, each bounty pays at most once, the referrer's
    /// per-period cap is respected and the amount is reserved from the funded
    /// pool, so every unclaimed reward is backed by tokens. Returns the
    /// amount awarded, which may be clamped by the cap or the pool.
    pub fn award_referral_reward(
        env: Env,
        referred: Address,
        platform_fee: i128,
        bounty_id: u64,
    ) -> Result<i128, ReferralError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(ReferralError::NotInitialized)?;
        admin.require_auth();
        if platform_fee <= 0 {
            return Err(ReferralError::InvalidAmount);
        }

        let referral: Referral = env
            .storage()
            .persistent()
            .get(&DataKey::Referral(referred.clone()))
            .ok_or(ReferralError::ReferralNotFound)?;

        let rewarded_key = DataKey::RewardedBounty(bounty_id);
        if env.storage().persistent().has(&rewarded_key) {
            return Err(ReferralError::BountyAlreadyRewarded);
        }

        let bounty: Address = env
            .storage()
            .persistent()
            .get(&DataKey::BountyContract)
            .ok_or(ReferralError::BountyContractNotSet)?;
        if !BountyActivityClient::new(&env, &bounty).is_qualifying_bounty(&bounty_id, &referred) {
            return Err(ReferralError::NotQualifyingActivity);
        }

        let month = env.ledger().timestamp() / ONE_MONTH_SECS;
        let earned_key = DataKey::RewardEarned(referral.referrer.clone(), month);
        let earned = get_i128(&env, &earned_key);
        let cap: i128 = env.storage().persistent().get(&DataKey::RewardCap).unwrap_or(DEFAULT_REWARD_CAP);
        let cap_left = cap - earned;
        if cap_left <= 0 {
            return Err(ReferralError::RewardCapReached);
        }

        let available = get_i128(&env, &DataKey::PoolAvailable);
        if available <= 0 {
            return Err(ReferralError::PoolEmpty);
        }

        let full = (platform_fee * REWARD_PERCENTAGE as i128) / 100;
        let reward = full.min(cap_left).min(available);
        if reward <= 0 {
            return Err(ReferralError::InvalidAmount);
        }

        env.storage().persistent().set(&DataKey::PoolAvailable, &(available - reward));
        env.storage()
            .persistent()
            .set(&DataKey::TotalReserved, &(get_i128(&env, &DataKey::TotalReserved) + reward));
        env.storage().persistent().set(&earned_key, &(earned + reward));
        env.storage().persistent().set(&rewarded_key, &true);

        let unclaimed_key = DataKey::UnclaimedRewards(referral.referrer.clone());
        let unclaimed = get_i128(&env, &unclaimed_key) + reward;
        env.storage().persistent().set(&unclaimed_key, &unclaimed);

        env.events().publish(
            (symbol_short!("referral"), symbol_short!("reward")),
            (referral.referrer, referred, reward, bounty_id),
        );
        Ok(reward)
    }

    /// Pay out the caller's reserved rewards. Fails with `PoolEmpty`
    /// (instead of a token-transfer trap) if the contract somehow holds
    /// fewer tokens than owed.
    pub fn claim_referral_reward(env: Env, referrer: Address) -> Result<i128, ReferralError> {
        referrer.require_auth();

        let unclaimed_key = DataKey::UnclaimedRewards(referrer.clone());
        let unclaimed = get_i128(&env, &unclaimed_key);
        if unclaimed <= 0 {
            return Err(ReferralError::NoUnclaimedRewards);
        }

        let reward_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RewardToken)
            .ok_or(ReferralError::NotInitialized)?;
        let token_client = soroban_sdk::token::Client::new(&env, &reward_token);
        if token_client.balance(&env.current_contract_address()) < unclaimed {
            return Err(ReferralError::PoolEmpty);
        }

        // Effects before the interaction.
        env.storage().persistent().set(&unclaimed_key, &0i128);
        let reserved = get_i128(&env, &DataKey::TotalReserved) - unclaimed;
        env.storage().persistent().set(&DataKey::TotalReserved, &reserved.max(0));

        token_client.transfer(&env.current_contract_address(), &referrer, &unclaimed);

        env.events().publish(
            (symbol_short!("referral"), symbol_short!("claim")),
            (referrer, unclaimed),
        );

        Ok(unclaimed)
    }

    /// `(pool_available, total_reserved)` for dashboards and alerts.
    pub fn get_pool(env: Env) -> (i128, i128) {
        (get_i128(&env, &DataKey::PoolAvailable), get_i128(&env, &DataKey::TotalReserved))
    }

    pub fn get_reward_earned(env: Env, referrer: Address, month: u64) -> i128 {
        get_i128(&env, &DataKey::RewardEarned(referrer, month))
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&DataKey::Admin, &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    pub fn get_unclaimed_rewards(env: Env, referrer: Address) -> i128 {
        env.storage().persistent().get(&DataKey::UnclaimedRewards(referrer)).unwrap_or(0)
    }

    pub fn get_referral(env: Env, referred: Address) -> Option<Referral> {
        env.storage().persistent().get(&DataKey::Referral(referred))
    }

    pub fn get_referral_count(env: Env, referrer: Address, month: u64) -> u32 {
        env.storage().persistent().get(&DataKey::ReferralCount(referrer, month)).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
    use soroban_sdk::Env;

    /// Stand-in for the bounty contract: bounty ids marked complete for an
    /// account via `mark`.
    #[contract]
    pub struct MockBounty;

    #[contractimpl]
    impl MockBounty {
        pub fn mark(env: Env, bounty_id: u64, account: Address) {
            env.storage().persistent().set(&(bounty_id, account), &true);
        }
        pub fn is_qualifying_bounty(env: Env, bounty_id: u64, account: Address) -> bool {
            env.storage().persistent().get(&(bounty_id, account)).unwrap_or(false)
        }
    }

    struct Ctx<'a> {
        contract: ReferralContractClient<'a>,
        bounty: MockBountyClient<'a>,
        token: Address,
        admin: Address,
    }

    fn setup(env: &Env) -> Ctx<'_> {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract = ReferralContractClient::new(env, &env.register(ReferralContract, ()));
        contract.initialize(&admin, &token);
        let bounty = MockBountyClient::new(env, &env.register(MockBounty, ()));
        contract.set_bounty_contract(&admin, &bounty.address);
        Ctx { contract, bounty, token, admin }
    }

    fn fund(env: &Env, ctx: &Ctx, amount: i128) {
        let funder = Address::generate(env);
        StellarAssetClient::new(env, &ctx.token).mint(&funder, &amount);
        ctx.contract.fund_pool(&funder, &amount);
    }

    #[test]
    fn test_register_referral() {
        let env = Env::default();
        let ctx = setup(&env);
        let referrer = Address::generate(&env);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&referrer, &referred, &None);
        assert_eq!(ctx.contract.get_referral(&referred).unwrap().referrer, referrer);
    }

    #[test]
    fn test_reward_only_after_qualifying_bounty_then_claim() {
        let env = Env::default();
        let ctx = setup(&env);
        fund(&env, &ctx, 1_000);
        let referrer = Address::generate(&env);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&referrer, &referred, &None);

        // No completed funded bounty yet.
        assert_eq!(
            ctx.contract.try_award_referral_reward(&referred, &1000i128, &7u64),
            Err(Ok(ReferralError::NotQualifyingActivity))
        );

        ctx.bounty.mark(&7u64, &referred);
        assert_eq!(ctx.contract.award_referral_reward(&referred, &1000i128, &7u64), 50);
        assert_eq!(ctx.contract.get_unclaimed_rewards(&referrer), 50);
        assert_eq!(ctx.contract.get_pool(), (950, 50));

        assert_eq!(ctx.contract.claim_referral_reward(&referrer), 50);
        assert_eq!(TokenClient::new(&env, &ctx.token).balance(&referrer), 50);
        assert_eq!(ctx.contract.get_pool(), (950, 0));
    }

    #[test]
    fn test_same_bounty_cannot_be_rewarded_twice() {
        let env = Env::default();
        let ctx = setup(&env);
        fund(&env, &ctx, 1_000);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&Address::generate(&env), &referred, &None);
        ctx.bounty.mark(&1u64, &referred);
        ctx.contract.award_referral_reward(&referred, &1000i128, &1u64);
        assert_eq!(
            ctx.contract.try_award_referral_reward(&referred, &1000i128, &1u64),
            Err(Ok(ReferralError::BountyAlreadyRewarded))
        );
    }

    #[test]
    fn test_award_fails_gracefully_when_pool_empty() {
        let env = Env::default();
        let ctx = setup(&env);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&Address::generate(&env), &referred, &None);
        ctx.bounty.mark(&1u64, &referred);
        assert_eq!(
            ctx.contract.try_award_referral_reward(&referred, &1000i128, &1u64),
            Err(Ok(ReferralError::PoolEmpty))
        );
    }

    #[test]
    fn test_award_clamped_to_pool() {
        let env = Env::default();
        let ctx = setup(&env);
        fund(&env, &ctx, 20);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&Address::generate(&env), &referred, &None);
        ctx.bounty.mark(&1u64, &referred);
        assert_eq!(ctx.contract.award_referral_reward(&referred, &1000i128, &1u64), 20);
        assert_eq!(ctx.contract.get_pool(), (0, 20));
    }

    #[test]
    fn test_per_period_cap() {
        let env = Env::default();
        let ctx = setup(&env);
        fund(&env, &ctx, 10_000);
        ctx.contract.set_reward_cap(&ctx.admin, &60);
        let referrer = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        for (i, r) in [&a, &b, &c].iter().enumerate() {
            ctx.contract.register_referral(&referrer, r, &None);
            ctx.bounty.mark(&(i as u64), r);
        }
        assert_eq!(ctx.contract.award_referral_reward(&a, &1000i128, &0u64), 50);
        assert_eq!(ctx.contract.award_referral_reward(&b, &1000i128, &1u64), 10); // clamped
        assert_eq!(
            ctx.contract.try_award_referral_reward(&c, &1000i128, &2u64),
            Err(Ok(ReferralError::RewardCapReached))
        );
        // Next period resets the cap.
        env.ledger().set_timestamp(ONE_MONTH_SECS);
        assert_eq!(ctx.contract.award_referral_reward(&c, &1000i128, &2u64), 50);
    }

    #[test]
    fn test_award_requires_bounty_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract = ReferralContractClient::new(&env, &env.register(ReferralContract, ()));
        contract.initialize(&admin, &token);
        let referred = Address::generate(&env);
        contract.register_referral(&Address::generate(&env), &referred, &None);
        assert_eq!(
            contract.try_award_referral_reward(&referred, &1000i128, &1u64),
            Err(Ok(ReferralError::BountyContractNotSet))
        );
    }

    #[test]
    fn test_admin_setters_reject_non_admin() {
        let env = Env::default();
        let ctx = setup(&env);
        let stranger = Address::generate(&env);
        assert_eq!(ctx.contract.try_set_reward_cap(&stranger, &1), Err(Ok(ReferralError::Unauthorized)));
        assert_eq!(
            ctx.contract.try_set_risk_attestor(&stranger, &Some(stranger.clone())),
            Err(Ok(ReferralError::Unauthorized))
        );
        assert_eq!(
            ctx.contract.try_set_bounty_contract(&stranger, &stranger),
            Err(Ok(ReferralError::Unauthorized))
        );
        assert_eq!(ctx.contract.try_set_reward_cap(&ctx.admin, &0), Err(Ok(ReferralError::InvalidAmount)));
    }

    #[test]
    fn test_risk_attestation_required_and_checked() {
        let env = Env::default();
        let ctx = setup(&env);
        let attestor = Address::generate(&env);
        ctx.contract.set_risk_attestor(&ctx.admin, &Some(attestor.clone()));
        let referrer = Address::generate(&env);
        let referred = Address::generate(&env);

        assert_eq!(
            ctx.contract.try_register_referral(&referrer, &referred, &None),
            Err(Ok(ReferralError::RiskAttestationRequired))
        );
        env.ledger().set_timestamp(100);
        assert_eq!(
            ctx.contract.try_register_referral(&referrer, &referred, &Some(99u64)),
            Err(Ok(ReferralError::RiskAttestationExpired))
        );

        ctx.contract.register_referral(&referrer, &referred, &Some(200u64));
        let auths = env.auths();
        assert!(auths.iter().any(|(a, _)| *a == attestor), "attestor must authorize");
        assert!(auths.iter().any(|(a, _)| *a == referred));
    }

    #[test]
    fn test_register_referral_requires_referee_auth() {
        let env = Env::default();
        let ctx = setup(&env);
        let referrer = Address::generate(&env);
        let referred = Address::generate(&env);

        ctx.contract.register_referral(&referrer, &referred, &None);

        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, referred);
    }

    #[test]
    fn test_rejects_self_referral() {
        let env = Env::default();
        let ctx = setup(&env);
        let user = Address::generate(&env);
        assert_eq!(
            ctx.contract.try_register_referral(&user, &user, &None),
            Err(Ok(ReferralError::SelfReferral))
        );
    }

    #[test]
    fn test_rejects_second_referrer() {
        let env = Env::default();
        let ctx = setup(&env);
        let referred = Address::generate(&env);
        ctx.contract.register_referral(&Address::generate(&env), &referred, &None);
        assert_eq!(
            ctx.contract.try_register_referral(&Address::generate(&env), &referred, &None),
            Err(Ok(ReferralError::ReferralAlreadyRegistered))
        );
    }

    #[test]
    fn test_rejects_two_account_loop() {
        let env = Env::default();
        let ctx = setup(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        ctx.contract.register_referral(&a, &b, &None);
        assert_eq!(
            ctx.contract.try_register_referral(&b, &a, &None),
            Err(Ok(ReferralError::ReferralLoop))
        );
    }

    #[test]
    fn test_rejects_referee_who_already_refers() {
        let env = Env::default();
        let ctx = setup(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        ctx.contract.register_referral(&b, &c, &None);
        assert_eq!(
            ctx.contract.try_register_referral(&a, &b, &None),
            Err(Ok(ReferralError::RefereeIsReferrer))
        );
    }
}

// Issue #1719: shared upgrade-timelock conformance tests.
stellar_upgradeable::upgrade_timelock_tests!(
    upgrade_conformance,
    ReferralContract,
    ReferralContractClient,
    |env, id, admin| {
        ReferralContractClient::new(&env, &id).initialize(&admin, &soroban_sdk::Address::generate(&env));
    }
);
