'use client';

import { useState, useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SkillCombobox } from '@/components/ui/skill-combobox';
import { ProfileCompletionIndicator } from '@/components/profile/profile-completion-indicator';
import { trackEvent } from '@/lib/analytics/analytics';
import { computeProfileCompletion } from '@/lib/profile-completion';
import { parseProfileLink, type ProfileLinkKind } from '@/lib/profile-links';
import { useLinkVerification } from '@/hooks/use-link-verification';
import { LinkVerificationBadge } from '@/components/ui/link-verification-badge';
import {
    PortfolioReorder,
    type PortfolioItem,
} from '@/components/forms/portfolio-reorder';

/** Optional URL field that must also parse as a link for the given provider. */
const providerUrl = (kind: ProfileLinkKind) =>
    z
        .string()
        .url({ message: 'Please enter a valid URL.' })
        .refine((value) => parseProfileLink(kind, value).ok, {
            message: `That doesn't look like a valid ${kind} link.`,
        })
        .optional()
        .or(z.literal(''));

const profileFormSchema = z.object({
    displayName: z.string().min(2, {
        message: 'Display name must be at least 2 characters.',
    }).max(30, {
        message: 'Display name must not be longer than 30 characters.',
    }),
    bio: z.string().max(500).optional(),
    avatar: z.string().url({ message: 'Please enter a valid URL.' }).optional().or(z.literal('')),
    skills: z.array(z.string()).default([]),
    portfolioUrl: z.string().url().optional().or(z.literal('')),
    githubUrl: providerUrl('github'),
    figmaUrl: providerUrl('figma'),
    linkedinUrl: providerUrl('linkedin'),
    websiteUrl: providerUrl('website'),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const defaultValues: ProfileFormValues = {
    displayName: '',
    bio: '',
    avatar: '',
    skills: [],
    portfolioUrl: '',
    githubUrl: '',
    figmaUrl: '',
    linkedinUrl: '',
    websiteUrl: '',
};

export function ProfileForm() {
    const form = useForm<z.input<typeof profileFormSchema>, unknown, ProfileFormValues>({
        resolver: zodResolver(profileFormSchema),
        defaultValues,
        mode: 'onChange',
    });

    const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handlePortfolioChange = useCallback(
        (items: PortfolioItem[]) => {
            setPortfolioItems(items);
        },
        [],
    );

    const watched = useWatch({ control: form.control });
    const githubCheck = useLinkVerification('github', watched.githubUrl);
    const figmaCheck = useLinkVerification('figma', watched.figmaUrl);
    const linkedinCheck = useLinkVerification('linkedin', watched.linkedinUrl);
    const websiteCheck = useLinkVerification('website', watched.websiteUrl);
    const completion = computeProfileCompletion({
        displayName: watched.displayName,
        avatar: watched.avatar || null,
        bio: watched.bio,
        skills: watched.skills,
        portfolio: watched.portfolioUrl ? { items: [{ url: watched.portfolioUrl }] } : null,
        githubUrl: watched.githubUrl,
        linkedinUrl: watched.linkedinUrl,
    });

    useEffect(() => {
        trackEvent('profile_completion_rate', { percentage: completion.percentage });
    }, [completion.percentage]);

    async function onSubmit(data: ProfileFormValues) {
        setIsSaving(true);
        try {
            const payload = {
                displayName: data.displayName,
                bio: data.bio || null,
                avatar: data.avatar || null,
                skills: data.skills,
                portfolio: portfolioItems.length > 0 ? { items: portfolioItems } : (data.portfolioUrl ? { items: [{ url: data.portfolioUrl }] } : null),
                githubUrl: data.githubUrl || null,
                figmaUrl: data.figmaUrl || null,
                linkedinUrl: data.linkedinUrl || null,
                websiteUrl: data.websiteUrl || null,
            };
            const res = await fetch('/api/creators/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.error('Failed to update profile:', err);
            }
            trackEvent('profile_updated', { completion: completion.percentage });
        } catch (err) {
            console.error('Error saving profile:', err);
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <div className="space-y-8">
            <ProfileCompletionIndicator profile={{
                displayName: watched.displayName,
                avatar: watched.avatar || null,
                bio: watched.bio,
                skills: watched.skills,
                portfolio: watched.portfolioUrl ? { items: [{ url: watched.portfolioUrl }] } : null,
                githubUrl: watched.githubUrl,
                linkedinUrl: watched.linkedinUrl,
            }} />

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                    <FormField
                        control={form.control}
                        name="displayName"
                        render={({ field }) => (
                            <FormItem id="displayName">
                                <FormLabel>Display Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Your Name" {...field} />
                                </FormControl>
                                <FormDescription>
                                    This is your public display name.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="avatar"
                        render={({ field }) => (
                            <FormItem id="avatar">
                                <FormLabel>Avatar URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://…" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="bio"
                        render={({ field }) => (
                            <FormItem id="bio">
                                <FormLabel>Bio</FormLabel>
                                <FormControl>
                                    <Textarea
                                        placeholder="Tell us a little bit about yourself"
                                        className="resize-none"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="skills"
                        render={({ field }) => (
                            <FormItem id="skills">
                                <FormLabel>Skills</FormLabel>
                                <FormControl>
                                    <SkillCombobox value={field.value ?? []} onChange={field.onChange} maxItems={10} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="portfolioUrl"
                        render={({ field }) => (
                            <FormItem id="portfolio">
                                <FormLabel>Portfolio sample URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://yourportfolio.com/project" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <PortfolioReorder
                        items={portfolioItems}
                        onChange={handlePortfolioChange}
                    />

                    <FormField
                        control={form.control}
                        name="githubUrl"
                        render={({ field }) => (
                            <FormItem id="social">
                                <FormLabel>GitHub URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://github.com/..." {...field} />
                                </FormControl>
                                <LinkVerificationBadge verification={githubCheck} hideWhenIdle />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="linkedinUrl"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>LinkedIn URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://linkedin.com/in/..." {...field} />
                                </FormControl>
                                <LinkVerificationBadge verification={linkedinCheck} hideWhenIdle />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="figmaUrl"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Figma URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://figma.com/..." {...field} />
                                </FormControl>
                                <LinkVerificationBadge verification={figmaCheck} hideWhenIdle />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="websiteUrl"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Website / Portfolio URL</FormLabel>
                                <FormControl>
                                    <Input placeholder="https://yourportfolio.com" {...field} />
                                </FormControl>
                                <LinkVerificationBadge verification={websiteCheck} hideWhenIdle />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="submit" disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Update profile'}
                    </Button>
                </form>
            </Form>
        </div>
    );
}
