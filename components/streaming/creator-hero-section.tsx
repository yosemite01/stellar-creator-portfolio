import { fetchCreatorCore, fetchCreatorSocial } from '@/lib/streaming/chunk-data';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { HireMeDialog } from '@/components/creators/hire-me-dialog';
import { SocialShare } from '@/components/common/social-share';

export async function CreatorHeroSection({ id }: { id: string }) {
  const [creator, social] = await Promise.all([fetchCreatorCore(id), fetchCreatorSocial(id)]);
  if (!creator || !social) notFound();

  return (
    <>
      <div className="relative h-48 sm:h-64 w-full bg-muted overflow-hidden">
        <Image
          src={creator.coverImage}
          alt={`${creator.name} cover`}
          fill
          className="object-cover"
          priority
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 mb-8">
          <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-background bg-muted shrink-0">
            <Image src={creator.avatar} alt={creator.name} fill className="object-cover" />
          </div>
          <div className="pb-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{social.name}</h1>
            <p className="text-muted-foreground">{social.title} · {social.discipline}</p>
          </div>
          <div className="sm:ml-auto flex flex-wrap items-center gap-3 pb-1">
            <a href={social.linkedIn} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors">
              LinkedIn
            </a>
            <a href={social.twitter} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors">
              Twitter
            </a>
            <HireMeDialog creatorId={id} creatorName={social.name} skills={creator.skills} />
            <SocialShare
              title={`Check out ${social.name} on Stellar Creators`}
              description={social.title}
              url={`/creators/${id}`}
              hashtags={['StellarCreators', 'Web3', 'Portfolio']}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export async function CreatorCtaSection({ id }: { id: string }) {
  const social = await fetchCreatorSocial(id);
  if (!social) return null;

  return (
    <div className="mt-16 text-center border border-border rounded-xl p-10 bg-muted/30">
      <h3 className="text-2xl font-bold text-foreground mb-3">Work with {social.name}</h3>
      <p className="text-muted-foreground mb-6">Reach out directly to discuss your project.</p>
      <a href={social.linkedIn} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors">
        Get In Touch
      </a>
    </div>
  );
}
