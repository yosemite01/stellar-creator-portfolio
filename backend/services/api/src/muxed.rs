/// SEP-23 muxed account parsing for Stellar accounts.
///
/// Muxed accounts (StrKey type `MUXED_ACCOUNT_MED25519`) allow multiple logical
/// accounts to share a single base ed25519 keypair, distinguished by a u64 ID.
///
/// Wire format (before base32 encoding):
///   version_byte (1)  = 0x60
///   raw_pub_key  (32) = 32-byte ed25519 public key
///   muxed_id     (8)  = big-endian u64
///   checksum     (2)  = CRC-16/XModem of the preceding 41 bytes, little-endian
///
/// The 43-byte payload is encoded with RFC 4648 base32 (no padding) and prefixed
/// with the letter "M".  Regular G-addresses use version byte 0x06 and omit the
/// muxed ID field.

use std::fmt;

// ── Base32 (RFC 4648, no padding) ──────────────────────────────────────────

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Decode a base32 string (upper-case, no padding) into raw bytes.
fn base32_decode(input: &str) -> Result<Vec<u8>, ParseError> {
    let bytes = input.as_bytes();
    // Build a lookup table: ASCII → 5-bit value (255 = invalid)
    let mut table = [255u8; 256];
    for (i, &c) in BASE32_ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }

    let mut out = Vec::with_capacity(bytes.len() * 5 / 8);
    let mut buf: u16 = 0;
    let mut bits: u8 = 0;

    for &b in bytes {
        let val = table[b as usize];
        if val == 255 {
            return Err(ParseError::InvalidBase32);
        }
        buf = (buf << 5) | (val as u16);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1u16 << bits) - 1;
        }
    }

    Ok(out)
}

// ── CRC-16/XModem ─────────────────────────────────────────────────────────

/// CRC-16/XModem (polynomial 0x1021, init 0x0000, no reflection).
fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

// ── StrKey encode for G-addresses ─────────────────────────────────────────

/// Encode a 32-byte raw ed25519 public key as a G-address (StrKey).
fn strkey_encode_gaddress(raw_key: &[u8; 32]) -> String {
    const VERSION_ACCOUNT: u8 = 0x06 << 3; // = 0x30 per StrKey spec
    let mut payload = Vec::with_capacity(35);
    payload.push(VERSION_ACCOUNT);
    payload.extend_from_slice(raw_key);
    let crc = crc16_xmodem(&payload);
    // Checksum is appended little-endian
    payload.push((crc & 0xFF) as u8);
    payload.push((crc >> 8) as u8);
    base32_encode(&payload)
}

/// Encode bytes to RFC 4648 base32 (upper-case, no padding).
fn base32_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() * 8).div_ceil(5));
    let mut buf: u16 = 0;
    let mut bits: u8 = 0;
    for &byte in input {
        buf = (buf << 8) | (byte as u16);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buf >> bits) & 0x1F) as usize] as char);
            buf &= (1u16 << bits) - 1;
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buf << (5 - bits)) & 0x1F) as usize] as char);
    }
    out
}

// ── Public types ──────────────────────────────────────────────────────────

/// Represents a parsed Stellar account, either regular or muxed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StellarAccount {
    /// The base account public key (G-address).
    pub base_account: String,
    /// Optional multiplexed ID for distinguishing sub-accounts.
    pub muxed_id: Option<u64>,
}

impl StellarAccount {
    /// Parse a Stellar account string (regular G-address or SEP-23 M-address).
    ///
    /// # Errors
    /// Returns [`ParseError`] when the input is empty, has an unrecognised prefix,
    /// fails base32 decoding, has an invalid checksum, or contains an unexpected
    /// version byte.
    pub fn parse(account: &str) -> Result<Self, ParseError> {
        if account.is_empty() {
            return Err(ParseError::EmptyAccount);
        }

        if account.starts_with('M') {
            Self::parse_muxed(account)
        } else if account.starts_with('G') {
            Self::parse_gaddress(account)
        } else {
            Err(ParseError::InvalidFormat)
        }
    }

    /// Decode a G-address using the full StrKey algorithm:
    /// base32 → validate CRC-16 → check version byte → extract raw key.
    ///
    /// This mirrors the TS implementation so both sides reject malformed
    /// G-addresses (bad base32, bad checksum, wrong version byte) consistently.
    fn parse_gaddress(account: &str) -> Result<Self, ParseError> {
        let decoded = base32_decode(account)?;

        // 1 version + 32 pubkey + 2 checksum = 35 bytes
        if decoded.len() != 35 {
            return Err(ParseError::InvalidFormat);
        }

        let (payload, checksum_bytes) = decoded.split_at(33);
        let expected = crc16_xmodem(payload);
        let actual = (checksum_bytes[0] as u16) | ((checksum_bytes[1] as u16) << 8);
        if expected != actual {
            return Err(ParseError::InvalidChecksum);
        }

        // Version byte for ED25519_PUBLIC_KEY is 0x30 (0x06 << 3).
        if payload[0] != 0x30 {
            return Err(ParseError::InvalidVersionByte);
        }

        Ok(StellarAccount {
            base_account: account.to_string(),
            muxed_id: None,
        })
    }

