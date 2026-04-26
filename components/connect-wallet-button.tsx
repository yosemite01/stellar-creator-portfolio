'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';

export function ConnectWalletButton() {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState('');

  const handleConnect = async () => {
    if (!connected) {
      setConnected(true);
      // Generate a mock Stellar address
      setAddress('G' + Array.from({length: 55}, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join(''));
    } else {
      setConnected(false);
      setAddress('');
    }
  };

  return (
    <Button 
      variant={connected ? "secondary" : "default"} 
      onClick={handleConnect}
      className="gap-2"
    >
      <Wallet size={16} />
      {connected ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'Connect Wallet'}
    </Button>
  );
}
