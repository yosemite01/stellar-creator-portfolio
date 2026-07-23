#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// Simple constant product AMM (x * y = k)

#[contracttype]
pub enum StorageKey {
    Reserves(Symbol),
    TotalLp,
    LpBalance(Address),
}

#[contract]
pub struct AmmContract;

#[contractimpl]
impl AmmContract {
    pub fn init(_env: Env) {}

    pub fn add_liquidity(env: Env, user: Address, amount_x: i128, amount_y: i128) -> i128 {
        user.require_auth();
        assert!(amount_x > 0 && amount_y > 0, "invalid amounts");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");

        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);
        let total_lp: i128 = env.storage().instance().get(&StorageKey::TotalLp).unwrap_or(0);

        let lp_minted: i128 = if total_lp == 0 || reserves_x == 0 || reserves_y == 0 {
            (amount_x + amount_y) / 2
        } else {
            let share_x = amount_x * total_lp / reserves_x;
            let share_y = amount_y * total_lp / reserves_y;
            core::cmp::min(share_x, share_y)
        };

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x + amount_x));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y + amount_y));
        env.storage().instance().set(&StorageKey::TotalLp, &(total_lp + lp_minted));

        let prev_lp: i128 = env.storage().instance().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        env.storage().instance().set(&StorageKey::LpBalance(user), &(prev_lp + lp_minted));

        lp_minted
    }

    pub fn remove_liquidity(env: Env, user: Address, lp_amount: i128) -> (i128, i128) {
        user.require_auth();
        assert!(lp_amount > 0, "invalid lp amount");

        let total_lp: i128 = env.storage().instance().get(&StorageKey::TotalLp).unwrap_or(0);
        assert!(total_lp > 0, "no liquidity");

        let user_lp: i128 = env.storage().instance().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        assert!(user_lp >= lp_amount, "not enough lp");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");
        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);

        let amount_x = reserves_x * lp_amount / total_lp;
        let amount_y = reserves_y * lp_amount / total_lp;

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x - amount_x));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y - amount_y));
        env.storage().instance().set(&StorageKey::TotalLp, &(total_lp - lp_amount));
        env.storage().instance().set(&StorageKey::LpBalance(user), &(user_lp - lp_amount));

        (amount_x, amount_y)
    }

    pub fn swap_x_for_y(env: Env, user: Address, dx: i128, min_dy: i128) -> i128 {
        user.require_auth();
        assert!(dx > 0, "invalid amount");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");
        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);
        assert!(reserves_x > 0 && reserves_y > 0, "empty pool");

        let dx_with_fee = dx * 997;
        let dy = dx_with_fee * reserves_y / (reserves_x * 1000 + dx_with_fee);
        assert!(dy >= min_dy && dy > 0, "slippage or zero output");

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x + dx));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y - dy));

        dy
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn basic_add_and_swap() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let lp = client.add_liquidity(&user, &100i128, &100i128);
        assert!(lp > 0);

        let dy = client.swap_x_for_y(&user, &10i128, &0i128);
        assert!(dy > 0);
    }
}
