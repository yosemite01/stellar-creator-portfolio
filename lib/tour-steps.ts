export interface TourStep {
  targetSelector: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    targetSelector: 'nav',
    title: 'Navigate the app',
    description: 'Use the navigation menu to explore different sections of the platform.',
  },
  {
    targetSelector: '[data-tour="create-bounty"]',
    title: 'Create a Bounty',
    description: 'Post a bounty to find creators and freelancers for your project.',
  },
  {
    targetSelector: '[data-tour="creator-search"]',
    title: 'Search Creators',
    description: 'Discover creators by skill, discipline, or name.',
  },
  {
    targetSelector: '[data-tour="wallet-connect"]',
    title: 'Connect Your Wallet',
    description: 'Connect your Stellar wallet to send and receive payments securely.',
  },
  {
    targetSelector: '[data-tour="notifications"]',
    title: 'Stay Updated',
    description: 'Get instant notifications about bounty activity and messages.',
  },
];
