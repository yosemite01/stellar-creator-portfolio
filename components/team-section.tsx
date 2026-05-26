'use client';

import { Linkedin, Twitter } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  social: {
    linkedin?: string;
    twitter?: string;
  };
}

const teamMembers: TeamMember[] = [
  {
    id: '1',
    name: 'Alexandra Chen',
    role: 'Founder & CEO',
    bio: 'Building platforms that empower creative professionals. Former product lead at a design agency.',
    social: {
      linkedin: 'https://linkedin.com',
      twitter: 'https://twitter.com',
    },
  },
  {
    id: '2',
    name: 'Marcus Williams',
    role: 'Head of Design',
    bio: 'Award-winning designer passionate about creating exceptional user experiences.',
    social: {
      linkedin: 'https://linkedin.com',
      twitter: 'https://twitter.com',
    },
  },
  {
    id: '3',
    name: 'Sofia Rodriguez',
    role: 'Head of Operations',
    bio: 'Dedicated to building an inclusive community and supporting our creators.',
    social: {
      linkedin: 'https://linkedin.com',
      twitter: 'https://twitter.com',
    },
  },
  {
    id: '4',
    name: 'James Park',
    role: 'Lead Engineer',
    bio: 'Full-stack developer building scalable platforms for the creative economy.',
    social: {
      linkedin: 'https://linkedin.com',
      twitter: 'https://twitter.com',
    },
  },
];

export function TeamSection() {
  return (
    <section className="py-16 sm:py-24 bg-muted/30 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            Meet the Team
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Passionate creators and builders dedicated to transforming how talent connects with opportunity
          </p>
        </div>

        {/* Team Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
            >
              {/* Avatar Placeholder */}
              <div className="w-full aspect-square bg-gradient-to-br from-primary/20 to-accent/20 rounded-lg mb-4 flex items-center justify-center">
                <div className="text-3xl font-bold text-primary/50">
                  {member.name.split(' ')[0][0]}{member.name.split(' ')[1][0]}
                </div>
              </div>

              {/* Info */}
              <h3 className="text-lg font-bold text-foreground mb-1">{member.name}</h3>
              <p className="text-sm font-semibold text-primary mb-3">{member.role}</p>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{member.bio}</p>

              {/* Social Links */}
              <div className="flex gap-2">
                {member.social.linkedin && (
                  <a
                    href={member.social.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                    aria-label="LinkedIn"
                  >
                    <Linkedin size={16} className="text-primary" />
                  </a>
                )}
                {member.social.twitter && (
                  <a
                    href={member.social.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                    aria-label="Twitter"
                  >
                    <Twitter size={16} className="text-primary" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
