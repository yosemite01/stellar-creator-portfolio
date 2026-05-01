'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function HeroBanner() {
  const router = useRouter();

  return (
    <div className="relative h-96 overflow-hidden rounded-lg group">
      <Image
        src="/images/hero-creative-workspace.jpg"
        alt="Creative professionals collaborating in a modern workspace"
        fill
        className="object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
        priority
      />
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30 group-hover:bg-black/25 transition-colors duration-300" />
      
      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-12">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3 text-balance">
          Showcase Your Creative Excellence
        </h3>
        <p className="text-sm sm:text-base text-white/90 mb-6 max-w-md">
          Join a community of world-class creators and showcase your best work to global opportunities.
        </p>
        <div className="flex gap-3">
          <Button
            size="lg"
            className="shadow-lg hover:shadow-xl transition-all duration-200"
            onClick={() => router.push('/creators')}
          >
            Get Started
            <ArrowRight size={18} className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
