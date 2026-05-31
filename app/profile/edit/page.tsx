import { ProfileForm } from "@/components/forms/profile-form";
import GithubProfile from "@/components/ui/github-profile";
import SocialLinks from "@/components/ui/social-links";

export default function ProfileEditPage() {
    return (
        <div className="container max-w-2xl py-10">
            <div className="space-y-6">
                <div>
                    <h4 className="text-md font-medium">Profile Aggregation</h4>
                    <p className="text-sm text-muted-foreground">Preview external profile data (example: GitHub)</p>
                    <div className="mt-4">
                        {/* server component fetches public GitHub data for demo username */}
                        <GithubProfile username="octocat" />
                    </div>
                    <div className="mt-4">
                        <SocialLinks githubUrl="https://github.com/octocat" figmaUrl="" websiteUrl="" />
                    </div>
                </div>
                <div>
                    <h3 className="text-lg font-medium">Profile</h3>
                    <p className="text-sm text-muted-foreground">
                        Update your profile and link your social accounts.
                    </p>
                </div>
                <div className="border-t pt-6">
                    <ProfileForm />
                </div>
            </div>
        </div>
    );
}
