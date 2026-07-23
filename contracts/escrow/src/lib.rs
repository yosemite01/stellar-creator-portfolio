// contracts/escrow/src/lib.rs
// Issue #760 — Multi-Token Escrow with Whitelist
//
// Supports XLM (native), USDC, EURC, and governance-approved custom tokens.
// Deposits are rejected for non-whitelisted tokens.

#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    token, Address, Env, Symbol, Vec, symbol_short,
};

// ── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum EscrowError {
    TokenNotWhitelisted = 1,
    InsufficientDeposit = 2,
    EscrowNotFound = 3,
    Unauthorized = 4,
    AlreadyReleased = 5,
    AlreadyWhitelisted = 6,
    NotWhitelisted = 7,
}

// ── Storage types ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenInfo {
    pub address: Address,
    pub symbol: Symbol,
    pub decimals: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Funded,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u64,
    pub funder: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub status: EscrowStatus,
}

#[contracttype]
pub enum DataKey {
    Governance,
    TokenWhitelist,
    NextEscrowId,
    Escrow(u64),
}

// ── Constants ───────────────────────────────────────────────────────────────

const TTL_THRESHOLD: u32 = 100;
const TTL_TARGET: u32 = 518_400;

// ── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── Initialization ──────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        governance: Address,
        initial_tokens: Vec<TokenInfo>,
    ) {
        governance.require_auth();
        env.storage().instance().set(&DataKey::Governance, &governance);
        env.storage().persistent().set(&DataKey::TokenWhitelist, &initial_tokens);
        Self::bump_persistent(&env, &DataKey::TokenWhitelist);
        env.storage().instance().set(&DataKey::NextEscrowId, &1u64);
    }

    // ── Token whitelist management (governance-only) ────────────────────

    pub fn add_token(
        env: Env,
        token_info: TokenInfo,
    ) -> Result<u32, EscrowError> {
        let governance = Self::get_governance(&env);
        governance.require_auth();

        let mut whitelist = Self::get_whitelist(&env);

        for i in 0..whitelist.len() {
            if whitelist.get(i).unwrap().address == token_info.address {
                return Err(EscrowError::AlreadyWhitelisted);
            }
        }

        whitelist.push_back(token_info.clone());
        env.storage().persistent().set(&DataKey::TokenWhitelist, &whitelist);
        Self::bump_persistent(&env, &DataKey::TokenWhitelist);

        env.events().publish(
            (symbol_short!("token"), symbol_short!("added")),
            token_info.symbol,
        );

        Ok(whitelist.len())
    }

    pub fn remove_token(
        env: Env,
        token_address: Address,
    ) -> Result<u32, EscrowError> {
        let governance = Self::get_governance(&env);
        governance.require_auth();

        let whitelist = Self::get_whitelist(&env);
        let mut new_list: Vec<TokenInfo> = Vec::new(&env);
        let mut found = false;

        for i in 0..whitelist.len() {
            let t = whitelist.get(i).unwrap();
            if t.address == token_address {
                found = true;
                env.events().publish(
                    (symbol_short!("token"), symbol_short!("removed")),
                    t.symbol,
                );
            } else {
                new_list.push_back(t);
            }
        }

        if !found {
            return Err(EscrowError::NotWhitelisted);
        }

        env.storage().persistent().set(&DataKey::TokenWhitelist, &new_list);
        Self::bump_persistent(&env, &DataKey::TokenWhitelist);

        Ok(new_list.len())
    }

    pub fn get_whitelist(env: &Env) -> Vec<TokenInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenWhitelist)
            .unwrap_or(Vec::new(env))
    }

    pub fn is_whitelisted(env: Env, token_address: Address) -> bool {
        let whitelist = Self::get_whitelist(&env);
        for i in 0..whitelist.len() {
            if whitelist.get(i).unwrap().address == token_address {
                return true;
            }
        }
        false
    }

    // ── Escrow operations ───────────────────────────────────────────────

    pub fn deposit(
        env: Env,
        funder: Address,
        recipient: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<Escrow, EscrowError> {
        funder.require_auth();
        assert!(amount > 0, "deposit amount must be positive");

        if !Self::is_whitelisted(env.clone(), token_address.clone()) {
            return Err(EscrowError::TokenNotWhitelisted);
        }

        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&funder, &env.current_contract_address(), &amount);

        let escrow_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextEscrowId)
            .unwrap_or(1);

        let escrow = Escrow {
            id: escrow_id,
            funder: funder.clone(),
            recipient: recipient.clone(),
            token: token_address.clone(),
            amount,
            status: EscrowStatus::Funded,
        };

        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&key, &escrow);
        Self::bump_persistent(&env, &key);
        env.storage().instance().set(&DataKey::NextEscrowId, &(escrow_id + 1));

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit")),
            (escrow_id, funder, amount),
        );

        Ok(escrow)
    }

    pub fn release(env: Env, escrow_id: u64) -> Result<Escrow, EscrowError> {
        let governance = Self::get_governance(&env);
        governance.require_auth();

        let key = DataKey::Escrow(escrow_id);
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        if escrow.status != EscrowStatus::Funded {
            return Err(EscrowError::AlreadyReleased);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.recipient,
            &escrow.amount,
        );

        let updated = Escrow {
            status: EscrowStatus::Released,
            id: escrow.id,
            funder: escrow.funder.clone(),
            recipient: escrow.recipient.clone(),
            token: escrow.token.clone(),
            amount: escrow.amount,
        };

        env.storage().persistent().set(&key, &updated);
        Self::bump_persistent(&env, &key);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release")),
            (escrow_id, escrow.recipient, escrow.amount),
        );

        Ok(updated)
    }

    pub fn refund(env: Env, escrow_id: u64) -> Result<Escrow, EscrowError> {
        let governance = Self::get_governance(&env);
        governance.require_auth();

        let key = DataKey::Escrow(escrow_id);
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        if escrow.status != EscrowStatus::Funded {
            return Err(EscrowError::AlreadyReleased);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.funder,
            &escrow.amount,
        );

        let updated = Escrow {
            status: EscrowStatus::Refunded,
            id: escrow.id,
            funder: escrow.funder.clone(),
            recipient: escrow.recipient.clone(),
            token: escrow.token.clone(),
            amount: escrow.amount,
        };

        env.storage().persistent().set(&key, &updated);
        Self::bump_persistent(&env, &key);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund")),
            (escrow_id, escrow.funder, escrow.amount),
        );

        Ok(updated)
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> Option<Escrow> {
        let key = DataKey::Escrow(escrow_id);
        let value = env.storage().persistent().get::<DataKey, Escrow>(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    pub fn get_token_info(env: Env, token_address: Address) -> Option<TokenInfo> {
        let whitelist = Self::get_whitelist(&env);
        for i in 0..whitelist.len() {
            let t = whitelist.get(i).unwrap();
            if t.address == token_address {
                return Some(t);
            }
        }
        None
    }

    // ── Internal ────────────────────────────────────────────────────────

    fn get_governance(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Governance)
            .unwrap()
    }

    fn bump_persistent(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_TARGET);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, EscrowContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        let gov = Address::generate(&env);
        (env, gov, client)
    }

    fn make_token_info(env: &Env, sym: &str) -> TokenInfo {
        TokenInfo {
            address: Address::generate(env),
            symbol: Symbol::new(env, sym),
            decimals: 7,
        }
    }

    #[test]
    fn initialize_and_check_whitelist() {
        let (env, gov, client) = setup();
        let xlm = make_token_info(&env, "XLM");
        let usdc = make_token_info(&env, "USDC");
        let eurc = make_token_info(&env, "EURC");

        let initial = soroban_sdk::vec![&env, xlm.clone(), usdc.clone(), eurc.clone()];
        client.initialize(&gov, &initial);

        let wl = client.get_whitelist();
        assert_eq!(wl.len(), 3);

        assert!(client.is_whitelisted(&xlm.address));
        assert!(client.is_whitelisted(&usdc.address));
        assert!(client.is_whitelisted(&eurc.address));
        assert!(!client.is_whitelisted(&Address::generate(&env)));
    }

    #[test]
    fn add_and_remove_token() {
        let (env, gov, client) = setup();
        let initial = soroban_sdk::vec![&env, make_token_info(&env, "XLM")];
        client.initialize(&gov, &initial);

        let new_token = make_token_info(&env, "AQUA");
        let count = client.add_token(&new_token);
        assert_eq!(count, 2);
        assert!(client.is_whitelisted(&new_token.address));

        let count = client.remove_token(&new_token.address);
        assert_eq!(count, 1);
        assert!(!client.is_whitelisted(&new_token.address));
    }

    #[test]
    fn add_duplicate_token_fails() {
        let (env, gov, client) = setup();
        let xlm = make_token_info(&env, "XLM");
        let initial = soroban_sdk::vec![&env, xlm.clone()];
        client.initialize(&gov, &initial);

        let result = client.try_add_token(&xlm);
        assert_eq!(result, Err(Ok(EscrowError::AlreadyWhitelisted)));
    }

    #[test]
    fn remove_nonexistent_token_fails() {
        let (env, gov, client) = setup();
        let initial = soroban_sdk::vec![&env, make_token_info(&env, "XLM")];
        client.initialize(&gov, &initial);

        let random_addr = Address::generate(&env);
        let result = client.try_remove_token(&random_addr);
        assert_eq!(result, Err(Ok(EscrowError::NotWhitelisted)));
    }

    #[test]
    fn get_token_info_returns_metadata() {
        let (env, gov, client) = setup();
        let usdc = TokenInfo {
            address: Address::generate(&env),
            symbol: Symbol::new(&env, "USDC"),
            decimals: 7,
        };
        let initial = soroban_sdk::vec![&env, usdc.clone()];
        client.initialize(&gov, &initial);

        let info = client.get_token_info(&usdc.address);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.symbol, Symbol::new(&env, "USDC"));
        assert_eq!(info.decimals, 7);
    }
}
