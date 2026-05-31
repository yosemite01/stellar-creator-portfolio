"use client";

import React from "react";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

type Props = {
    githubUrl?: string;
    figmaUrl?: string;
    websiteUrl?: string;
};

function isValidUrl(url?: string) {
    try {
        if (!url) return false;
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

export function SocialLinks({ githubUrl, figmaUrl, websiteUrl }: Props) {
    const links = [
        { key: "github", url: githubUrl, label: "GitHub" },
        { key: "figma", url: figmaUrl, label: "Figma" },
        { key: "website", url: websiteUrl, label: "Website" },
    ];

    return (
        <div className="flex gap-3">
            {links.map((l) => {
                const valid = isValidUrl(l.url);
                return (
                    <motion.a
                        key={l.key}
                        href={l.url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border ${valid ? 'bg-white/5' : 'opacity-60'}`}
                        whileHover={{ scale: 1.05, translateY: -3 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <ExternalLink size={14} />
                        <span className="text-sm">{l.label}</span>
                        <span className={`ml-2 inline-block text-xs ${valid ? 'text-green-400' : 'text-yellow-400'}`}>
                            {valid ? 'Verified' : 'Missing'}
                        </span>
                    </motion.a>
                );
            })}
        </div>
    );
}

export default SocialLinks;
