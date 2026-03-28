#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

#[contracttype]
pub enum DataKey {
	Owner,
	Admin(Address),
}

#[contract]
pub struct GovernanceContract;

const GOVERNANCE: Symbol = symbol_short!("governance");

#[contractimpl]
impl GovernanceContract {
	/// Initialize the governance contract owner. Owner must authenticate.
	pub fn init(env: Env, owner: Address) -> bool {
		owner.require_auth();
		env.storage().persistent().set(&DataKey::Owner, &owner);
		true
	}

	/// Add an admin. Only the owner may add admins.
	pub fn add_admin(env: Env, owner: Address, admin: Address) -> bool {
		owner.require_auth();
		let stored_owner: Address = env
			.storage()
			.persistent()
			.get(&DataKey::Owner)
			.expect("Governance not initialized");
		if stored_owner != owner {
			panic!("Only owner can add admins");
		}
		env.storage()
			.persistent()
			.set(&DataKey::Admin(admin.clone()), &true);
		// Event: admin added
		env.events().publish((GOVERNANCE, symbol_short!("admin_added"), admin), (owner,));
		true
	}

	/// Remove an admin. Only the owner may remove admins.
	pub fn remove_admin(env: Env, owner: Address, admin: Address) -> bool {
		owner.require_auth();
		let stored_owner: Address = env
			.storage()
			.persistent()
			.get(&DataKey::Owner)
			.expect("Governance not initialized");
		if stored_owner != owner {
			panic!("Only owner can remove admins");
		}
		env.storage().persistent().remove(&DataKey::Admin(admin.clone()));
		env.events().publish((GOVERNANCE, symbol_short!("admin_removed"), admin), (owner,));
		true
	}

	/// Check whether an address is an admin.
	pub fn is_admin(env: Env, addr: Address) -> bool {
		env.storage()
			.persistent()
			.get::<DataKey, bool>(&DataKey::Admin(addr))
			.unwrap_or(false)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use soroban_sdk::testutils::Address as _;
	use soroban_sdk::Env;

	#[test]
	fn test_add_and_check_admin() {
		let env = Env::default();
		env.mock_all_auths();
		let contract_id = env.register(GovernanceContract, ());
		let client = GovernanceContractClient::new(&env, &contract_id);

		let owner = Address::generate(&env);
		// Initialize
		assert!(client.init(&owner));

		let admin = Address::generate(&env);
		assert!(client.add_admin(&owner, &admin));
		assert!(client.is_admin(&admin));

		assert!(client.remove_admin(&owner, &admin));
		assert!(!client.is_admin(&admin));
	}
}

use soroban_sdk::{contract,
