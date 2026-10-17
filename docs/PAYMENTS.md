# Payout History & Receipts Documentation

## Overview

Tamgora provides freelancers with transparent payout history and downloadable receipts for proof of income, client invoicing, and tax filing. Both fiat (Stripe/Bank) and on-chain (Stellar network) payouts are supported.

## Key Features

1. **Detailed Payout History (`GET /api/payouts`)**:
   - Lists all historical payouts for the authenticated user.
   - Filter by payment type (`fiat` or `on-chain`), `status`, and `limit`.
   - Each payout record contains full platform fee breakdown (gross bounty amount, platform fee percentage, net payout amount).

2. **Official PDF Receipt Generation (`GET /api/payouts/:id/receipt`)**:
   - Generates standard PDF-1.4 receipts on-the-fly (`application/pdf`) with `Content-Disposition: attachment`.
   - Also supports JSON format via query parameter `?format=json`.
   - Includes:
     - Unique receipt identification number (`RCP-...`).
     - Freelancer & Client identifiers.
     - Bounty project title and ID.
     - Platform fee breakdown.
     - Direct clickable link to the Stellar blockchain transaction explorer (`https://stellar.expert/explorer/testnet/tx/{txHash}`).
     - Official legal & tax notice.

3. **Access Control**:
   - Only the designated freelancer, the paying client, or platform administrators can view and download the receipt (enforces 401 unauthenticated and 403 forbidden responses).

## Endpoints

### List Freelancer Payouts
- **URL**: `GET /api/payouts`
- **Headers**: `Cookie` (NextAuth session)
- **Query Params**:
  - `type` (optional): `fiat` | `on-chain`
  - `status` (optional): `completed` | `pending` | `failed`
  - `limit` (optional): positive integer
- **Response**:
  ```json
  {
    "payouts": [
      {
        "id": "po-101",
        "freelancerUserId": "creator-1",
        "freelancerName": "Alex Rivera",
        "clientUserId": "client-1",
        "clientName": "Nexus Labs",
        "bountyId": "bounty-1",
        "bountyTitle": "Brand Identity Design for Web3 Startup",
        "grossAmount": 3000,
        "currency": "USDC",
        "feeBreakdown": {
          "grossAmount": 3000,
          "platformFeeRate": 0.10,
          "platformFeeAmount": 300,
          "netPayoutAmount": 2700,
          "currency": "USDC"
        },
        "type": "on-chain",
        "status": "completed",
        "stellarTxHash": "e637841c7b8c8d5a2d0efb82cf7d12a938c8230b0e352ef164c4c51480f7457a",
        "stellarExplorerUrl": "https://stellar.expert/explorer/testnet/tx/e637841c7b8c8d5a2d0efb82cf7d12a938c8230b0e352ef164c4c51480f7457a",
        "createdAt": "2026-10-12T12:00:00.000Z"
      }
    ],
    "total": 1
  }
  ```

### Download Payout Receipt
- **URL**: `GET /api/payouts/:id/receipt`
- **Query Params**:
  - `format` (optional): `pdf` (default) or `json`
- **Response**:
  - `application/pdf` binary stream when `format=pdf` (or omitted).
  - `application/json` when `format=json`.
