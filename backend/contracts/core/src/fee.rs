/// Hard ceiling for governance-settable platform fees: 10% (1000 bps).
/// A fee of 10_000 bps would equal 100% of the transacted amount, which is
/// economically nonsensical and effectively a rug. Capping at 1_000 bps
/// keeps the maximum take at a reasonable 10%.
pub const MAX_FEE_BPS: u32 = 1_000;

pub fn assert_valid_fee_bps(fee_bps: u32) {
    assert!(
        fee_bps <= MAX_FEE_BPS,
        "Fee exceeds maximum of 1000 basis points (10%)"
    );
}

pub fn compute_fee(amount: i128, fee_bps: u32) -> i128 {
    assert_valid_fee_bps(fee_bps);
    amount * (fee_bps as i128) / 10_000
}

pub fn compute_net(amount: i128, fee_bps: u32) -> i128 {
    amount - compute_fee(amount, fee_bps)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use serde::Deserialize;
    use std::vec::Vec;

    #[derive(Debug, Deserialize)]
    struct FeeVector {
        amount: i128,
        #[serde(rename = "feeBps")]
        fee_bps: u32,
        #[serde(rename = "expectedFee")]
        expected_fee: i128,
    }

    #[test]
    fn test_shared_fee_vectors() {
        let json_data = include_str!("../../../../fixtures/fee-vectors.json");
        let vectors: Vec<FeeVector> =
            serde_json::from_str(json_data).expect("Failed to parse shared fee vectors");

        for v in vectors {
            let fee = compute_fee(v.amount, v.fee_bps);
            let net = compute_net(v.amount, v.fee_bps);
            assert_eq!(
                fee, v.expected_fee,
                "Fee mismatch for amount {} and bps {}",
                v.amount, v.fee_bps
            );
            assert_eq!(
                net,
                v.amount - v.expected_fee,
                "Net mismatch for amount {} and bps {}",
                v.amount, v.fee_bps
            );
        }
    }

    #[test]
    fn test_assert_valid_fee_bps_bounds() {
        assert_valid_fee_bps(0);
        assert_valid_fee_bps(250);
        assert_valid_fee_bps(1_000);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 1000 basis points (10%)")]
    fn test_assert_valid_fee_bps_exceeds_max() {
        assert_valid_fee_bps(1_001);
    }
}

