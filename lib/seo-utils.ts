import { Metadata } from 'next';

interface SEOConfig {
  title: string;
  description: string;
  keywords?: string[];
  image?: string;
  url?: string;
  author?: string;
  type?: 'website' | 'article' | 'profile';
  twitterHandle?: string;
}

export function generateMetadata(config: SEOConfig): Metadata {
  const {
    title,
    description,
    keywords = [],
    image = '/og-image.png',
    url = 'https://stellar.app',
    author = 'Stellar',
    type = 'website',
    twitterHandle = '@stellarcreators',
  } = config;

  return {
    title,
    description,
    keywords,
    authors: [{ name: author }],
    viewport: 'width=device-width, initial-scale=1.0',
    robots: 'index, follow',
    openGraph: {
      title,
      description,
      type,
      url,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
      creator: twitterHandle,
    },
    alternates: {
      canonical: url,
    },
  };
}

export const SEO_DEFAULTS = {
  siteTitle: 'Stellar - Creator Marketplace & Bounty Platform',
  siteDescription:
    'Connect with world-class creators and find incredible talent across 15+ disciplines. Post bounties, hire freelancers, and build amazing projects.',
  keywords: [
    'creator marketplace',
    'freelancing platform',
    'bounty platform',
    'hire creatives',
    'design bounties',
    'content creation',
    'project showcase',
  ],
  twitterHandle: '@stellarcreators',
  ogImage: 'https://stellar.app/og-image.png',
};

// Structured data for rich snippets
export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Stellar',
    description: SEO_DEFAULTS.siteDescription,
    url: 'https://stellar.app',
    logo: 'https://stellar.app/stellar-logo.jpg',
    sameAs: [
      'https://twitter.com/stellarcreators',
      'https://linkedin.com/company/stellar',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Support',
      email: 'support@stellar.app',
    },
  };
}

export function generateCreatorSchema(creator: {
  id: string;
  name: string;
  title: string;
  bio: string;
  avatar: string;
  rating: number;
  projects: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: creator.name,
    jobTitle: creator.title,
    description: creator.bio,
    image: creator.avatar,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: creator.rating,
      reviewCount: creator.projects,
    },
  };
}

export function generateBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
