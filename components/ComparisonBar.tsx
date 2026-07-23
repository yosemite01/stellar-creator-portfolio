'use client';

import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComparison } from '@/components/ComparisonContext';

export function ComparisonBar() {
  const router = useRouter();
  const { selectedCreators, removeCreator, clearComparison } = useComparison();

  if (selectedCreators.length < 2) {
    return null;
  }

  const ids = selectedCreators.map((c) => c.id).join(',');

  return (
    <AnimatePresence>
      <motion.div
        key="comparison-bar"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background border border-border rounded-lg shadow-xl p-4 max-w-2xl w-full mx-4"
      >
        <div className="flex items-center gap-4">
          {/* Creator Avatars */}
          <div className="flex -space-x-2">
            {selectedCreators.map((creator) => (
              <div
                key={creator.id}
                className="relative w-10 h-10 rounded-full border-2 border-background bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold text-white"
                title={creator.name}
              >
                {creator.name.charAt(0)}
              </div>
            ))}
          </div>

          {/* Text */}
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Comparing {selectedCreators.length} creator{selectedCreators.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedCreators.map((c) => c.name).join(', ')}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                router.push(`/compare?ids=${ids}`);
              }}
            >
              Compare Now
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={clearComparison}
              className="h-8 w-8 p-0"
            >
              <X size={16} />
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
