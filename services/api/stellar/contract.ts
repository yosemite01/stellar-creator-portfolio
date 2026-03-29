import {
  Address,
  Contract,
  TransactionBuilder,
  xdr,
  scValToNative,
  nativeToScVal,
  Account,
  rpc,
  TimeoutInfinite,
} from '@stellar/stellar-sdk';
import { stellarClient } from './client';
import { Signer } from './types';

export class ContractService {
  /**
   * Reads contract data (view call)
   */
  async getContractData(contractId: string, key: string): Promise<any> {
    const contract = new Contract(contractId);
    const result = await stellarClient.rpc.getContractData(
      contract.address(),
      nativeToScVal(key, { type: 'symbol' }),
      rpc.Durability.Persistent
    );

    if (!result || !result.val) {
      return null;
    }

    return scValToNative(result.val as unknown as xdr.ScVal);
  }

  /**
   * Invokes a contract method (write call)
   */
  async invokeContractMethod(
    contractId: string,
    method: string,
    args: any[],
    signer: Signer
  ): Promise<string> {
    const rpcServer = stellarClient.rpc;
    const networkPassphrase = stellarClient.config.networkPassphrase;
    const contract = new Contract(contractId);

    // 1. Get source account details
    const sourcePublicKey = signer.publicKey();
    const sourceAccount = await rpcServer.getAccount(sourcePublicKey);
    const sequence = (sourceAccount as any).sequence || (sourceAccount as any).sequenceNumber;

    // 2. Build the initial transaction
    const call = contract.call(method, ...args.map((arg) => nativeToScVal(arg)));
    let tx = new TransactionBuilder(
      new Account(sourcePublicKey, sequence),
      {
        fee: '100',
        networkPassphrase,
      }
    )
      .addOperation(call)
      .setTimeout(TimeoutInfinite)
      .build();

    // 3. Simulate the transaction to get resource requirements
    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // 4. Assemble the transaction with simulation results
    tx = rpc.assembleTransaction(tx, simulation).build();

    // 5. Sign the transaction
    tx = (await signer.signTransaction(tx as any)) as any;

    // 6. Submit the transaction
    const response = await rpcServer.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw new Error(`Transaction submission failed: ${JSON.stringify(response.errorResult)}`);
    }

    // 7. Poll for status
    let statusResponse = await rpcServer.getTransaction(response.hash);
    while (
      statusResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND
    ) {
      // If pending or not found yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
      statusResponse = await rpcServer.getTransaction(response.hash);
    }

    if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return response.hash;
    }

    if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${JSON.stringify((statusResponse as any).resultXdr)}`);
    }

    throw new Error(`Unknown transaction status: ${(statusResponse as any).status}`);
  }
}

export const contractService = new ContractService();
