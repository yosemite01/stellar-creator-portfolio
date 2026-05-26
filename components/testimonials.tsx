'use client';

import { Star } from 'lucide-react';

interface Testimonial {
  id: string;
  text: string;
  author: string;
  role: string;
  rating: number;
}

const testimonials: Testimonial[] = [
  {
    id: '1',
    text: 'Stellar connected us with incredible designers who transformed our product. The process was seamless and professional.',
    author: 'Sarah Chen',
    role: 'Product Manager, TechStartup',
    rating: 5,
  },
  {
    id: '2',
    text: 'As a freelancer, this platform gave me access to high-quality projects and clients who truly value creative work.',
    author: 'Marcus Johnson',
    role: 'UI/UX Designer',
    rating: 5,
  },
  {
    id: '3',
    text: 'The bounty system is revolutionary. We found the perfect content creator for our campaign in days, not weeks.',
    author: 'Emily Rodriguez',
    role: 'Marketing Director, GrowthCo',
    rating: 5,
  },
];

export function TestimonialsSection() {
  return (
    <section className="py-20 sm:py-32 bg-muted/30 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            Loved by Creators & Clients
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See what industry leaders are saying about Stellar
          </p>
        </div>

        {/* Testimonials Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
            >
              {/* Rating */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star key={i} size={18} className="fill-accent text-accent" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-foreground mb-6 italic leading-relaxed">
                "{testimonial.text}"
              </p>

              {/* Author */}
              <div>
                <p className="font-semibold text-foreground">{testimonial.author}</p>
                <p className="text-sm text-muted-foreground">{testimonial.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
