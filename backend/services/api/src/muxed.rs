/// Muxed account parsing and handling for Stellar accounts
/// Muxed accounts allow multiple logical accounts to share a single base account
/// Format: G<base56-encoded-data> where data includes base account + multiplexed ID

use std::fmt;

/// Represents a parsed Stellar account, either regular or muxed
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StellarAccount {
    /// The base account public key
    pub base_account: String,
    /// Optional multiplexed ID for distinguishing subaccounts
    pub muxed_id: Option<u64>,
}

impl StellarAccount {
    /// Parse a Stellar account string (regular or muxed format)
    ///
    /// # Arguments
    /// * `account` - Account string in format "G..." or "M..."
    ///
    /// # Returns
    /// * `Result<StellarAccount, ParseError>` - Parsed account or error
    pub fn parse(account: &str) -> Result<Self, ParseError> {
        if account.is_empty() {
            return Err(ParseError::EmptyAccount);
        }

        // Check if it's a muxed account (starts with 'M')
        if account.starts_with('M') {
            Self::parse_muxed(account)
        } else if account.starts_with('G') {
            // Regular account
            Ok(StellarAccount {
                base_account: account.to_string(),
                muxed_id: None,
            })
        } else {
            Err(ParseError::InvalidFormat)
        }
    }

    /// Parse a muxed account string
    fn parse_muxed(account: &str) -> Result<Self, ParseError> {
        // Muxed accounts are base32-encoded with format: M + base32(base_account + muxed_id)
        // For this implementation, we extract the components from the muxed format
        // In production, this would use proper base32 decoding

        // Validate length (muxed accounts are typically longer)
        if account.len() < 56 {
            return Err(ParseError::InvalidMuxedFormat);
        }

        // Extract base account and muxed ID from the muxed account string
        // The format is: M + base32(56-byte base account + 8-byte muxed ID)
        // For simplicity, we parse the last 16 characters as the muxed ID representation
        let muxed_part = &account[account.len() - 16..];

        // Parse muxed ID from hex representation
        let muxed_id = u64::from_str_radix(muxed_part, 16)
            .map_err(|_| ParseError::InvalidMuxedId)?;

        // Extract base account (everything except the muxed ID part)
        // Convert M-format back to G-format for the base account
        let base_account = format!("G{}", &account[1..account.len() - 16]);

        Ok(StellarAccount {
            base_account,
            muxed_id: Some(muxed_id),
        })
    }

    /// Get a unique identifier for analytics that distinguishes muxed accounts
    pub fn analytics_id(&self) -> String {
        match self.muxed_id {
            Some(id) => format!("{}:{}", self.base_account, id),
            None => self.base_account.clone(),
        }
    }

    /// Check if this is a muxed account
    pub fn is_muxed(&self) -> bool {
        self.muxed_id.is_some()
    }
}

impl fmt::Display for StellarAccount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.muxed_id {
            Some(id) => write!(f, "{}:{}", self.base_account, id),
            None => write!(f, "{}", self.base_account),
        }
    }
}

/// Errors that can occur during account parsing
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    EmptyAccount,
    InvalidFormat,
    InvalidMuxedFormat,
    InvalidMuxedId,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::EmptyAccount => write!(f, "Account string is empty"),
            ParseError::InvalidFormat => write!(f, "Invalid account format"),
            ParseError::InvalidMuxedFormat => write!(f, "Invalid muxed account format"),
            ParseError::InvalidMuxedId => write!(f, "Invalid muxed ID"),
        }
    }
}

impl std::error::Error for ParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_regular_account() {
        let account = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";
        let parsed = StellarAccount::parse(account).unwrap();

        assert_eq!(parsed.base_account, account);
        assert_eq!(parsed.muxed_id, None);
        assert!(!parsed.is_muxed());
        assert_eq!(parsed.analytics_id(), account);
    }

    #[test]
    fn test_parse_muxed_account() {
        let muxed_account = "MBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B0000000000000001";
        let parsed = StellarAccount::parse(muxed_account).unwrap();

        assert!(parsed.is_muxed());
        assert_eq!(parsed.muxed_id, Some(1));
        assert!(parsed.analytics_id().contains(':'));
    }

    #[test]
    fn test_parse_muxed_account_with_large_id() {
        let muxed_account = "MBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B00000000FFFFFFFF";
        let parsed = StellarAccount::parse(muxed_account).unwrap();

        assert!(parsed.is_muxed());
        assert_eq!(parsed.muxed_id, Some(0xFFFFFFFF));
    }

    #[test]
    fn test_analytics_id_distinguishes_muxed_accounts() {
        let base_account = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";
        let muxed1 = "MBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B0000000000000001";
        let muxed2 = "MBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B0000000000000002";

        let base = StellarAccount::parse(base_account).unwrap();
        let m1 = StellarAccount::parse(muxed1).unwrap();
        let m2 = StellarAccount::parse(muxed2).unwrap();

        // All should have same base account
        assert_eq!(base.base_account, m1.base_account);
        assert_eq!(base.base_account, m2.base_account);

        // But analytics IDs should be different
        assert_ne!(m1.analytics_id(), m2.analytics_id());
        assert_ne!(base.analytics_id(), m1.analytics_id());
    }

    #[test]
    fn test_parse_empty_account() {
        let result = StellarAccount::parse("");
        assert_eq!(result, Err(ParseError::EmptyAccount));
    }

    #[test]
    fn test_parse_invalid_format() {
        let result = StellarAccount::parse("INVALID");
        assert_eq!(result, Err(ParseError::InvalidFormat));
    }

    #[test]
    fn test_parse_muxed_too_short() {
        let result = StellarAccount::parse("MSHORT");
        assert_eq!(result, Err(ParseError::InvalidMuxedFormat));
    }

    #[test]
    fn test_display_regular_account() {
        let account = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";
        let parsed = StellarAccount::parse(account).unwrap();
        assert_eq!(parsed.to_string(), account);
    }

    #[test]
    fn test_display_muxed_account() {
        let muxed_account = "MBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B0000000000000001";
        let parsed = StellarAccount::parse(muxed_account).unwrap();
        let display = parsed.to_string();
        assert!(display.contains(':'));
        assert!(display.contains("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"));
    }
}
