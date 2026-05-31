// Server component to fetch public GitHub profile data for a username
import React from "react";
import Image from "next/image";

type Props = { username: string };

export default async function GithubProfile({ username }: Props) {
    if (!username) return null;

    try {
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
            // rely on server-side fetch caching
            next: { revalidate: 60 },
        });
        if (!res.ok) return (
            <div className="p-4 rounded-md border">
                <div>Unable to fetch GitHub data.</div>
            </div>
        );
        const data = await res.json();

        return (
            <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-4">
                    <Image src={data.avatar_url} alt="avatar" width={72} height={72} className="rounded-full" />
                    <div>
                        <div className="font-semibold">{data.name || data.login}</div>
                        <div className="text-sm text-muted-foreground">{data.bio}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                            <span className="mr-3">{data.public_repos} repos</span>
                            <span className="mr-3">{data.followers} followers</span>
                            <span>{data.following} following</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    } catch (e) {
        return (
            <div className="p-4 rounded-md border">
                <div>Error fetching GitHub profile.</div>
            </div>
        );
    }
}
