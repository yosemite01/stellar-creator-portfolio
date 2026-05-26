'use client';

import Image from 'next/image';

interface GalleryItem {
  id: string;
  src: string;
  alt: string;
  title: string;
  description: string;
}

interface FeatureGalleryProps {
  items: GalleryItem[];
  columns?: number;
}

export function FeatureGallery({ items, columns = 2 }: FeatureGalleryProps) {
  return (
    <div className={`grid grid-cols-1 ${columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-6`}>
      {items.map((item) => (
        <div
          key={item.id}
          className="group relative overflow-hidden rounded-lg border border-border/60 hover:border-accent/40 transition-all duration-300"
        >
          <div className="relative h-64 overflow-hidden bg-muted">
            <Image
              src={item.src}
              alt={item.alt}
              fill
              className="object-cover group-hover:scale-110 transition-transform duration-500 ease-out"
            />
            {/* Dark overlay on hover */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300" />
          </div>

          {/* Content overlay */}
          <div className="absolute inset-0 flex flex-col justify-end p-6 bg-gradient-to-t from-black/60 via-black/0 to-transparent">
            <h3 className="text-lg font-bold text-white mb-1 group-hover:translate-y-0 translate-y-2 transition-transform duration-300">
              {item.title}
            </h3>
            <p className="text-sm text-white/90 group-hover:opacity-100 opacity-0 transition-opacity duration-300">
              {item.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
