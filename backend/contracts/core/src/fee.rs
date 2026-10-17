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
    use std::string::String;
    use std::vec::Vec;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FeeVector {
        description: String,
        amount: String,
        fee_bps: u32,
        expected_fee: String,
    }

    #[test]
    fn test_shared_fee_vectors() {
        let json_data = include_str!("../../../../shared/fixtures/fee-vectors.json");
        let vectors: Vec<FeeVector> = serde_json::from_str(json_data)
            .expect("failed to parse shared fee vectors JSON");

        for v in vectors {
            let amount: i128 = v.amount.parse().expect("invalid amount in vector");
            let expected_fee: i128 = v.expected_fee.parse().expect("invalid expected fee in vector");

            let fee = compute_fee(amount, v.fee_bps);
            assert_eq!(
                fee, expected_fee,
                "Vector failed: {} (amount: {}, fee_bps: {})",
                v.description, v.amount, v.fee_bps
            );

            let net = compute_net(amount, v.fee_bps);
            assert_eq!(
                net,
                amount - expected_fee,
                "Net calculation failed for vector: {}",
                v.description
            );
        }
    }

    #[test]
    fn test_assert_valid_fee_bps_limits() {
        assert_valid_fee_bps(0);
        assert_valid_fee_bps(250);
        assert_valid_fee_bps(MAX_FEE_BPS);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 1000 basis points (10%)")]
    fn test_assert_valid_fee_bps_exceeds_max() {
        assert_valid_fee_bps(1_001);
    }
}

