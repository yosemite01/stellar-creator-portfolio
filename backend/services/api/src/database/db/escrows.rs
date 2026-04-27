use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowCreateRequest {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "payerAddress")]
    pub payer_address: String,
    #[serde(rename = "payeeAddress")]
    pub payee_address: String,
    pub amount: i64,
    pub token: String,
    pub timelock: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowRefundRequest {
    #[serde(rename = "authorizerAddress")]
    pub authorizer_address: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Escrow {
    pub id: u64,
    pub bounty_id: String,
    pub payer_address: String,
    pub payee_address: String,
    pub amount: i64,
    pub token: String,
    pub status: String,
    pub transaction_hash: Option<String>,
    pub timelock: Option<u64>,
    pub created_at: String,
}

pub fn get_mock_escrows() -> Vec<Escrow> {
    vec![
        Escrow {
            id: 1,
            bounty_id: "1".to_string(),
            payer_address: "GPAYER123".to_string(),
            payee_address: "GPAYEE456".to_string(),
            amount: 5000,
            token: "GUSDC".to_string(),
            status: "active".to_string(),
            transaction_hash: Some("tx_123456".to_string()),
            timelock: Some(1640995200),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        },
        Escrow {
            id: 2,
            bounty_id: "2".to_string(),
            payer_address: "GPAYER789".to_string(),
            payee_address: "GPAYEE012".to_string(),
            amount: 3000,
            token: "GUSDC".to_string(),
            status: "released".to_string(),
            transaction_hash: Some("tx_789012".to_string()),
            timelock: Some(1640995200),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        },
    ]
}

pub fn get_escrow_by_id(escrow_id: u64) -> Option<Escrow> {
    let escrows = get_mock_escrows();
    escrows.into_iter().find(|escrow| escrow.id == escrow_id)
}

pub fn create_escrow(request: EscrowCreateRequest) -> Escrow {
    let escrow_id = 1; // In production, this would be generated
    Escrow {
        id: escrow_id,
        bounty_id: request.bounty_id,
        payer_address: request.payer_address,
        payee_address: request.payee_address,
        amount: request.amount,
        token: request.token,
        status: "pending".to_string(),
        transaction_hash: Some(format!("tx_escrow_{}", escrow_id)),
        timelock: request.timelock,
        created_at: chrono_now(),
    }
}

pub fn release_escrow(escrow_id: u64) -> Option<Escrow> {
    let mut escrow = get_escrow_by_id(escrow_id)?;
    escrow.status = "released".to_string();
    escrow.transaction_hash = Some(format!("tx_release_{}", escrow_id));
    Some(escrow)
}

pub fn refund_escrow(escrow_id: u64, authorizer_address: String) -> Option<Escrow> {
    let mut escrow = get_escrow_by_id(escrow_id)?;
    escrow.status = "refunded".to_string();
    escrow.transaction_hash = Some(format!("tx_refund_{}", escrow_id));
    Some(escrow)
}

fn chrono_now() -> String {
    // Stable timestamp placeholder — real impl would use chrono or time crate
    "2026-01-01T00:00:00Z".to_string()
}