    /// Decode an M-address using the full SEP-23 / StrKey algorithm:
    /// base32 → validate CRC-16 → check version byte → extract muxed ID + raw key.
    fn parse_muxed(account: &str) -> Result<Self, ParseError> {
        // Strip the leading 'M' before base32 decoding.
        // StrKey encodes the version byte as the first 5 bits; the 'M' prefix is
        // produced naturally from the 0x60 version byte and is NOT a separate
        // character to strip — we decode the whole string including it.
        let decoded = base32_decode(account)?;

        // Minimum: 1 version + 8 muxed_id + 32 pubkey + 2 checksum = 43 bytes
        if decoded.len() != 43 {
            return Err(ParseError::InvalidMuxedFormat);
        }

        // Validate CRC-16 (last 2 bytes are little-endian checksum).
        let (payload, checksum_bytes) = decoded.split_at(41);
        let expected = crc16_xmodem(payload);
        let actual = (checksum_bytes[0] as u16) | ((checksum_bytes[1] as u16) << 8);
        if expected != actual {
            return Err(ParseError::InvalidChecksum);
        }

        // Version byte for MUXED_ACCOUNT_MED25519 is 0x60.
        if payload[0] != 0x60 {
            return Err(ParseError::InvalidVersionByte);
        }

        // SEP-23 / MuxedAccountMed25519 XDR order: the ed25519 key comes
        // first and the ID last. Reading the ID from bytes 1–8 returned a
        // garbage ID and a G-address built from the wrong 32 bytes.
        // Bytes 1–32: 32-byte raw ed25519 public key → re-encode as G-address.
        let raw_key: &[u8; 32] = payload[1..33].try_into().unwrap();

        // Bytes 33–40: big-endian muxed ID.
        let muxed_id = u64::from_be_bytes(payload[33..41].try_into().unwrap());
        let base_account = strkey_encode_gaddress(raw_key);

        Ok(StellarAccount {
            base_account,
            muxed_id: Some(muxed_id),
        })
    }

    /// Unique analytics identifier that distinguishes muxed sub-accounts.
    ///
    /// Format: `"<G-address>:<muxed_id>"` for muxed accounts, `"<G-address>"` otherwise.
    pub fn analytics_id(&self) -> String {
        match self.muxed_id {
            Some(id) => format!("{}:{}", self.base_account, id),
            None => self.base_account.clone(),
        }
    }

    /// Returns `true` when this account carries a muxed ID.
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

/// Errors that can occur during account parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    EmptyAccount,
    InvalidFormat,
    InvalidBase32,
    InvalidMuxedFormat,
    InvalidChecksum,
    InvalidVersionByte,
    /// Kept for backwards compatibility; no longer produced internally.
    InvalidMuxedId,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::EmptyAccount => write!(f, "Account string is empty"),
            ParseError::InvalidFormat => write!(f, "Invalid account format: must start with G or M"),
            ParseError::InvalidBase32 => write!(f, "Invalid base32 encoding"),
            ParseError::InvalidMuxedFormat => write!(f, "Invalid muxed account format: wrong decoded length"),
            ParseError::InvalidChecksum => write!(f, "Muxed account checksum mismatch"),
            ParseError::InvalidVersionByte => write!(f, "Unexpected StrKey version byte"),
            ParseError::InvalidMuxedId => write!(f, "Invalid muxed account ID"),
        }
    }
}

impl std::error::Error for ParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    // Shared test vectors (mirrored in the TS implementation).
    const G_ADDRESS: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    const M_ADDRESS: &str = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJLK";

    #[test]
    fn parses_regular_g_address() {
        let acct = StellarAccount::parse(G_ADDRESS).unwrap();
        assert_eq!(acct.base_account, G_ADDRESS);
        assert_eq!(acct.muxed_id, None);
        assert!(!acct.is_muxed());
        assert_eq!(acct.analytics_id(), G_ADDRESS);
    }

    #[test]
    fn rejects_g_address_with_bad_checksum() {
        // Flip the final character to break the CRC.
        let mut bad = G_ADDRESS.to_string();
        bad.pop();
        bad.push('A');
        assert_eq!(StellarAccount::parse(&bad), Err(ParseError::InvalidChecksum));
    }

    #[test]
    fn rejects_g_address_with_wrong_length() {
        assert_eq!(
            StellarAccount::parse("GABC"),
            Err(ParseError::InvalidFormat)
        );
    }

    #[test]
    fn rejects_empty_and_unknown_prefix() {
        assert_eq!(StellarAccount::parse(""), Err(ParseError::EmptyAccount));
        assert_eq!(StellarAccount::parse("SABC"), Err(ParseError::InvalidFormat));
    }

    #[test]
    fn rejects_invalid_base32() {
        // '1' is not in the base32 alphabet.
        assert_eq!(
            StellarAccount::parse("G1111111111111111111111111111111111111111111111111111111"),
            Err(ParseError::InvalidBase32)
        );
    }

    #[test]
    fn parses_muxed_address() {
        // SEP-23 test vector: this M-address carries ID 2^63.
        let acct = StellarAccount::parse(M_ADDRESS).unwrap();
        assert_eq!(acct.base_account, G_ADDRESS);
        assert_eq!(acct.muxed_id, Some(9_223_372_036_854_775_808));
        assert!(acct.is_muxed());
        assert_eq!(acct.analytics_id(), format!("{}:9223372036854775808", G_ADDRESS));
    }

    #[test]
    fn parses_muxed_address_with_id_zero() {
        // SEP-23 test vector for the same key with ID 0.
        let m0 = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ";
        let acct = StellarAccount::parse(m0).unwrap();
        assert_eq!(acct.base_account, G_ADDRESS);
        assert_eq!(acct.muxed_id, Some(0));
    }

    #[test]
    fn rejects_muxed_with_bad_checksum() {
        let mut bad = M_ADDRESS.to_string();
        bad.pop();
        bad.push('A');
        assert_eq!(StellarAccount::parse(&bad), Err(ParseError::InvalidChecksum));
    }

    #[test]
    fn rejects_muxed_with_wrong_length() {
        assert_eq!(
            StellarAccount::parse("MABC"),
            Err(ParseError::InvalidMuxedFormat)
        );
    }
}
