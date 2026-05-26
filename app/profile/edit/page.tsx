import { ProfileForm } from "@/components/forms/profile-form";

export default function ProfileEditPage() {
    return (
        <div className="container max-w-2xl py-10">
            <div className="space-y-6">
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
