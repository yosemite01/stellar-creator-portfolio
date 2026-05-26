import { rpc, Networks } from '@stellar/stellar-sdk';
import { StellarConfig } from './types';

const defaultRpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const defaultNetworkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const defaultContractId = process.env.CONTRACT_ID || '';

export class StellarClient {
  private static instance: StellarClient;
  public rpc: rpc.Server;
  public config: StellarConfig;

  private constructor(config?: Partial<StellarConfig>) {
    this.config = {
      rpcUrl: config?.rpcUrl || defaultRpcUrl,
      networkPassphrase: config?.networkPassphrase || defaultNetworkPassphrase,
      contractId: config?.contractId || defaultContractId,
      adminSecret: config?.adminSecret || process.env.STELLAR_ADMIN_SECRET,
    };

    this.rpc = new rpc.Server(this.config.rpcUrl);
  }

  public static getInstance(config?: Partial<StellarConfig>): StellarClient {
    if (!StellarClient.instance) {
      StellarClient.instance = new StellarClient(config);
    }
    return StellarClient.instance;
  }
}

export const stellarClient = StellarClient.getInstance();
