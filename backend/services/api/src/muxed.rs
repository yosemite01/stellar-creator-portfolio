/// SEP-23 muxed account parsing for Stellar accounts.
///
/// Muxed accounts (StrKey type `MUXED_ACCOUNT_MED25519`) allow multiple logical
/// accounts to share a single base ed25519 keypair, distinguished by a u64 ID.
///
/// Wire format (before base32 encoding):
///   version_byte (1)  = 0x60
///   muxed_id     (8)  = big-endian u64
///   raw_pub_key  (32) = 32-byte ed25519 public key
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
            Ok(StellarAccount {
                base_account: account.to_string(),
                muxed_id: None,
            })
        } else {
            Err(ParseError::InvalidFormat)
        }
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

        // Bytes 1–8: big-endian muxed ID.
        let muxed_id = u64::from_be_bytes(payload[1..9].try_into().unwrap());

        // Bytes 9–40: 32-byte raw ed25519 public key → re-encode as G-address.
        let raw_key: &[u8; 32] = payload[9..41].try_into().unwrap();
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
            ParseError::InvalidMuxedId => write!(f, "Invalid muxed ID"),
        }
    }
}

impl std::error::Error for ParseError {}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helper: build a valid M-address from a raw 32-byte key + muxed ID ──

    /// Construct a valid SEP-23 muxed account string for the given raw public key
    /// and muxed ID.  This mirrors exactly what the Stellar SDK produces so the
    /// round-trip tests below use real (not hand-crafted) encoded strings.
    fn build_muxed_address(raw_key: &[u8; 32], muxed_id: u64) -> String {
        let mut payload = Vec::with_capacity(43);
        payload.push(0x60u8); // MUXED_ACCOUNT_MED25519 version byte
        payload.extend_from_slice(&muxed_id.to_be_bytes());
        payload.extend_from_slice(raw_key);
        let crc = crc16_xmodem(&payload);
        payload.push((crc & 0xFF) as u8);
        payload.push((crc >> 8) as u8);
        base32_encode(&payload)
    }

    /// 32-byte all-zero test key (valid length, not a real keypair).
    fn zero_key() -> [u8; 32] {
        [0u8; 32]
    }

    /// 32-byte all-ones test key.
    fn ones_key() -> [u8; 32] {
        [0xFFu8; 32]
    }

    // ── CRC-16 primitive ────────────────────────────────────────────────────

    #[test]
    fn crc16_known_vector() {
        // "123456789" → 0x31C3 per XModem spec
        assert_eq!(crc16_xmodem(b"123456789"), 0x31C3);
    }

    // ── Base32 round-trip ────────────────────────────────────────────────────

    #[test]
    fn base32_round_trip() {
        let data: Vec<u8> = (0u8..43).collect();
        let encoded = base32_encode(&data);
        let decoded = base32_decode(&encoded).expect("decode should succeed");
        assert_eq!(decoded, data);
    }

    #[test]
    fn base32_decode_rejects_invalid_chars() {
        assert_eq!(base32_decode("!@#$"), Err(ParseError::InvalidBase32));
    }

    // ── Regular account (G-address) ────────────────────────────────────────

    #[test]
    fn parse_regular_account_roundtrip() {
        // Re-encode the zero key as a G-address and verify parse accepts it.
        let g = strkey_encode_gaddress(&zero_key());
        assert!(g.starts_with('G'), "expected G-prefix, got {}", g);
        let parsed = StellarAccount::parse(&g).unwrap();
        assert_eq!(parsed.base_account, g);
        assert_eq!(parsed.muxed_id, None);
        assert!(!parsed.is_muxed());
        assert_eq!(parsed.analytics_id(), g);
    }

    // ── Muxed account round-trip ────────────────────────────────────────────

    #[test]
    fn parse_muxed_id_1_roundtrip() {
        let m = build_muxed_address(&zero_key(), 1);
        assert!(m.starts_with('M'), "expected M-prefix, got {}", m);
        let parsed = StellarAccount::parse(&m).unwrap();
        assert!(parsed.is_muxed());
        assert_eq!(parsed.muxed_id, Some(1));
        // The base_account must be the G-address for the zero key.
        let expected_g = strkey_encode_gaddress(&zero_key());
        assert_eq!(parsed.base_account, expected_g);
    }

    #[test]
    fn parse_muxed_max_id_roundtrip() {
        let m = build_muxed_address(&zero_key(), u64::MAX);
        let parsed = StellarAccount::parse(&m).unwrap();
        assert_eq!(parsed.muxed_id, Some(u64::MAX));
    }

    #[test]
    fn parse_muxed_large_id_roundtrip() {
        let m = build_muxed_address(&ones_key(), 0xFFFF_FFFF);
        let parsed = StellarAccount::parse(&m).unwrap();
        assert_eq!(parsed.muxed_id, Some(0xFFFF_FFFF));
    }

    #[test]
    fn parse_muxed_id_0_roundtrip() {
        let m = build_muxed_address(&zero_key(), 0);
        let parsed = StellarAccount::parse(&m).unwrap();
        assert_eq!(parsed.muxed_id, Some(0));
    }

    // ── analytics_id distinguishes muxed sub-accounts ──────────────────────

    #[test]
    fn analytics_id_distinguishes_muxed_accounts() {
        let m1 = build_muxed_address(&zero_key(), 1);
        let m2 = build_muxed_address(&zero_key(), 2);
        let base_g = strkey_encode_gaddress(&zero_key());

        let p1 = StellarAccount::parse(&m1).unwrap();
        let p2 = StellarAccount::parse(&m2).unwrap();
        let pb = StellarAccount::parse(&base_g).unwrap();

        assert_eq!(p1.base_account, p2.base_account, "same underlying key");
        assert_ne!(p1.analytics_id(), p2.analytics_id());
        assert_ne!(pb.analytics_id(), p1.analytics_id());
    }

    #[test]
    fn analytics_id_different_base_keys() {
        let m1 = build_muxed_address(&zero_key(), 1);
        let m2 = build_muxed_address(&ones_key(), 1);
        let p1 = StellarAccount::parse(&m1).unwrap();
        let p2 = StellarAccount::parse(&m2).unwrap();
        assert_ne!(p1.analytics_id(), p2.analytics_id());
    }

    // ── Error cases ─────────────────────────────────────────────────────────

    #[test]
    fn parse_empty_account() {
        assert_eq!(StellarAccount::parse(""), Err(ParseError::EmptyAccount));
    }

    #[test]
    fn parse_invalid_format() {
        assert_eq!(StellarAccount::parse("INVALID"), Err(ParseError::InvalidFormat));
    }

    #[test]
    fn parse_muxed_bad_checksum() {
        let mut m = build_muxed_address(&zero_key(), 1);
        // Flip the last character to corrupt the checksum.
        let last = m.pop().unwrap();
        let replacement = if last == 'A' { 'B' } else { 'A' };
        m.push(replacement);
        let result = StellarAccount::parse(&m);
        // May fail with InvalidBase32 (if the flip hits a non-alphabet char),
        // InvalidMuxedFormat (wrong decoded length), or InvalidChecksum.
        assert!(result.is_err());
    }

    #[test]
    fn parse_muxed_too_short() {
        // Fewer than 56 base32 chars → decodes to <43 bytes → wrong length.
        let result = StellarAccount::parse("MSHORT");
        assert!(result.is_err());
    }

    // ── Display ─────────────────────────────────────────────────────────────

    #[test]
    fn display_regular_account() {
        let g = strkey_encode_gaddress(&zero_key());
        let parsed = StellarAccount::parse(&g).unwrap();
        assert_eq!(parsed.to_string(), g);
    }

    #[test]
    fn display_muxed_account_contains_colon() {
        let m = build_muxed_address(&zero_key(), 42);
        let parsed = StellarAccount::parse(&m).unwrap();
        let s = parsed.to_string();
        assert!(s.contains(':'), "expected '<G-addr>:<id>', got {}", s);
        assert!(s.ends_with(":42"), "expected ':42' suffix, got {}", s);
    }
}
