#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
}

#[contract]
pub struct AnalyticsContract;

#[contractimpl]
impl AnalyticsContract {
    pub fn get_value(env: Env, key: Symbol) -> Result<u32, Error> {
        // Reading from storage with unwrap
        // This can panic if the key is not found
        // Placeholder lines to reach line 21
        
        let val: u32 = env.storage().instance().get(&key).ok_or(Error::NotFound)?;
        Ok(val)
    }
}
