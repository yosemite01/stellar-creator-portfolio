use serde::Deserialize;
use thiserror::Error;

const STROOP_SCALE: u128 = 10_000_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeclaredReserves {
    pub asset_code: String,
    pub asset_issuer: String,
    pub issuer_account: String,
    pub issuer_reserve: String,
    pub treasury_account: String,
    pub treasury_reserve: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedReserves {
    pub issuer_balance: String,
    pub treasury_balance: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofOfReserveReport {
    pub valid: bool,
    pub mismatches: Vec<ReserveMismatch>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveMismatch {
    pub account_role: &'static str,
    pub account_id: String,
    pub declared: String,
    pub observed: String,
}

#[derive(Debug, Error)]
pub enum AssetVerifierError {
    #[error("invalid reserve amount '{amount}'")]
    InvalidReserveAmount { amount: String },
    #[error("asset balance {asset_code}:{asset_issuer} was not found for account {account_id}")]
    MissingAssetBalance {
        account_id: String,
        asset_code: String,
        asset_issuer: String,
    },
    #[error("failed to fetch account {account_id}: {source}")]
    AccountFetch {
        account_id: String,
        #[source]
        source: reqwest::Error,
    },
}

pub fn validate_proof_of_reserve(
    declared: &DeclaredReserves,
    observed: &ObservedReserves,
) -> Result<ProofOfReserveReport, AssetVerifierError> {
    let declared_issuer = parse_stroops(&declared.issuer_reserve)?;
    let observed_issuer = parse_stroops(&observed.issuer_balance)?;
    let declared_treasury = parse_stroops(&declared.treasury_reserve)?;
    let observed_treasury = parse_stroops(&observed.treasury_balance)?;

    let mut mismatches = Vec::new();
    if declared_issuer != observed_issuer {
        mismatches.push(ReserveMismatch {
            account_role: "issuer",
            account_id: declared.issuer_account.clone(),
            declared: declared.issuer_reserve.clone(),
            observed: observed.issuer_balance.clone(),
        });
    }

    if declared_treasury != observed_treasury {
        mismatches.push(ReserveMismatch {
            account_role: "treasury",
            account_id: declared.treasury_account.clone(),
            declared: declared.treasury_reserve.clone(),
            observed: observed.treasury_balance.clone(),
        });
    }

    Ok(ProofOfReserveReport {
        valid: mismatches.is_empty(),
        mismatches,
    })
}

pub async fn validate_proof_of_reserve_from_horizon(
    horizon_url: &str,
    declared: &DeclaredReserves,
) -> Result<ProofOfReserveReport, AssetVerifierError> {
    let client = reqwest::Client::new();
    let issuer_balance = fetch_asset_balance(
        &client,
        horizon_url,
        &declared.issuer_account,
        &declared.asset_code,
        &declared.asset_issuer,
    )
    .await?;
    let treasury_balance = fetch_asset_balance(
        &client,
        horizon_url,
        &declared.treasury_account,
        &declared.asset_code,
        &declared.asset_issuer,
    )
    .await?;

    validate_proof_of_reserve(
        declared,
        &ObservedReserves {
            issuer_balance,
            treasury_balance,
        },
    )
}

async fn fetch_asset_balance(
    client: &reqwest::Client,
    horizon_url: &str,
    account_id: &str,
    asset_code: &str,
    asset_issuer: &str,
) -> Result<String, AssetVerifierError> {
    let account = client
        .get(format!(
            "{}/accounts/{}",
            horizon_url.trim_end_matches('/'),
            account_id,
        ))
        .send()
        .await
        .map_err(|source| AssetVerifierError::AccountFetch {
            account_id: account_id.to_string(),
            source,
        })?
        .error_for_status()
        .map_err(|source| AssetVerifierError::AccountFetch {
            account_id: account_id.to_string(),
            source,
        })?
        .json::<HorizonAccount>()
        .await
        .map_err(|source| AssetVerifierError::AccountFetch {
            account_id: account_id.to_string(),
            source,
        })?;

    account
        .balances
        .into_iter()
        .find(|balance| {
            balance.asset_code.as_deref() == Some(asset_code)
                && balance.asset_issuer.as_deref() == Some(asset_issuer)
        })
        .map(|balance| balance.balance)
        .ok_or_else(|| AssetVerifierError::MissingAssetBalance {
            account_id: account_id.to_string(),
            asset_code: asset_code.to_string(),
            asset_issuer: asset_issuer.to_string(),
        })
}

fn parse_stroops(amount: &str) -> Result<u128, AssetVerifierError> {
    let trimmed = amount.trim();
    let (whole, fraction) = trimmed.split_once('.').unwrap_or((trimmed, ""));

    if whole.is_empty()
        || !whole.chars().all(|ch| ch.is_ascii_digit())
        || !fraction.chars().all(|ch| ch.is_ascii_digit())
        || fraction.len() > 7
    {
        return Err(AssetVerifierError::InvalidReserveAmount {
            amount: amount.to_string(),
        });
    }

    let whole_units =
        whole
            .parse::<u128>()
            .map_err(|_| AssetVerifierError::InvalidReserveAmount {
                amount: amount.to_string(),
            })?;
    let fraction_units = if fraction.is_empty() {
        0
    } else {
        format!("{fraction:0<7}").parse::<u128>().map_err(|_| {
            AssetVerifierError::InvalidReserveAmount {
                amount: amount.to_string(),
            }
        })?
    };

    Ok((whole_units * STROOP_SCALE) + fraction_units)
}

#[derive(Deserialize)]
struct HorizonAccount {
    balances: Vec<HorizonBalance>,
}

#[derive(Deserialize)]
struct HorizonBalance {
    balance: String,
    asset_code: Option<String>,
    asset_issuer: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{parse_stroops, validate_proof_of_reserve, DeclaredReserves, ObservedReserves};

    fn declared() -> DeclaredReserves {
        DeclaredReserves {
            asset_code: "USDC".to_string(),
            asset_issuer: "GISSUER".to_string(),
            issuer_account: "GISSUER".to_string(),
            issuer_reserve: "1000.0000000".to_string(),
            treasury_account: "GTREASURY".to_string(),
            treasury_reserve: "500.2500000".to_string(),
        }
    }

    #[test]
    fn validates_matching_on_chain_reserves() {
        let report = validate_proof_of_reserve(
            &declared(),
            &ObservedReserves {
                issuer_balance: "1000".to_string(),
                treasury_balance: "500.2500000".to_string(),
            },
        )
        .expect("valid reserve report");

        assert!(report.valid);
        assert!(report.mismatches.is_empty());
    }

    #[test]
    fn flags_reserve_mismatches_clearly() {
        let report = validate_proof_of_reserve(
            &declared(),
            &ObservedReserves {
                issuer_balance: "999.0000000".to_string(),
                treasury_balance: "500.0000000".to_string(),
            },
        )
        .expect("valid reserve report");

        assert!(!report.valid);
        assert_eq!(report.mismatches.len(), 2);
        assert_eq!(report.mismatches[0].account_role, "issuer");
        assert_eq!(report.mismatches[0].declared, "1000.0000000");
        assert_eq!(report.mismatches[0].observed, "999.0000000");
        assert_eq!(report.mismatches[1].account_role, "treasury");
    }

    #[test]
    fn parses_stellar_decimal_precision_without_float_rounding() {
        assert_eq!(parse_stroops("1.0000001").expect("amount"), 10_000_001);
        assert!(parse_stroops("1.00000001").is_err());
    }
}
