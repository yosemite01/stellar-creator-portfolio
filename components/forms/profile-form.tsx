"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const profileFormSchema = z.object({
    displayName: z.string().min(2, {
        message: "Display name must be at least 2 characters.",
    }).max(30, {
        message: "Display name must not be longer than 30 characters.",
    }),
    bio: z.string().max(160).optional(),
    githubUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal("")),
    figmaUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal("")),
    linkedinUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal("")),
    websiteUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal("")),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const defaultValues: Partial<ProfileFormValues> = {
    displayName: "",
    bio: "",
    githubUrl: "",
    figmaUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
};

export function ProfileForm() {
    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(profileFormSchema),
        defaultValues,
        mode: "onChange",
    });

    function onSubmit(data: ProfileFormValues) {
        // We will implement server action here
        console.log(data);
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field }) => (
                        <FormItem>
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
                    name="bio"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Bio</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder="Tell us a little bit about yourself"
                                    className="resize-none"
                                    {...field}
                                />
                            </FormControl>
                            <FormDescription>
                                You can write up to 160 characters.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="githubUrl"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>GitHub URL</FormLabel>
                            <FormControl>
                                <Input placeholder="https://github.com/..." {...field} />
                            </FormControl>
                            <FormDescription>
                                Link your GitHub profile.
                            </FormDescription>
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
                            <FormDescription>
                                Link your Figma profile.
                            </FormDescription>
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
                            <FormDescription>
                                Link your LinkedIn profile.
                            </FormDescription>
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
                            <FormDescription>
                                Link your personal website or portfolio.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit">Update profile</Button>
            </form>
        </Form>
    );
}
