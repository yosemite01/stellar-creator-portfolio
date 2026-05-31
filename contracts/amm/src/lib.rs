#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec, Map};

// Simple constant product AMM contract (x * y = k)

#[contracttype]
pub enum StorageKey {
    Reserves(Symbol), // token id string
    TotalLp,
    LpBalance(Address),
}

#[contract]
pub struct AmmContract;

#[contractimpl]
impl AmmContract {
    // Initialize reserves for two token symbols (strings) to zero.
    pub fn init(env: Env) {
        // noop in this minimal example
        let _: () = ();
    }

    pub fn add_liquidity(env: Env, user: Address, amount_x: i128, amount_y: i128) -> i128 {
        user.require_auth();
        assert!(amount_x > 0 && amount_y > 0, "invalid amounts");

        let key_x = Symbol::short("x");
        let key_y = Symbol::short("y");

        let reserves_x: i128 = env.storage().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);

        // mint LP proportional to added liquidity
        let lp_minted: i128;
        let total_lp: i128 = env.storage().get(&StorageKey::TotalLp).unwrap_or(0);
        if total_lp == 0 || reserves_x == 0 || reserves_y == 0 {
            lp_minted = (amount_x + amount_y) / 2; // initial seed heuristic
        } else {
            // proportional to smallest share
            let share_x = amount_x * total_lp / reserves_x;
            let share_y = amount_y * total_lp / reserves_y;
            lp_minted = core::cmp::min(share_x, share_y);
        }

        let new_reserves_x = reserves_x + amount_x;
        let new_reserves_y = reserves_y + amount_y;

        env.storage().set(&StorageKey::Reserves(key_x), &new_reserves_x);
        env.storage().set(&StorageKey::Reserves(key_y), &new_reserves_y);

        let new_total_lp = total_lp + lp_minted;
        env.storage().set(&StorageKey::TotalLp, &new_total_lp);

        // credit LP to user
        let prev_lp: i128 = env.storage().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        env.storage().set(&StorageKey::LpBalance(user), &(prev_lp + lp_minted));

        lp_minted
    }

    pub fn remove_liquidity(env: Env, user: Address, lp_amount: i128) -> (i128, i128) {
        user.require_auth();
        assert!(lp_amount > 0, "invalid lp amount");

        let total_lp: i128 = env.storage().get(&StorageKey::TotalLp).unwrap_or(0);
        assert!(total_lp > 0, "no liquidity");

        let user_lp: i128 = env.storage().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        assert!(user_lp >= lp_amount, "not enough lp");

        let key_x = Symbol::short("x");
        let key_y = Symbol::short("y");
        let reserves_x: i128 = env.storage().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);

        let amount_x = reserves_x * lp_amount / total_lp;
        let amount_y = reserves_y * lp_amount / total_lp;

        let new_reserves_x = reserves_x - amount_x;
        let new_reserves_y = reserves_y - amount_y;

        env.storage().set(&StorageKey::Reserves(key_x), &new_reserves_x);
        env.storage().set(&StorageKey::Reserves(key_y), &new_reserves_y);

        let new_total_lp = total_lp - lp_amount;
        env.storage().set(&StorageKey::TotalLp, &new_total_lp);

        env.storage().set(&StorageKey::LpBalance(user.clone()), &(user_lp - lp_amount));

        (amount_x, amount_y)
    }

    // Swap x for y using constant product with 0.3% fee. Simple protective checks prevent 0-output trades.
    pub fn swap_x_for_y(env: Env, user: Address, dx: i128, min_dy: i128) -> i128 {
        user.require_auth();
        assert!(dx > 0, "invalid amount");

        let fee_numerator: i128 = 997; // 0.3% fee
        let fee_denominator: i128 = 1000;

        let key_x = Symbol::short("x");
        let key_y = Symbol::short("y");
        let reserves_x: i128 = env.storage().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);

        assert!(reserves_x > 0 && reserves_y > 0, "empty pool");

        let dx_with_fee = dx * fee_numerator;
        let numerator = dx_with_fee * reserves_y;
        let denominator = reserves_x * fee_denominator + dx_with_fee;
        let dy = numerator / denominator;

        assert!(dy >= min_dy && dy > 0, "slippage or zero output");

        let new_reserves_x = reserves_x + dx;
        let new_reserves_y = reserves_y - dy;

        env.storage().set(&StorageKey::Reserves(key_x), &new_reserves_x);
        env.storage().set(&StorageKey::Reserves(key_y), &new_reserves_y);

        dy
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, testutils::Address as _};

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
