import { fetchCreatorBio } from '@/lib/streaming/chunk-data';
import { RichTextContent } from '@/components/ui/rich-text';
import { ArrowRight } from 'lucide-react';

export async function CreatorBioSection({ id }: { id: string }) {
  const data = await fetchCreatorBio(id);

  if (!data || (!data.bio && !data.tagline && data.skills.length === 0)) {
    return (
      <div className="mb-12 p-8 rounded-lg border border-dashed border-border bg-muted/30">
        <h3 className="text-lg font-semibold text-foreground mb-2">About</h3>
        <p className="text-muted-foreground mb-4">
          This creator hasn't added their about section yet. Check back soon to learn more about their skills, experience, and expertise.
        </p>
        <a
          href="/profile/edit"
          className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <span>Add your bio and skills</span>
          <ArrowRight size={16} />
        </a>
      </div>
    );
  }

  return (
    <>
      {data.tagline && (
        <p className="text-lg italic text-muted-foreground mb-4">&ldquo;{data.tagline}&rdquo;</p>
      )}
      {data.bio && (
        <div className="mb-8 max-w-3xl">
          {data.bio.startsWith('<') ? (
            <RichTextContent html={data.bio} />
          ) : (
            <p className="text-foreground leading-relaxed">{data.bio}</p>
          )}
        </div>
      )}
      {data.skills.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-12">
          {data.skills.map((skill) => (
            <span key={skill} className="px-3 py-1 text-sm bg-muted rounded-full text-foreground">
              {skill}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
