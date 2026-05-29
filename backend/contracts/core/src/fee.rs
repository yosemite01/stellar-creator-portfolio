pub const MAX_FEE_BPS: u32 = 10_000;

pub fn assert_valid_fee_bps(fee_bps: u32) {
    assert!(
        fee_bps <= MAX_FEE_BPS,
        "Fee exceeds maximum of 10000 basis points"
    );
}

pub fn compute_fee(amount: i128, fee_bps: u32) -> i128 {
    assert_valid_fee_bps(fee_bps);
    amount * (fee_bps as i128) / 10_000
}

pub fn compute_net(amount: i128, fee_bps: u32) -> i128 {
    amount - compute_fee(amount, fee_bps)
}
