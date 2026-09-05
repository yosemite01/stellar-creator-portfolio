import {
  Address,
  Contract,
  TransactionBuilder,
  scValToNative,
  nativeToScVal,
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

    // result.val is a LedgerEntryData union (account, trustline, contract
    // data, ...), not an ScVal itself - the actual stored value is nested
    // under its contractData() variant.
    return scValToNative(result.val.contractData().val());
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

    // 2. Build the initial transaction
    // rpcServer.getAccount() already returns a fully-formed Account instance
    // (accountId + sequence number) - use it directly rather than
    // re-wrapping it.
    const call = contract.call(method, ...args.map((arg) => nativeToScVal(arg)));
    let tx = new TransactionBuilder(
      sourceAccount,
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
    // This SDK version's GetTransactionStatus only has SUCCESS, FAILED, and
    // NOT_FOUND - a submitted-but-not-yet-included transaction reads back as
    // NOT_FOUND (there's no separate PENDING status), so that's the only
    // "still waiting" case to retry on.
    let statusResponse = await rpcServer.getTransaction(response.hash);
    while (statusResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      statusResponse = await rpcServer.getTransaction(response.hash);
    }

    if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return response.hash;
    }

    if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${JSON.stringify(statusResponse.resultXdr)}`);
    }

    throw new Error('Unreachable: exhausted all known transaction statuses');
  }
}

export const contractService = new ContractService();
