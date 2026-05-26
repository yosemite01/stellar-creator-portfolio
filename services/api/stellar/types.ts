import { Keypair, Transaction } from '@stellar/stellar-sdk';

export interface StellarConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  adminSecret?: string;
}

export interface ContractInvokeArgs {
  contractId: string;
  method: string;
  args: any[];
}

export interface Signer {
  signTransaction(tx: Transaction): Promise<Transaction>;
  publicKey(): string;
}

export class LocalSigner implements Signer {
  private keypair: Keypair;

  constructor(secretKey: string) {
    this.keypair = Keypair.fromSecret(secretKey);
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }
}
